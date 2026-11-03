using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using RalphMeet.Packaging;

namespace Installer
{
    public sealed class PayloadExtractionResult
    {
        public int FileCount { get; set; }
        public int SkippedCount { get; set; }
        public long TotalBytes { get; set; }
    }

    // Unpacks an RMPK payload (see RmpkFormat) into an install directory.
    public static class PayloadExtractor
    {
        private const int MaxAttempts = 5;

        // Each block in flight holds its raw bytes, the LZMA window and the
        // compressed bytes (~2.5x the block size), so keep this small.
        public static int DefaultMaxParallel
        {
            get { return Math.Max(2, Math.Min(Environment.ProcessorCount, 4)); }
        }

        public static PayloadExtractionResult Extract(
            Stream payload,
            string installDir,
            int maxParallel = 0,
            int retryDelayMilliseconds = 1000,
            Action<string> onPermanentFailure = null)
        {
            string installRoot = EnsureTrailingSeparator(Path.GetFullPath(installDir));
            RmpkHeader header = RmpkFormat.ReadHeader(payload);
            InstallerLogger.Info("Payload entry count: " + header.Files.Count);
            InstallerLogger.Info("Payload size: " + header.TotalSize + " bytes in " + header.Blocks.Count + " blocks");

            PayloadExtractionResult result = new PayloadExtractionResult();
            Stopwatch stopwatch = Stopwatch.StartNew();
            long processed = 0;
            InstallProgress.ReportPayload(0, header.TotalSize);
            using (IEnumerator<byte[]> blocks = RmpkReader.DecodeBlocks(
                payload,
                header,
                maxParallel > 0 ? maxParallel : DefaultMaxParallel).GetEnumerator())
            {
                byte[] block = null;
                int blockOffset = 0;

                // Copies the next `count` payload bytes to `target` (null to skip them).
                Action<Stream, long> copy = (target, count) =>
                {
                    while (count > 0)
                    {
                        if (block == null || blockOffset == block.Length)
                        {
                            if (!blocks.MoveNext())
                            {
                                throw new RmpkFormatException("Payload ended before all files were written.");
                            }

                            block = blocks.Current;
                            blockOffset = 0;
                        }

                        int n = (int)Math.Min(count, block.Length - blockOffset);
                        if (target != null)
                        {
                            target.Write(block, blockOffset, n);
                        }

                        blockOffset += n;
                        count -= n;
                        processed += n;
                        InstallProgress.ReportPayload(processed, header.TotalSize);
                    }
                };

                foreach (RmpkFileEntry entry in header.Files)
                {
                    string destinationPath = Path.GetFullPath(Path.Combine(installRoot, entry.Path.Replace('/', Path.DirectorySeparatorChar)));
                    if (!destinationPath.StartsWith(installRoot, StringComparison.OrdinalIgnoreCase))
                    {
                        InstallerLogger.Warn("Skipping payload entry outside the install directory: " + entry.Path);
                        copy(null, entry.Size);
                        result.SkippedCount++;
                        continue;
                    }

                    Directory.CreateDirectory(Path.GetDirectoryName(destinationPath));
                    using (FileStream output = OpenForWrite(entry.Path, destinationPath, retryDelayMilliseconds, onPermanentFailure))
                    {
                        copy(output, entry.Size);
                    }

                    result.FileCount++;
                    result.TotalBytes += entry.Size;
                }
            }

            InstallerLogger.Info(
                "Payload extraction wrote " + result.FileCount + " files (" + result.TotalBytes +
                " bytes, " + result.SkippedCount + " skipped) in " + stopwatch.ElapsedMilliseconds + " ms.");
            return result;
        }

        private static FileStream OpenForWrite(
            string entryPath,
            string destinationPath,
            int retryDelayMilliseconds,
            Action<string> onPermanentFailure)
        {
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    return new FileStream(destinationPath, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16);
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    InstallerLogger.Warn(
                        "Failed to extract " + entryPath + " to " + destinationPath +
                        " (attempt " + attempt + "/" + MaxAttempts + "): " + ex.Message);

                    if (attempt == MaxAttempts)
                    {
                        InstallerLogger.Error("Payload extraction permanently failed for " + destinationPath, ex);
                        if (onPermanentFailure != null)
                        {
                            onPermanentFailure(destinationPath);
                        }

                        throw;
                    }

                    Thread.Sleep(retryDelayMilliseconds);
                }
            }
        }

        private static string EnsureTrailingSeparator(string path)
        {
            return path.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
                ? path
                : path + Path.DirectorySeparatorChar;
        }
    }
}
