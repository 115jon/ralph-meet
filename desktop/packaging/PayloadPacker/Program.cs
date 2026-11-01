using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using RalphMeet.Packaging;

namespace PayloadPacker
{
    // PayloadPacker pack    <stageDir> <out.rmpk> [--block-mb N] [--dict-mb N] [--fast-bytes N] [--threads N]
    // PayloadPacker extract <in.rmpk> <outDir> [--threads N]
    // PayloadPacker verify  <in.rmpk> <stageDir> [--threads N]
    internal static class Program
    {
        private static int Main(string[] args)
        {
            try
            {
                if (args.Length < 3)
                {
                    return Usage();
                }

                Dictionary<string, int> options = ParseOptions(args.Skip(3).ToArray());
                switch (args[0])
                {
                    case "pack":
                        return Pack(args[1], args[2], options);
                    case "extract":
                        return Extract(args[1], args[2], options, false);
                    case "verify":
                        return Extract(args[1], args[2], options, true);
                    default:
                        return Usage();
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("PayloadPacker failed: " + ex.Message);
                return 1;
            }
        }

        private static int Usage()
        {
            Console.Error.WriteLine("usage: PayloadPacker pack <stageDir> <out.rmpk> [--block-mb N] [--dict-mb N] [--fast-bytes N] [--threads N]");
            Console.Error.WriteLine("       PayloadPacker extract <in.rmpk> <outDir> [--threads N]");
            Console.Error.WriteLine("       PayloadPacker verify <in.rmpk> <stageDir> [--threads N]");
            return 2;
        }

        private static Dictionary<string, int> ParseOptions(string[] args)
        {
            Dictionary<string, int> map = new Dictionary<string, int>();
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                map[args[i]] = int.Parse(args[i + 1]);
            }

            return map;
        }

        private static int Pack(string stageDir, string output, Dictionary<string, int> opts)
        {
            string root = Path.GetFullPath(stageDir);
            if (!Directory.Exists(root))
            {
                throw new DirectoryNotFoundException("Stage directory not found: " + root);
            }

            List<RmpkSourceFile> files = Directory
                .EnumerateFiles(root, "*", SearchOption.AllDirectories)
                .Select(full => new RmpkSourceFile
                {
                    FullPath = full,
                    RelativePath = full.Substring(root.Length).TrimStart('\\', '/').Replace('\\', '/'),
                })
                .OrderBy(f => f.RelativePath, StringComparer.Ordinal)
                .ToList();
            if (files.Count == 0)
            {
                throw new InvalidOperationException("Stage directory is empty: " + root);
            }

            RmpkWriteOptions options = new RmpkWriteOptions();
            int blockMb;
            if (opts.TryGetValue("--block-mb", out blockMb))
            {
                options.BlockSize = blockMb * 1024 * 1024;
                options.DictionarySize = options.BlockSize;
            }

            int dictMb;
            if (opts.TryGetValue("--dict-mb", out dictMb))
            {
                options.DictionarySize = dictMb * 1024 * 1024;
            }

            int fast;
            if (opts.TryGetValue("--fast-bytes", out fast))
            {
                options.FastBytes = fast;
            }

            int threads;
            if (opts.TryGetValue("--threads", out threads))
            {
                options.MaxParallel = threads;
            }

            string outputPath = Path.GetFullPath(output);
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
            Stopwatch sw = Stopwatch.StartNew();
            RmpkHeader header;
            using (FileStream fs = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                header = RmpkWriter.Write(files, fs, options);
            }

            long packed = new FileInfo(outputPath).Length;
            Console.WriteLine(
                "Packed " + files.Count + " files, " + header.TotalSize + " bytes -> " + packed + " bytes (" +
                (100.0 * packed / header.TotalSize).ToString("F1") + "%), " + header.Blocks.Count + " blocks of " +
                (options.BlockSize >> 20) + " MiB, dict " + (options.DictionarySize >> 20) + " MiB, " +
                sw.Elapsed.TotalSeconds.ToString("F1") + " s");
            return 0;
        }

        // Decodes the payload; with verifyOnly, compares against an existing
        // tree instead of writing one.
        private static int Extract(string payloadPath, string dir, Dictionary<string, int> opts, bool verifyOnly)
        {
            int threads;
            if (!opts.TryGetValue("--threads", out threads))
            {
                threads = Math.Max(2, Math.Min(Environment.ProcessorCount, 4));
            }

            Stopwatch sw = Stopwatch.StartNew();
            int count = 0;
            using (FileStream payload = File.OpenRead(payloadPath))
            {
                RmpkHeader header = RmpkFormat.ReadHeader(payload);
                if (verifyOnly)
                {
                    int onDisk = Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).Count();
                    if (onDisk != header.Files.Count)
                    {
                        throw new InvalidDataException("Payload has " + header.Files.Count + " files but " + dir + " has " + onDisk + ".");
                    }
                }

                IEnumerator<byte[]> blocks = RmpkReader.DecodeBlocks(payload, header, threads).GetEnumerator();
                byte[] block = null;
                int offset = 0;
                byte[] scratch = new byte[1 << 20];

                foreach (RmpkFileEntry entry in header.Files)
                {
                    string path = Path.GetFullPath(Path.Combine(dir, entry.Path));
                    if (!verifyOnly)
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(path));
                    }

                    using (Stream target = verifyOnly
                        ? (Stream)new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16)
                        : new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16))
                    {
                        if (verifyOnly && target.Length != entry.Size)
                        {
                            throw new InvalidDataException("Size mismatch for " + entry.Path);
                        }

                        long remaining = entry.Size;
                        while (remaining > 0)
                        {
                            if (block == null || offset == block.Length)
                            {
                                if (!blocks.MoveNext())
                                {
                                    throw new InvalidDataException("Payload ended early.");
                                }

                                block = blocks.Current;
                                offset = 0;
                            }

                            int n = (int)Math.Min(remaining, block.Length - offset);
                            if (verifyOnly)
                            {
                                int done = 0;
                                while (done < n)
                                {
                                    int read = target.Read(scratch, 0, Math.Min(scratch.Length, n - done));
                                    if (read <= 0)
                                    {
                                        throw new InvalidDataException("Short file " + entry.Path);
                                    }

                                    for (int i = 0; i < read; i++)
                                    {
                                        if (scratch[i] != block[offset + done + i])
                                        {
                                            throw new InvalidDataException("Content mismatch in " + entry.Path);
                                        }
                                    }

                                    done += read;
                                }
                            }
                            else
                            {
                                target.Write(block, offset, n);
                            }

                            offset += n;
                            remaining -= n;
                        }
                    }

                    count++;
                }

                blocks.Dispose();
            }

            Console.WriteLine(
                (verifyOnly ? "Verified " : "Extracted ") + count + " files in " +
                sw.Elapsed.TotalSeconds.ToString("F1") + " s (" + threads + " decode threads)");
            return 0;
        }
    }
}
