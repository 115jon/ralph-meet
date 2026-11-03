using System;
using System.IO;
using System.Linq;

namespace Installer
{
    /// <summary>
    /// The native stub at the install root (Yap.exe). Every payload carries it as
    /// YapLauncher.exe; each activation copies it to the root. Shortcuts, the Run key,
    /// the yap:// handler and taskbar pins point at the root copy, which starts
    /// the active app-&lt;version&gt;\Yap.exe. See docs/desktop/launch.md.
    /// </summary>
    public static class RootLauncher
    {
        public const string PayloadFileName = "YapLauncher.exe";
        public const string OldSuffix = ".old";

        /// <summary>The AppUserModelID shared by the shortcuts, the app window and its toasts (the Tauri identifier).</summary>
        public const string AppUserModelId = "com.115jon.yap";

        /// <summary>
        /// Installs or refreshes the root stub from the active version directory. A locked stub
        /// (for example one that is still starting the app) is renamed to Yap.exe.old and
        /// replaced; the .old copy is deleted on a later activation. If the stub can be neither
        /// replaced nor renamed, the existing one is kept: it reads current.json, so it still
        /// starts the new version. Returns true when the root stub exists afterwards.
        /// </summary>
        public static bool Refresh(InstallRootLayout layout, string activeDirectoryPath)
        {
            if (layout == null)
            {
                throw new ArgumentNullException(nameof(layout));
            }

            DeleteOldCopies(layout);

            string sourcePath = Path.Combine(activeDirectoryPath ?? string.Empty, PayloadFileName);
            string stubPath = layout.RootStubPath;
            if (!File.Exists(sourcePath))
            {
                InstallerLogger.Warn("Payload has no " + PayloadFileName + "; keeping the existing root launcher.");
                return File.Exists(stubPath);
            }

            if (File.Exists(stubPath) && FilesEqual(sourcePath, stubPath))
            {
                InstallerLogger.Info("Root launcher is already current: " + stubPath);
                return true;
            }

            string tempPath = stubPath + ".new";
            try
            {
                File.Copy(sourcePath, tempPath, true);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                InstallerLogger.Warn("Could not stage the root launcher at " + tempPath + ": " + ex.Message);
                return File.Exists(stubPath);
            }

            if (File.Exists(stubPath) && !TryDelete(stubPath) && !TryMoveAside(stubPath))
            {
                InstallerLogger.Warn(
                    "Root launcher is locked and could not be moved aside; keeping the existing one at " + stubPath + "." +
                    Environment.NewLine + FileLockDiagnostics.DescribeLockingProcesses(stubPath));
                TryDelete(tempPath);
                return true;
            }

            try
            {
                File.Move(tempPath, stubPath);
                InstallerLogger.Info("Installed root launcher " + stubPath + " from " + sourcePath);
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                InstallerLogger.Warn("Could not move the root launcher into place: " + ex.Message);
                TryDelete(tempPath);
                return File.Exists(stubPath);
            }
        }

        /// <summary>Deletes Yap.exe.old copies left by earlier swaps, skipping any still in use.</summary>
        public static void DeleteOldCopies(InstallRootLayout layout)
        {
            if (!Directory.Exists(layout.RootPath))
            {
                return;
            }

            foreach (string path in Directory.GetFiles(layout.RootPath, InstallRootLayout.RootStubFileName + "*" + OldSuffix))
            {
                if (TryDelete(path))
                {
                    InstallerLogger.Info("Deleted previous root launcher " + path);
                }
            }
        }

        /// <summary>The command that starts the app: the root stub, or Update.exe for installs without one.</summary>
        public static void ResolveEntryPoint(InstallRootLayout layout, out string executablePath, out string arguments)
        {
            if (File.Exists(layout.RootStubPath))
            {
                executablePath = layout.RootStubPath;
                arguments = string.Empty;
                return;
            }

            executablePath = layout.UpdateExePath;
            arguments = LaunchCurrentVersion.ProcessStartSwitch + " " + layout.ExecutableFileName;
        }

        /// <summary>
        /// Rename first to Yap.exe.old, like Squirrel's Discord.exe.old; if a still-locked
        /// .old is in the way, use a unique name instead.
        /// </summary>
        private static bool TryMoveAside(string stubPath)
        {
            string oldPath = stubPath + OldSuffix;
            if (File.Exists(oldPath) && !TryDelete(oldPath))
            {
                oldPath = stubPath + "." + Guid.NewGuid().ToString("N") + OldSuffix;
            }

            try
            {
                File.Move(stubPath, oldPath);
                InstallerLogger.Info("Root launcher was locked; moved it aside to " + oldPath);
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                InstallerLogger.Warn("Could not move the locked root launcher aside: " + ex.Message);
                return false;
            }
        }

        private static bool TryDelete(string path)
        {
            try
            {
                File.Delete(path);
                return !File.Exists(path);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                return false;
            }
        }

        private static bool FilesEqual(string left, string right)
        {
            FileInfo leftInfo = new FileInfo(left);
            FileInfo rightInfo = new FileInfo(right);
            if (leftInfo.Length != rightInfo.Length)
            {
                return false;
            }

            try
            {
                return File.ReadAllBytes(left).SequenceEqual(File.ReadAllBytes(right));
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                return false;
            }
        }
    }
}
