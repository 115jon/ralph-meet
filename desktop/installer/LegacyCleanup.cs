using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Win32;

namespace Installer
{
    /// <summary>What one LegacyCleanup pass did. Every step is safe to repeat.</summary>
    public sealed class LegacyCleanupResult
    {
        /// <summary>%APPDATA%\RalphMeet was renamed to %APPDATA%\Yap in one move.</summary>
        public bool DataDirectoryMoved { get; set; }

        /// <summary>Top-level entries moved one by one because %APPDATA%\Yap already existed.</summary>
        public List<string> DataEntriesMoved { get; } = new List<string>();

        /// <summary>Entries left in %APPDATA%\RalphMeet because Yap already has its own copy.</summary>
        public List<string> DataEntriesKept { get; } = new List<string>();

        public bool LegacyDataDirectoryRemoved { get; set; }

        public bool AutostartCarriedOver { get; set; }

        public int PinsRetargeted { get; set; }

        public int ShortcutsRemoved { get; set; }

        public int VulkanRegistrationsRemoved { get; set; }

        public int DeepLinksRemoved { get; set; }

        /// <summary>Folders of identities before RalphMeet removed in this pass.</summary>
        public int OlderIdentityFoldersRemoved { get; set; }

        /// <summary>%LOCALAPPDATA%\RalphMeet is gone (or never existed).</summary>
        public bool LegacyInstallRootRemoved { get; set; }
    }

    /// <summary>
    /// Moves a Ralph Meet install onto Yap and removes what is left of it. Ralph Meet lived in
    /// %LOCALAPPDATA%\RalphMeet (binaries) and %APPDATA%\RalphMeet (CEF profile with the sign-in,
    /// settings, window state), registered the RalphMeet Run value, uninstall key, shortcuts and
    /// ralphmeet://. Every install runs <see cref="Run"/> after the new version is active (the old
    /// in-app updater starts YapSetup.exe /S, so this is how existing users move), as does
    /// YapSetup.exe --cleanup-legacy. User data is only ever moved, never deleted, except the
    /// disposable logs folder. See docs/desktop/launch.md.
    /// </summary>
    public static class LegacyCleanup
    {
        public const string CommandLineSwitch = "--cleanup-legacy";

        public const string UninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\RalphMeet";
        public const string PublisherKeyPath = @"Software\115jon\RalphMeet";

        /// <summary>Keys of the even older "Ralph Meet" install.</summary>
        public const string OldestUninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Ralph Meet";
        public const string OldestPublisherKeyPath = @"Software\Jon Titor\Ralph Meet";

        public static readonly string[] ShortcutFileNames = { "RalphMeet.lnk", "Ralph Meet.lnk" };

        /// <summary>
        /// What Tauri (wry) wrote in the old identifier folder: WebView2's data folder and logs.
        /// Ralph Meet ran on CEF, whose profile lived elsewhere, so these are caches.
        /// </summary>
        private static readonly string[] IdentifierCacheEntryNames = { "EBWebView", InstallRootLayout.LogsDirectoryName };

        /// <summary>Pre-Ralph Meet entries that are caches or logs, deleted whatever Yap holds.</summary>
        private static readonly string[] PreRalphMeetDisposableEntryNames = { InstallRootLayout.LogsDirectoryName, "notification-images" };

        /// <summary>
        /// Pre-Ralph Meet settings files. The app copies each into %APPDATA%\Yap when Yap has none
        /// (lib.rs migrate_legacy_windows_app_data), so one is deleted only once Yap has its own copy.
        /// </summary>
        private static readonly string[] PreRalphMeetSettingsFileNames =
        {
            "runtime-settings.json", ".window-state.json", "desktop-settings.json"
        };

        /// <summary>Data folder entries that are not worth keeping when Yap already has its own.</summary>
        private static readonly string[] DisposableDataEntryNames = { InstallRootLayout.LogsDirectoryName };

        /// <summary>Folders of the legacy install root that only hold binaries, state or logs.</summary>
        private static readonly string[] InstallRootDirectoryNames =
        {
            InstallRootLayout.StagingDirectoryName,
            InstallRootLayout.LogsDirectoryName,
            "capture-hook",
            "obs-capture"
        };

