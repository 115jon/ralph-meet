using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Installer;
using RalphMeet.Packaging;
using Xunit;

namespace Installer.Tests
{
    public sealed class PayloadExtractorTests : IDisposable
    {
        private const int TinyBlock = 4096;

        private readonly string _root = Path.Combine(Path.GetTempPath(), "RalphMeetPayloadTests_" + Guid.NewGuid().ToString("N"));

        public PayloadExtractorTests()
        {
            Directory.CreateDirectory(_root);
        }

        public void Dispose()
        {
            try
            {
                Directory.Delete(_root, true);
            }
            catch (IOException)
            {
            }
        }

        [Fact]
        public void RoundTrip_PreservesNestedEmptyAndMultiBlockFiles()
        {
            string source = CreateTree(new Dictionary<string, byte[]>
            {
                { "RalphMeet.exe", Random(1, 700) },
                { "locales/en-US.pak", Random(2, 3000) },
                { "obs-capture/deep/er/notes.txt", System.Text.Encoding.UTF8.GetBytes("hello") },
                { "empty.bin", new byte[0] },
                { "big.bin", Compressible(3, TinyBlock * 5 + 123) },
                { "after-big.bin", Random(4, TinyBlock) },
            });

            byte[] payload = Pack(source, EnumerateRelative(source));
            string install = Path.Combine(_root, "install");

            PayloadExtractionResult result = Extract(payload, install, 3);

            Assert.Equal(6, result.FileCount);
            Assert.Equal(0, result.SkippedCount);
            foreach (string relative in EnumerateRelative(source))
            {
                Assert.Equal(
                    File.ReadAllBytes(Path.Combine(source, relative)),
                    File.ReadAllBytes(Path.Combine(install, relative)));
            }

            Assert.True(File.Exists(Path.Combine(install, "empty.bin")));
            Assert.Equal(0, new FileInfo(Path.Combine(install, "empty.bin")).Length);
            Assert.True(new RmpkHeaderProbe(payload).BlockCount > 3);
        }

        [Fact]
        public void RoundTrip_IsIndependentOfDecodeParallelism()
        {
            string source = CreateTree(new Dictionary<string, byte[]> { { "a.bin", Random(5, TinyBlock * 9 + 7) } });
            byte[] payload = Pack(source, EnumerateRelative(source));

            Extract(payload, Path.Combine(_root, "one"), 1);
            Extract(payload, Path.Combine(_root, "many"), 8);

            byte[] expected = File.ReadAllBytes(Path.Combine(source, "a.bin"));
            Assert.Equal(expected, File.ReadAllBytes(Path.Combine(_root, "one", "a.bin")));
            Assert.Equal(expected, File.ReadAllBytes(Path.Combine(_root, "many", "a.bin")));
        }

        [Fact]
        public void CorruptedBlockData_FailsTheExtraction()
        {
            string source = CreateTree(new Dictionary<string, byte[]> { { "a.bin", Random(6, TinyBlock * 3) } });
            byte[] payload = Pack(source, EnumerateRelative(source));

            // Flip a byte in the middle of the block payload area (after the header).
            payload[payload.Length - 100] ^= 0x5A;

            Assert.Throws<RmpkFormatException>(() => Extract(payload, Path.Combine(_root, "install"), 2));
        }

        [Fact]
        public void CorruptedHeader_IsRejected()
        {
            string source = CreateTree(new Dictionary<string, byte[]> { { "a.bin", Random(7, 500) } });
            byte[] payload = Pack(source, EnumerateRelative(source));

            payload[30] ^= 0x01; // inside the file table

            Assert.Throws<RmpkFormatException>(() => Extract(payload, Path.Combine(_root, "install"), 2));
        }

        [Fact]
        public void BadMagic_IsRejected()
        {
            Assert.Throws<RmpkFormatException>(() => Extract(new byte[200], Path.Combine(_root, "install"), 2));
        }

