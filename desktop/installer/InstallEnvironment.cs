using System;
using System.IO;
using Microsoft.Win32;

namespace Installer
{
    /// <summary>
    /// Where an install writes: the install root, the user data folder, the shortcut folders, the
    /// registry and the logs, plus where the Ralph Meet install it replaces lives. Normally the real
    /// per-user locations. When YAP_SANDBOX_ROOT (or the older RALPHMEET_SANDBOX_ROOT) is set (tests
    /// and local verification only), everything is redirected next to that root, the registry goes
    /// under HKCU\Software\115jon\YapSandbox, and processes are only matched by path inside the
    /// sandbox, so a sandbox install never touches or stops the real install.
    /// </summary>
    public sealed class InstallEnvironment
    {
        public const string SandboxRootVariable = "YAP_SANDBOX_ROOT";

        /// <summary>Still honored, so an old verification script never reaches the real install.</summary>
        public const string LegacySandboxRootVariable = "RALPHMEET_SANDBOX_ROOT";

        public const string SandboxRegistryPath = @"Software\115jon\YapSandbox";
        public const string LegacyInstallDirectoryName = "Ralph Meet";

        /// <summary>The roaming user data folder (%APPDATA%\Yap): CEF profile, settings, window state.</summary>
        public const string DataDirectoryName = "Yap";

        /// <summary>The Ralph Meet user data folder that LegacyCleanup moves into DataDirectoryName.</summary>
        public const string LegacyDataDirectoryName = "RalphMeet";

        /// <summary>The Tauri identifier folder of Ralph Meet builds (%LOCALAPPDATA%\site.115jon.ralphmeet).</summary>
        public const string LegacyIdentifierDirectoryName = "site.115jon.ralphmeet";

        /// <summary>The identifier folders of the builds before Ralph Meet (local and roaming).</summary>
        public const string PreRalphMeetDirectoryName = "dev.jontitor.ralph-meet";

        private static readonly Lazy<InstallEnvironment> CurrentValue =
            new Lazy<InstallEnvironment>(() => FromSandboxRoot(ResolveSandboxRoot()));

        private InstallEnvironment(
            InstallRootLayout layout,
            InstallRootLayout legacyLayout,
            string legacyInstallDirectory,
            string dataDirectory,
            string legacyDataDirectory,
            string desktopDirectory,
            string programsDirectory,
            string taskbarPinsDirectory,
            string logsDirectory,
            string localAppData,
            string roamingAppData,
            bool isSandbox)
        {
            LegacyIdentifierDirectory = Path.Combine(localAppData, LegacyIdentifierDirectoryName);
            PreRalphMeetDirectories = new[]
            {
                Path.Combine(localAppData, PreRalphMeetDirectoryName),
                Path.Combine(roamingAppData, PreRalphMeetDirectoryName)
            };
            Layout = layout;
            LegacyLayout = legacyLayout;
            LegacyInstallDirectory = legacyInstallDirectory;
            DataDirectory = dataDirectory;
            LegacyDataDirectory = legacyDataDirectory;
            DesktopDirectory = desktopDirectory;
            ProgramsDirectory = programsDirectory;
            TaskbarPinsDirectory = taskbarPinsDirectory;
            LogsDirectory = logsDirectory;
            IsSandbox = isSandbox;
        }

        public static InstallEnvironment Current => CurrentValue.Value;

        public InstallRootLayout Layout { get; }

        /// <summary>The Ralph Meet install root (%LOCALAPPDATA%\RalphMeet, RalphMeet.exe).</summary>
        public InstallRootLayout LegacyLayout { get; }

        /// <summary>The oldest install folder (%LOCALAPPDATA%\Ralph Meet).</summary>
        public string LegacyInstallDirectory { get; }

        public string DataDirectory { get; }

        public string LegacyDataDirectory { get; }

        /// <summary>%LOCALAPPDATA%\site.115jon.ralphmeet: Tauri's per-identifier folder (logs, WebView2 cache).</summary>
        public string LegacyIdentifierDirectory { get; }

        /// <summary>%LOCALAPPDATA% and %APPDATA% dev.jontitor.ralph-meet, from before Ralph Meet.</summary>
        public string[] PreRalphMeetDirectories { get; }

        public string DesktopDirectory { get; }

        public string ProgramsDirectory { get; }

        public string TaskbarPinsDirectory { get; }

        public string LogsDirectory { get; }

        /// <summary>True when redirected by YAP_SANDBOX_ROOT or RALPHMEET_SANDBOX_ROOT.</summary>
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
                    new InstallRootLayout(
                        Path.Combine(side, InstallRootLayout.LegacyInstallDirectoryName),
                        InstallRootLayout.LegacyExecutableFileName),
                    Path.Combine(side, LegacyInstallDirectoryName),
                    Path.Combine(side, "Roaming", DataDirectoryName),
                    Path.Combine(side, "Roaming", LegacyDataDirectoryName),
                    Path.Combine(side, "Desktop"),
                    Path.Combine(side, "Programs"),
                    Path.Combine(side, "TaskBar"),
                    Path.Combine(side, "logs", "installer"),
                    Path.Combine(side, "Local"),
                    Path.Combine(side, "Roaming"),
                    true);
            }

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string roamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return new InstallEnvironment(
                InstallRootLayout.FromLocalAppData(localAppData),
                InstallRootLayout.LegacyFromLocalAppData(localAppData),
                Path.Combine(localAppData, LegacyInstallDirectoryName),
                Path.Combine(roamingAppData, DataDirectoryName),
                Path.Combine(roamingAppData, LegacyDataDirectoryName),
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                Path.Combine(roamingAppData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
                ResolveLogsDirectory(roamingAppData, localAppData),
                localAppData,
                roamingAppData,
                false);
        }

        private static string ResolveLogsDirectory(string roamingAppData, string localAppData)
        {
            string baseDirectory = !string.IsNullOrWhiteSpace(roamingAppData)
                ? roamingAppData
                : !string.IsNullOrWhiteSpace(localAppData) ? localAppData : Path.GetTempPath();
            return Path.Combine(baseDirectory, DataDirectoryName, "logs", "installer");
        }

        private static string ResolveSandboxRoot()
        {
            string root = Environment.GetEnvironmentVariable(SandboxRootVariable);
            return string.IsNullOrWhiteSpace(root)
                ? Environment.GetEnvironmentVariable(LegacySandboxRootVariable)
                : root;
        }
    }
}
