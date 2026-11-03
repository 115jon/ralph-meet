using System;

namespace Installer
{
    /// <summary>
    /// Progress the setup window listens to. Reporting is a side channel only: nothing in the
    /// install depends on a listener, and events are raised on the extracting thread.
    /// </summary>
    public static class InstallProgress
    {
        /// <summary>Payload bytes written (or skipped) so far, and the payload's total size.</summary>
        public static event Action<long, long> PayloadProgress;

        internal static void ReportPayload(long done, long total)
        {
            Action<long, long> handler = PayloadProgress;
            if (handler == null)
            {
                return;
            }

            try
            {
                handler(done, total);
            }
            catch (Exception ex)
            {
                InstallerLogger.Warn("Progress listener failed: " + ex.Message);
            }
        }
    }
}
