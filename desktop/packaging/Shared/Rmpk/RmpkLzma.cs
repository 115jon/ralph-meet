using System.IO;
using SevenZip;
using SevenZip.Compression.LZMA;

namespace RalphMeet.Packaging
{
    // Thin wrappers over the vendored LZMA SDK for single-block streams.
    public static class RmpkLzma
    {
        public static byte[] Compress(byte[] raw, int rawLength, int dictionarySize, int fastBytes, out byte[] properties)
        {
            Encoder encoder = new Encoder();
            encoder.SetCoderProperties(
                new[] { CoderPropID.DictionarySize, CoderPropID.NumFastBytes, CoderPropID.EndMarker },
                new object[] { dictionarySize, fastBytes, false });

            using (MemoryStream props = new MemoryStream())
            using (MemoryStream output = new MemoryStream(rawLength / 2 + 1024))
            {
                encoder.WriteCoderProperties(props);
                properties = props.ToArray();
                encoder.Code(new MemoryStream(raw, 0, rawLength, false), output, rawLength, -1, null);
                return output.ToArray();
            }
        }

        public static byte[] Decompress(byte[] compressed, int compressedLength, byte[] properties, int rawLength)
        {
            byte[] raw = new byte[rawLength];
            Decoder decoder = new Decoder();
            decoder.SetDecoderProperties(properties);
            using (MemoryStream output = new MemoryStream(raw, true))
            {
                decoder.Code(new MemoryStream(compressed, 0, compressedLength, false), output, compressedLength, rawLength, null);
                if (output.Position != rawLength)
                {
                    throw new RmpkFormatException("LZMA block decoded to an unexpected length.");
                }
            }

            return raw;
        }
    }
}
