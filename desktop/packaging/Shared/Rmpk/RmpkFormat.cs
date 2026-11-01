using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace RalphMeet.Packaging
{
    // RMPK payload container (version 1). All integers are little-endian.
    //
    //   header
    //     char[4]  magic "RMPK"
    //     u32      version (1)
    //     u32      blockSize        raw bytes per block (the last block may be shorter)
    //     u32      fileCount
    //     u32      blockCount
    //     u64      totalSize        sum of all file sizes == sum of all block raw lengths
    //     file[fileCount]
    //       u16    pathLength       UTF-8 bytes
    //       bytes  path             relative, '/' separated
    //       u64    size
    //     block[blockCount]
    //       u32    compressedLength
    //       u32    rawLength
    //       u8[5]  lzmaProperties   lc/lp/pb byte + u32 dictionary size
    //       u8[32] sha256           of the raw block bytes
    //     u8[32]   headerSha256     of every header byte above
    //   block payloads, concatenated in block order (raw LZMA streams, no end marker)
    //
    // Files are laid out back to back in table order to form one logical byte
    // stream, which is cut into independently LZMA-compressed blocks. Blocks do
    // not share a dictionary, so they can be decoded in parallel.
    public sealed class RmpkFileEntry
    {
        public string Path;
        public long Size;
    }

    public sealed class RmpkBlockEntry
    {
        public int CompressedLength;
        public int RawLength;
        public byte[] Properties;
        public byte[] Sha256;
    }

    public sealed class RmpkHeader
    {
        public int BlockSize;
        public long TotalSize;
        public List<RmpkFileEntry> Files = new List<RmpkFileEntry>();
        public List<RmpkBlockEntry> Blocks = new List<RmpkBlockEntry>();
    }

    public sealed class RmpkFormatException : Exception
    {
        public RmpkFormatException(string message) : base(message) { }
    }

    public static class RmpkFormat
    {
        public const uint Version = 1;
        public const int PropertiesLength = 5;
        public const int HashLength = 32;
        public const int DefaultBlockSize = 48 * 1024 * 1024;

        private static readonly byte[] Magic = { (byte)'R', (byte)'M', (byte)'P', (byte)'K' };

        public static byte[] SerializeHeader(RmpkHeader header)
        {
            using (MemoryStream ms = new MemoryStream())
            using (BinaryWriter w = new BinaryWriter(ms))
            {
                w.Write(Magic);
                w.Write(Version);
                w.Write((uint)header.BlockSize);
                w.Write((uint)header.Files.Count);
                w.Write((uint)header.Blocks.Count);
                w.Write((ulong)header.TotalSize);
                foreach (RmpkFileEntry f in header.Files)
                {
                    byte[] path = Encoding.UTF8.GetBytes(f.Path);
                    if (path.Length == 0 || path.Length > ushort.MaxValue)
                    {
                        throw new RmpkFormatException("Invalid entry path length: " + f.Path);
                    }

                    w.Write((ushort)path.Length);
                    w.Write(path);
                    w.Write((ulong)f.Size);
                }

                foreach (RmpkBlockEntry b in header.Blocks)
                {
                    w.Write((uint)b.CompressedLength);
                    w.Write((uint)b.RawLength);
                    w.Write(b.Properties);
                    w.Write(b.Sha256);
                }

                w.Flush();
                byte[] body = ms.ToArray();
                byte[] digest = Sha(body, 0, body.Length);
                byte[] result = new byte[body.Length + digest.Length];
                Buffer.BlockCopy(body, 0, result, 0, body.Length);
                Buffer.BlockCopy(digest, 0, result, body.Length, digest.Length);
                return result;
            }
        }

        // Reads and validates the header, leaving the stream positioned at the
        // first block payload.
        public static RmpkHeader ReadHeader(Stream stream)
        {
            using (SHA256 hash = SHA256.Create())
            {
                Func<int, byte[]> take = count =>
                {
                    byte[] buffer = new byte[count];
                    ReadExactly(stream, buffer, count);
                    hash.TransformBlock(buffer, 0, count, null, 0);
                    return buffer;
                };

                if (!ByteEquals(take(4), Magic))
                {
                    throw new RmpkFormatException("Not an RMPK payload (bad magic).");
                }

                uint version = BitConverter.ToUInt32(take(4), 0);
                if (version != Version)
                {
                    throw new RmpkFormatException("Unsupported RMPK version " + version + ".");
                }

                RmpkHeader header = new RmpkHeader();
                uint blockSize = BitConverter.ToUInt32(take(4), 0);
                uint fileCount = BitConverter.ToUInt32(take(4), 0);
                uint blockCount = BitConverter.ToUInt32(take(4), 0);
                ulong totalSize = BitConverter.ToUInt64(take(8), 0);
                if (blockSize == 0 || blockSize > int.MaxValue || totalSize > long.MaxValue)
                {
                    throw new RmpkFormatException("RMPK header has invalid sizes.");
                }

                header.BlockSize = (int)blockSize;
                header.TotalSize = (long)totalSize;

                long fileSum = 0;
                for (uint i = 0; i < fileCount; i++)
                {
                    int pathLength = BitConverter.ToUInt16(take(2), 0);
                    if (pathLength == 0)
                    {
                        throw new RmpkFormatException("RMPK file table contains an empty path.");
                    }

                    string path = Encoding.UTF8.GetString(take(pathLength));
                    ulong size = BitConverter.ToUInt64(take(8), 0);
                    if (size > long.MaxValue || (fileSum += (long)size) < 0)
                    {
                        throw new RmpkFormatException("RMPK file table is invalid.");
                    }

                    header.Files.Add(new RmpkFileEntry { Path = path, Size = (long)size });
                }

                long rawSum = 0;
                for (uint i = 0; i < blockCount; i++)
                {
                    uint compressed = BitConverter.ToUInt32(take(4), 0);
                    uint raw = BitConverter.ToUInt32(take(4), 0);
                    if (compressed > int.MaxValue || raw == 0 || raw > blockSize)
                    {
                        throw new RmpkFormatException("RMPK block table is invalid.");
                    }

                    header.Blocks.Add(new RmpkBlockEntry
                    {
                        CompressedLength = (int)compressed,
                        RawLength = (int)raw,
                        Properties = take(PropertiesLength),
                        Sha256 = take(HashLength),
                    });
                    rawSum += raw;
                }

                if (fileSum != header.TotalSize || rawSum != header.TotalSize)
                {
                    throw new RmpkFormatException("RMPK header sizes are inconsistent.");
                }

                hash.TransformFinalBlock(new byte[0], 0, 0);
                byte[] actual = new byte[HashLength];
                ReadExactly(stream, actual, actual.Length);
                if (!ByteEquals(hash.Hash, actual))
                {
                    throw new RmpkFormatException("RMPK header checksum mismatch.");
                }

                return header;
            }
        }

        public static byte[] Sha(byte[] data, int offset, int count)
        {
            using (SHA256 sha = SHA256.Create())
            {
                return sha.ComputeHash(data, offset, count);
            }
        }

        public static bool ByteEquals(byte[] a, byte[] b)
        {
            if (a.Length != b.Length)
            {
                return false;
            }

            int diff = 0;
            for (int i = 0; i < a.Length; i++)
            {
                diff |= a[i] ^ b[i];
            }

            return diff == 0;
        }

        public static void ReadExactly(Stream stream, byte[] buffer, int count)
        {
            int read = 0;
            while (read < count)
            {
                int n = stream.Read(buffer, read, count - read);
                if (n <= 0)
                {
                    throw new RmpkFormatException("Unexpected end of RMPK payload.");
                }

                read += n;
            }
        }
    }
}
