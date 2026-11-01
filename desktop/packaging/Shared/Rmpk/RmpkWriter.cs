using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace RalphMeet.Packaging
{
    public sealed class RmpkSourceFile
    {
        public string RelativePath;
        public string FullPath;
    }

    public sealed class RmpkWriteOptions
    {
        public int BlockSize = RmpkFormat.DefaultBlockSize;
        public int DictionarySize = RmpkFormat.DefaultBlockSize;
        public int FastBytes = 64;
        public int MaxParallel = Math.Max(1, Environment.ProcessorCount);
    }

    public static class RmpkWriter
    {
        // Packs the given files, in order, into one RMPK container. Compressed
        // blocks are held in memory until the header (which records their
        // sizes) can be written in front of them.
        public static RmpkHeader Write(IList<RmpkSourceFile> files, Stream output, RmpkWriteOptions options)
        {
            RmpkHeader header = new RmpkHeader { BlockSize = options.BlockSize };
            foreach (RmpkSourceFile f in files)
            {
                header.Files.Add(new RmpkFileEntry
                {
                    Path = f.RelativePath.Replace('\\', '/'),
                    Size = new FileInfo(f.FullPath).Length,
                });
                header.TotalSize += header.Files[header.Files.Count - 1].Size;
            }

            List<Task<CompressedBlock>> tasks = new List<Task<CompressedBlock>>();
            using (SemaphoreSlim slots = new SemaphoreSlim(Math.Max(1, options.MaxParallel)))
            {
                byte[] buffer = null;
                int filled = 0;

                Action flush = () =>
                {
                    byte[] raw = buffer;
                    int rawLength = filled;
                    buffer = null;
                    filled = 0;
                    tasks.Add(Task.Run(() =>
                    {
                        try
                        {
                            return Compress(raw, rawLength, options);
                        }
                        finally
                        {
                            slots.Release();
                        }
                    }));
                };

                for (int i = 0; i < files.Count; i++)
                {
                    long remaining = header.Files[i].Size;
                    using (FileStream fs = new FileStream(files[i].FullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16))
                    {
                        while (remaining > 0)
                        {
                            if (buffer == null)
                            {
                                slots.Wait();
                                buffer = new byte[options.BlockSize];
                            }

                            int want = (int)Math.Min(remaining, buffer.Length - filled);
                            int n = fs.Read(buffer, filled, want);
                            if (n <= 0)
                            {
                                throw new IOException("File changed size while packing: " + files[i].FullPath);
                            }

                            filled += n;
                            remaining -= n;
                            if (filled == buffer.Length)
                            {
                                flush();
                            }
                        }
                    }
                }

                if (buffer != null && filled > 0)
                {
                    flush();
                }

                Task.WaitAll(tasks.ToArray());
            }

            foreach (Task<CompressedBlock> t in tasks)
            {
                CompressedBlock c = t.Result;
                header.Blocks.Add(new RmpkBlockEntry
                {
                    CompressedLength = c.Data.Length,
                    RawLength = c.RawLength,
                    Properties = c.Properties,
                    Sha256 = c.Sha256,
                });
            }

            byte[] headerBytes = RmpkFormat.SerializeHeader(header);
            output.Write(headerBytes, 0, headerBytes.Length);
            foreach (Task<CompressedBlock> t in tasks)
            {
                output.Write(t.Result.Data, 0, t.Result.Data.Length);
            }

            return header;
        }

        private static CompressedBlock Compress(byte[] raw, int rawLength, RmpkWriteOptions options)
        {
            byte[] props;
            byte[] data = RmpkLzma.Compress(raw, rawLength, options.DictionarySize, options.FastBytes, out props);
            return new CompressedBlock
            {
                Data = data,
                RawLength = rawLength,
                Properties = props,
                Sha256 = RmpkFormat.Sha(raw, 0, rawLength),
            };
        }

        private sealed class CompressedBlock
        {
            public byte[] Data;
            public int RawLength;
            public byte[] Properties;
            public byte[] Sha256;
        }
    }
}