        /// <summary>File name prefixes of the legacy install root (Update.exe.tmp, RalphMeet.exe.old, ...).</summary>
        private static readonly string[] InstallRootFilePrefixes =
        {
            InstallRootLayout.UpdateExeFileName,
            InstallRootLayout.CurrentStateFileName,
            InstallRootLayout.LegacyExecutableFileName,
            InstallRootLayout.RootIconFileName
        };

        public static bool IsCleanupRequest(string[] args)
        {
            return args != null && args.Any(arg => string.Equals(arg, CommandLineSwitch, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>
        /// The full migration, in order: user data, autostart, taskbar pins, then removal of the
        /// shortcuts, registry entries and binaries. <paramref name="launcherPath"/> and
        /// <paramref name="launcherArguments"/> start the installed Yap (RootLauncher.ResolveEntryPoint).
        /// Run only after Ralph Meet's processes have exited. Registering yap:// and ralphmeet:// to
        /// Yap is the caller's job (DeepLinkRegistration.Register), so ralphmeet:// never dangles.
        /// </summary>
        public static LegacyCleanupResult Run(
            InstallEnvironment environment,
            RegistryKey userRoot,
            string launcherPath,
            string launcherArguments)
        {
            if (environment == null)
            {
                throw new ArgumentNullException(nameof(environment));
            }

            if (userRoot == null)
            {
                throw new ArgumentNullException(nameof(userRoot));
            }

            LegacyCleanupResult result = new LegacyCleanupResult();
            MigrateUserData(environment.LegacyDataDirectory, environment.DataDirectory, result);
            result.AutostartCarriedOver = CarryOverAutostart(userRoot, environment.LegacyLayout, launcherPath, launcherArguments);
            if (PathsEqual(launcherPath, environment.Layout.RootStubPath))
            {
                result.PinsRetargeted = LauncherMigration.RetargetPinnedShortcuts(
                    environment.TaskbarPinsDirectory,
                    environment.LegacyLayout,
                    environment.Layout);
            }

            RemoveLeftovers(environment, userRoot, result);
            return result;
        }

        /// <summary>
        /// Removes Ralph Meet's shortcuts, Run value, registry keys, Vulkan layer registrations,
        /// ralphmeet:// registration (only while it still points at Ralph Meet) and install root.
        /// Leaves user data alone. The uninstaller calls this on its own.
        /// </summary>
        public static LegacyCleanupResult RemoveLeftovers(InstallEnvironment environment, RegistryKey userRoot, LegacyCleanupResult result = null)
        {
            result = result ?? new LegacyCleanupResult();
            InstallRootLayout legacyLayout = environment.LegacyLayout;

            foreach (string shortcutName in ShortcutFileNames)
            {
                if (DeleteFile(Path.Combine(environment.DesktopDirectory, shortcutName)))
                {
                    result.ShortcutsRemoved++;
                }

                if (DeleteFile(Path.Combine(environment.ProgramsDirectory, shortcutName)))
                {
                    result.ShortcutsRemoved++;
                }
            }

            if (LauncherMigration.RemoveRunValueIfOwned(userRoot, legacyLayout, LauncherMigration.LegacyRunValueName))
            {
                InstallerLogger.Info("Removed the RalphMeet Run value.");
            }

            DeleteKeyTree(userRoot, UninstallKeyPath);
            DeleteKeyTree(userRoot, PublisherKeyPath);
            DeleteKeyTree(userRoot, OldestUninstallKeyPath);
            DeleteKeyTree(userRoot, OldestPublisherKeyPath);

            try
            {
                result.VulkanRegistrationsRemoved = VulkanLayerRegistration.RemoveOwned(userRoot, legacyLayout);
            }
            catch (Exception ex)
            {
                InstallerLogger.Warn("Failed to remove Ralph Meet's Vulkan layer registrations: " + ex.Message);
            }

            result.DeepLinksRemoved = DeepLinkRegistration.UnregisterIfOwned(userRoot, legacyLayout);
            result.LegacyInstallRootRemoved = RemoveInstallRoot(legacyLayout, environment);
            result.LegacyDataDirectoryRemoved = DeleteDirectoryIfEmpty(environment.LegacyDataDirectory);
            RemoveOlderIdentityFolders(environment, result);

            InstallerLogger.Info(
                "Legacy cleanup: shortcuts removed " + result.ShortcutsRemoved +
                ", Vulkan registrations removed " + result.VulkanRegistrationsRemoved +
                ", deep links removed " + result.DeepLinksRemoved +
                ", install root removed " + result.LegacyInstallRootRemoved + ".");
            return result;
        }

        /// <summary>
        /// Moves <paramref name="legacyDirectory"/> (%APPDATA%\RalphMeet) to <paramref name="directory"/>
        /// (%APPDATA%\Yap). When Yap's folder does not exist yet it is one rename. When it exists (the
        /// installer log is written there first, or a Yap build already ran), each top-level entry
        /// Yap does not have yet is moved and an entry Yap already has stays where it is, so nothing
        /// that was not moved is lost; only the disposable logs folder is dropped. The old folder
        /// is removed once empty. The profile (cef) moves first; if it cannot, nothing else moves.
        /// In practice the installer has already logged into %APPDATA%\Yap\logs, so installs take
        /// the per-entry path.
        /// </summary>
        public static void MigrateUserData(string legacyDirectory, string directory, LegacyCleanupResult result)
        {
            if (string.IsNullOrWhiteSpace(legacyDirectory) || string.IsNullOrWhiteSpace(directory) ||
                !Directory.Exists(legacyDirectory) || PathsEqual(legacyDirectory, directory))
            {
                return;
            }

            if (!Directory.Exists(directory))
            {
                try
                {
                    string parent = Path.GetDirectoryName(Path.GetFullPath(directory));
                    if (!string.IsNullOrEmpty(parent))
                    {
                        Directory.CreateDirectory(parent);
                    }

                    Directory.Move(legacyDirectory, directory);
                    result.DataDirectoryMoved = true;
                    result.LegacyDataDirectoryRemoved = true;
                    InstallerLogger.Info("Moved user data " + legacyDirectory + " to " + directory);
                    return;
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    InstallerLogger.Warn("Could not move " + legacyDirectory + " as a whole (" + ex.Message + "); moving its entries one by one.");
                }
            }

            Directory.CreateDirectory(directory);

            // The profile (the sign-in) first, with retries for a briefly held handle (antivirus,
            // indexer, a Ralph Meet process still exiting). If it still cannot move, move nothing
            // else, so a later --cleanup-legacy can still move the folder in one piece.
            string legacyProfile = Path.Combine(legacyDirectory, InstallRootLayout.CefDirectoryName);
            string profile = Path.Combine(directory, InstallRootLayout.CefDirectoryName);
            if (Directory.Exists(legacyProfile) && !Directory.Exists(profile) && !File.Exists(profile))
            {
                if (!MoveDirectoryWithRetries(legacyProfile, profile))
                {
                    result.DataEntriesKept.AddRange(Directory.GetFileSystemEntries(legacyDirectory).Select(Path.GetFileName));
                    return;
                }

                result.DataEntriesMoved.Add(InstallRootLayout.CefDirectoryName);
            }

            foreach (string sourcePath in Directory.GetFileSystemEntries(legacyDirectory))
            {
                string name = Path.GetFileName(sourcePath);
                string destinationPath = Path.Combine(directory, name);
                bool isDirectory = Directory.Exists(sourcePath);

                if (File.Exists(destinationPath) || Directory.Exists(destinationPath))
                {
                    if (DisposableDataEntryNames.Contains(name, StringComparer.OrdinalIgnoreCase))
                    {
                        DeleteEntry(sourcePath, isDirectory);
                        continue;
                    }

                    result.DataEntriesKept.Add(name);
                    InstallerLogger.Info("Kept " + sourcePath + ": Yap already has " + destinationPath + ".");
                    continue;
                }

                try
                {
                    if (isDirectory)
                    {
                        Directory.Move(sourcePath, destinationPath);
                    }
                    else
                    {
                        File.Move(sourcePath, destinationPath);
                    }

                    result.DataEntriesMoved.Add(name);
                    InstallerLogger.Info("Moved user data " + sourcePath + " to " + destinationPath);
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    result.DataEntriesKept.Add(name);
                    InstallerLogger.Warn("Could not move " + sourcePath + " to " + destinationPath + ": " + ex.Message);
                }
            }

            result.LegacyDataDirectoryRemoved = DeleteDirectoryIfEmpty(legacyDirectory);
        }

        /// <summary>
        /// Carries an autostart choice over: when Ralph Meet's Run value starts the legacy install,
        /// writes the Yap value (unless one exists) with the same caller arguments, then deletes the
        /// RalphMeet value. A RalphMeet value that starts something else is left alone.
        /// </summary>
        public static bool CarryOverAutostart(
            RegistryKey userRoot,
            InstallRootLayout legacyLayout,
            string launcherPath,
            string launcherArguments)
        {
            if (string.IsNullOrWhiteSpace(launcherPath))
            {
                return false;
            }

            using (RegistryKey runKey = userRoot.OpenSubKey(LauncherMigration.RunKeyPath, true))
            {
                string legacyCommand = runKey?.GetValue(LauncherMigration.LegacyRunValueName) as string;
                if (legacyCommand == null ||
                    !LauncherMigration.TryParseOwnedCommand(legacyCommand, legacyLayout, out string callerArguments))
                {
                    return false;
                }

                if (runKey.GetValue(LauncherMigration.RunValueName) == null)
                {
                    string command = BuildCommand(launcherPath, launcherArguments, callerArguments);
                    runKey.SetValue(LauncherMigration.RunValueName, command, RegistryValueKind.String);
                    InstallerLogger.Info("Carried autostart over from " + legacyCommand + " to " + command);
                }

                runKey.DeleteValue(LauncherMigration.LegacyRunValueName, false);
                return true;
            }
        }

        /// <summary>
        /// Deletes the legacy install root's known entries (binaries, current.json, staging, logs,
        /// staged capture hooks), then the root once empty. A legacy cef profile folder is moved into
        /// Yap's data folder when Yap has none, and otherwise kept. Unknown entries are kept.
        /// </summary>
        private static bool RemoveInstallRoot(InstallRootLayout legacyLayout, InstallEnvironment environment)
        {
            string root = legacyLayout.RootPath;
            if (!Directory.Exists(root))
            {
                return true;
            }

            if (PathsEqual(root, environment.Layout.RootPath))
            {
                return false;
            }

            foreach (string filePath in Directory.GetFiles(root))
            {
                string name = Path.GetFileName(filePath);
                if (InstallRootFilePrefixes.Any(prefix => name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
                {
                    DeleteFile(filePath);
                }
            }

            foreach (string directoryPath in Directory.GetDirectories(root))
            {
                string name = Path.GetFileName(directoryPath);
                if (string.Equals(name, InstallRootLayout.CefDirectoryName, StringComparison.OrdinalIgnoreCase))
                {
                    MoveLegacyLocalProfile(directoryPath, environment.DataDirectory);
                    continue;
                }

                if (name.StartsWith(InstallRootLayout.VersionDirectoryPrefix, StringComparison.OrdinalIgnoreCase) ||
                    InstallRootDirectoryNames.Contains(name, StringComparer.OrdinalIgnoreCase))
                {
                    DeleteEntry(directoryPath, true);
                }
            }

            bool removed = DeleteDirectoryIfEmpty(root);
            if (!removed && Directory.Exists(root))
            {
                InstallerLogger.Warn(
                    "Kept " + root + "; it still holds: " +
                    string.Join(", ", Directory.GetFileSystemEntries(root).Select(Path.GetFileName)));
            }

            return removed;
        }

        /// <summary>
        /// Removes the folders of identities before RalphMeet: the old Tauri identifier folder
        /// (when empty or only caches) and dev.jontitor.ralph-meet (local and roaming; logs,
        /// notification-images, and settings files Yap already has its own copy of). Only once
        /// Yap's data folder exists. A folder with anything else left in it is kept.
        /// </summary>
        private static void RemoveOlderIdentityFolders(InstallEnvironment environment, LegacyCleanupResult result)
        {
            if (!Directory.Exists(environment.DataDirectory))
            {
                return;
            }

            if (RemoveKnownEntries(environment.LegacyIdentifierDirectory, name => IdentifierCacheEntryNames.Contains(name, StringComparer.OrdinalIgnoreCase)))
            {
                result.OlderIdentityFoldersRemoved++;
            }

            foreach (string directory in environment.PreRalphMeetDirectories)
            {
                bool removed = RemoveKnownEntries(directory, name =>
                    PreRalphMeetDisposableEntryNames.Contains(name, StringComparer.OrdinalIgnoreCase) ||
                    (PreRalphMeetSettingsFileNames.Contains(name, StringComparer.OrdinalIgnoreCase) &&
                     File.Exists(Path.Combine(environment.DataDirectory, name))));
                if (removed)
                {
                    result.OlderIdentityFoldersRemoved++;
                }
            }
        }

        /// <summary>Deletes the entries <paramref name="isDisposable"/> accepts, then the folder once empty.</summary>
        private static bool RemoveKnownEntries(string directory, Func<string, bool> isDisposable)
        {
            if (!Directory.Exists(directory))
            {
                return false;
            }

            foreach (string path in Directory.GetFileSystemEntries(directory))
            {
                if (isDisposable(Path.GetFileName(path)))
                {
                    DeleteEntry(path, Directory.Exists(path));
                }
            }

            bool removed = DeleteDirectoryIfEmpty(directory);
            InstallerLogger.Info(removed
                ? "Removed old app folder " + directory
                : "Kept old app folder " + directory + "; it still holds: " +
                  string.Join(", ", Directory.GetFileSystemEntries(directory).Select(Path.GetFileName)));
            return removed;
        }

        /// <summary>
        /// Very old builds kept the CEF profile in the install root. Move it to Yap's data folder
        /// when Yap has no profile yet; otherwise keep it (never delete a profile that was not moved).
        /// </summary>
        private static void MoveLegacyLocalProfile(string profilePath, string dataDirectory)
        {
            string destination = Path.Combine(dataDirectory, InstallRootLayout.CefDirectoryName);
            if (Directory.Exists(destination))
            {
                InstallerLogger.Info("Kept the legacy profile " + profilePath + ": Yap already has " + destination + ".");
                return;
            }

            try
            {
                Directory.CreateDirectory(dataDirectory);
                Directory.Move(profilePath, destination);
                InstallerLogger.Info("Moved the legacy profile " + profilePath + " to " + destination);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                InstallerLogger.Warn("Could not move the legacy profile " + profilePath + ": " + ex.Message);
            }
        }

        private static bool MoveDirectoryWithRetries(string sourcePath, string destinationPath)
        {
            const int maxAttempts = 10;
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    Directory.Move(sourcePath, destinationPath);
                    InstallerLogger.Info("Moved user data " + sourcePath + " to " + destinationPath);
                    return true;
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    if (attempt == maxAttempts)
                    {
                        InstallerLogger.Warn(
                            "Could not move " + sourcePath + " to " + destinationPath + "; left Ralph Meet's data in place: " +
                            ex.Message + Environment.NewLine + FileLockDiagnostics.DescribeLockingProcesses(sourcePath));
                        return false;
                    }

                    System.Threading.Thread.Sleep(500);
                }
            }
        }

        private static string BuildCommand(string launcherPath, string launcherArguments, string callerArguments)
        {
            string command = "\"" + Path.GetFullPath(launcherPath) + "\"";
            foreach (string part in new[] { launcherArguments, callerArguments })
            {
                if (!string.IsNullOrWhiteSpace(part))
                {
                    command += " " + part.Trim();
                }
            }

            return command;
        }

        private static bool DeleteFile(string path)
        {
            try
            {
                if (!File.Exists(path))
                {
                    return false;
                }

                File.Delete(path);
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                InstallerLogger.Warn("Failed to delete file " + path + ": " + ex.Message);
                return false;
            }
        }

        private static void DeleteEntry(string path, bool isDirectory)
        {
            try
            {
                if (isDirectory)
                {
                    Directory.Delete(path, true);
                }
                else
                {
                    File.Delete(path);
                }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                InstallerLogger.Warn("Failed to delete " + path + ": " + ex.Message);
            }
        }

        private static bool DeleteDirectoryIfEmpty(string path)
        {
            try
            {
                if (!Directory.Exists(path))
                {
                    return true;
                }

                if (Directory.EnumerateFileSystemEntries(path).Any())
                {
                    return false;
                }

                Directory.Delete(path, false);
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                InstallerLogger.Warn("Failed to delete directory " + path + ": " + ex.Message);
                return false;
            }
        }

        private static void DeleteKeyTree(RegistryKey userRoot, string keyPath)
        {
            try
            {
                userRoot.DeleteSubKeyTree(keyPath, false);
            }
            catch (Exception ex)
            {
                InstallerLogger.Warn("Failed to delete registry key tree " + keyPath + ": " + ex.Message);
            }
        }

        private static bool PathsEqual(string left, string right)
        {
            if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
            {
                return false;
            }

            return string.Equals(
                Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase);
        }
    }
}
