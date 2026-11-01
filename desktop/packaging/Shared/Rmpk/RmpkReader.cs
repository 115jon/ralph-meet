using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;

namespace RalphMeet.Packaging
{
    public static class RmpkReader
    {
        // Yields the raw bytes of each block in order. Up to maxParallel blocks
        // are read ahead and decoded concurrently; every block is checked
        // against its SHA-256 before it is handed out, so corruption throws
        // RmpkFormatException instead of producing bad files.
        public static IEnumerable<byte[]> DecodeBlocks(Stream payload, RmpkHeader header, int maxParallel)
        {
            Queue<Task<byte[]>> pending = new Queue<Task<byte[]>>();
            int next = 0;
            try
            {
                while (next < header.Blocks.Count || pending.Count > 0)
                {
                    while (next < header.Blocks.Count && pending.Count < Math.Max(1, maxParallel))
                    {
                        int index = next++;
                        RmpkBlockEntry block = header.Blocks[index];
                        byte[] compressed = new byte[block.CompressedLength];
                        RmpkFormat.ReadExactly(payload, compressed, compressed.Length);
                        pending.Enqueue(Task.Run(() => DecodeBlock(index, block, compressed)));
                    }

                    yield return pending.Dequeue().GetAwaiter().GetResult();
                }
            }
            finally
            {
                // Stopped early (error or abandoned enumeration): let in-flight
                // decodes finish so nothing keeps running after we return.
                try
                {
                    Task.WaitAll(pending.ToArray());
                }
                catch (AggregateException)
                {
                }
            }
        }

        private static byte[] DecodeBlock(int index, RmpkBlockEntry block, byte[] compressed)
        {
            byte[] raw;
            try
            {
                raw = RmpkLzma.Decompress(compressed, compressed.Length, block.Properties, block.RawLength);
            }
            catch (RmpkFormatException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new RmpkFormatException("Payload block " + index + " could not be decoded: " + ex.Message);
            }

            if (!RmpkFormat.ByteEquals(RmpkFormat.Sha(raw, 0, raw.Length), block.Sha256))
            {
                throw new RmpkFormatException("Payload block " + index + " failed its checksum (corrupt installer).");
            }

            return raw;
        }
    }
}