        [Fact]
        public void EntriesOutsideTheInstallDirectory_AreSkippedWithoutDesyncingTheStream()
        {
            string source = CreateTree(new Dictionary<string, byte[]>
            {
                { "evil.txt", Random(8, 900) },
                { "rooted.txt", Random(9, 900) },
                { "ok.txt", Random(10, 900) },
            });

            // The writer takes paths as given, so hand-craft hostile ones.
            byte[] payload = Pack(
                source,
                new List<RmpkSourceFile>
                {
                    new RmpkSourceFile { FullPath = Path.Combine(source, "evil.txt"), RelativePath = "../evil.txt" },
                    new RmpkSourceFile { FullPath = Path.Combine(source, "rooted.txt"), RelativePath = "/rooted-by-test.txt" },
                    new RmpkSourceFile { FullPath = Path.Combine(source, "ok.txt"), RelativePath = "ok.txt" },
                });
            string install = Path.Combine(_root, "install");

            PayloadExtractionResult result = Extract(payload, install, 2);

            Assert.Equal(1, result.FileCount);
            Assert.Equal(2, result.SkippedCount);
            Assert.False(File.Exists(Path.Combine(_root, "evil.txt")));
            Assert.False(File.Exists(Path.Combine(Path.GetPathRoot(_root), "rooted-by-test.txt")));
            Assert.Equal(
                File.ReadAllBytes(Path.Combine(source, "ok.txt")),
                File.ReadAllBytes(Path.Combine(install, "ok.txt")));
        }

        [Fact]
        public void LockedDestination_IsRetriedThenReported()
        {
            string source = CreateTree(new Dictionary<string, byte[]> { { "RalphMeet.exe", Random(11, 300) } });
            byte[] payload = Pack(source, EnumerateRelative(source));
            string install = Path.Combine(_root, "install");
            Directory.CreateDirectory(install);
            string locked = Path.Combine(install, "RalphMeet.exe");
            string reported = null;

            using (new FileStream(locked, FileMode.Create, FileAccess.ReadWrite, FileShare.None))
            {
                Assert.ThrowsAny<IOException>(() =>
                    PayloadExtractor.Extract(
                        new MemoryStream(payload),
                        install,
                        2,
                        0,
                        path => reported = path));
            }

            Assert.Equal(Path.GetFullPath(locked), reported);
        }

        private PayloadExtractionResult Extract(byte[] payload, string install, int parallel)
        {
            return PayloadExtractor.Extract(new MemoryStream(payload), install, parallel, 0);
        }

        private static byte[] Pack(string root, IList<string> relativePaths)
        {
            return Pack(
                root,
                relativePaths
                    .Select(r => new RmpkSourceFile { RelativePath = r, FullPath = Path.Combine(root, r) })
                    .ToList());
        }

        private static byte[] Pack(string root, IList<RmpkSourceFile> files)
        {
            using (MemoryStream ms = new MemoryStream())
            {
                RmpkWriter.Write(files, ms, new RmpkWriteOptions
                {
                    BlockSize = TinyBlock,
                    DictionarySize = TinyBlock,
                    FastBytes = 32,
                    MaxParallel = 3,
                });
                return ms.ToArray();
            }
        }

        private string CreateTree(Dictionary<string, byte[]> files)
        {
            string dir = Path.Combine(_root, "src" + Guid.NewGuid().ToString("N").Substring(0, 6));
            foreach (KeyValuePair<string, byte[]> file in files)
            {
                string path = Path.Combine(dir, file.Key.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllBytes(path, file.Value);
            }

            return dir;
        }

        private static List<string> EnumerateRelative(string dir)
        {
            return Directory
                .EnumerateFiles(dir, "*", SearchOption.AllDirectories)
                .Select(f => f.Substring(dir.Length).TrimStart('\\', '/').Replace('\\', '/'))
                .OrderBy(f => f, StringComparer.Ordinal)
                .ToList();
        }

        private static byte[] Random(int seed, int length)
        {
            byte[] data = new byte[length];
            new System.Random(seed).NextBytes(data);
            return data;
        }

        // Repetitive enough that LZMA actually matches across the dictionary.
        private static byte[] Compressible(int seed, int length)
        {
            System.Random rng = new System.Random(seed);
            byte[] data = new byte[length];
            for (int i = 0; i < length; i++)
            {
                data[i] = (byte)(rng.Next(4) + 'a');
            }

            return data;
        }

        private sealed class RmpkHeaderProbe
        {
            public RmpkHeaderProbe(byte[] payload)
            {
                BlockCount = RmpkFormat.ReadHeader(new MemoryStream(payload)).Blocks.Count;
            }

            public int BlockCount { get; private set; }
        }
    }
}
