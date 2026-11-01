using System;
using System.IO;
using Microsoft.Win32;

namespace Installer
{
    /// <summary>
    /// Where an install writes: the install root, the shortcut folders, the registry and the logs.
    /// Normally the real per-user locations. When RALPHMEET_SANDBOX_ROOT is set (tests and local
    /// verification only), everything is redirected next to that root, the registry goes under
    /// HKCU\Software\115jon\RalphMeetSandbox, and processes are only matched by path inside the
    /// sandbox, so a sandbox install never touches or stops the real install.
    /// </summary>
    public sealed class InstallEnvironment
    {
        public const string SandboxRootVariable = "RALPHMEET_SANDBOX_ROOT";
        public const string SandboxRegistryPath = @"Software\115jon\RalphMeetSandbox";
        public const string LegacyInstallDirectoryName = "Ralph Meet";

        private static readonly Lazy<InstallEnvironment> CurrentValue =
            new Lazy<InstallEnvironment>(() => FromSandboxRoot(Environment.GetEnvironmentVariable(SandboxRootVariable)));

        private InstallEnvironment(
            InstallRootLayout layout,
            string legacyInstallDirectory,
            string desktopDirectory,
            string programsDirectory,
            string taskbarPinsDirectory,
            string logsDirectory,
            bool isSandbox)
        {
            Layout = layout;
            LegacyInstallDirectory = legacyInstallDirectory;
            DesktopDirectory = desktopDirectory;
            ProgramsDirectory = programsDirectory;
            TaskbarPinsDirectory = taskbarPinsDirectory;
            LogsDirectory = logsDirectory;
            IsSandbox = isSandbox;
        }

        public static InstallEnvironment Current => CurrentValue.Value;

        public InstallRootLayout Layout { get; }

        public string LegacyInstallDirectory { get; }

        public string DesktopDirectory { get; }

        public string ProgramsDirectory { get; }

        public string TaskbarPinsDirectory { get; }

        public string LogsDirectory { get; }

        /// <summary>True when redirected by RALPHMEET_SANDBOX_ROOT.</summary>
        public bool IsSandbox { get; }

        /// <summary>HKCU, or the sandbox key under it. Caller disposes.</summary>
        public RegistryKey OpenUserRoot()
        {
            return IsSandbox
                ? Registry.CurrentUser.CreateSubKey(SandboxRegistryPath)
                : Registry.CurrentUser.OpenSubKey(string.Empty, true);
        }

        public static InstallEnvironment FromSandboxRoot(string sandboxRoot)
        {
            if (!string.IsNullOrWhiteSpace(sandboxRoot))
            {
                string root = Path.GetFullPath(sandboxRoot.Trim());
                // A sibling directory, so cleanup of unknown root entries never deletes it.
                string side = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + ".sandbox";
                return new InstallEnvironment(
                    new InstallRootLayout(root),
                    Path.Combine(side, LegacyInstallDirectoryName),
                    Path.Combine(side, "Desktop"),
                    Path.Combine(side, "Programs"),
                    Path.Combine(side, "TaskBar"),
                    Path.Combine(side, "logs", "installer"),
                    true);
            }

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string roamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return new InstallEnvironment(
                InstallRootLayout.FromLocalAppData(localAppData),
                Path.Combine(localAppData, LegacyInstallDirectoryName),
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                Path.Combine(roamingAppData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
                ResolveLogsDirectory(roamingAppData, localAppData),
                false);
        }

        private static string ResolveLogsDirectory(string roamingAppData, string localAppData)
        {
            string baseDirectory = !string.IsNullOrWhiteSpace(roamingAppData)
                ? roamingAppData
                : !string.IsNullOrWhiteSpace(localAppData) ? localAppData : Path.GetTempPath();
            return Path.Combine(baseDirectory, "RalphMeet", "logs", "installer");
        }
    }
}
