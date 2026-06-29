using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace Installer
{
    public class InstallerLogic
    {
        private const string DisplayName = "RalphMeet";
        private const string LegacyInstallDirectoryName = "Ralph Meet";
        private const string Publisher = "115jon";
        private const string CurrentUninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\RalphMeet";
        private const string LegacyUninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Ralph Meet";
        private const string CurrentPublisherKeyPath = @"Software\115jon\RalphMeet";
        private const string LegacyPublisherKeyPath = @"Software\Jon Titor\Ralph Meet";
        private const string LauncherArguments = "--processStart RalphMeet.exe";
        private const string UninstallerName = "Update.exe";

        public const string ExecutableFileName = "RalphMeet.exe";

        private static readonly string[] ManagedProcessNames =
        {
            "RalphMeet",
            "ralph-meet-desktop",
            "inject-helper32",
            "inject-helper64",
            "get-graphics-offsets32",
            "get-graphics-offsets64"
        };

        private static readonly string[] ShortcutFileNames = { "RalphMeet.lnk", "Ralph Meet.lnk" };

        public static async Task RunInstallationAsync()
        {
            await Task.Run(() =>
            {
                string localAppData = GetLocalAppDataDirectory();
                InstallRootLayout layout = InstallRootLayout.FromLocalAppData(localAppData);
                string legacyInstallDir = GetLegacyInstallDirectory(localAppData);

                InstallerLogger.Info("Starting installation.");
                InstallerLogger.Info("Install root: " + layout.RootPath);
                InstallerLogger.Info("Legacy install directory: " + legacyInstallDir);
                InstallerLogger.Info("Current state path: " + layout.CurrentStatePath);
                LogKnownLockDiagnostics(layout, "Pre-install lock snapshot");

                WaitForProcessesToExit(ManagedProcessNames, TimeSpan.FromSeconds(30));
                WaitForInstalledArtifactsToExit(layout.GetInstalledExecutablePaths(ExecutableFileName), layout.RootPath, TimeSpan.FromSeconds(30));
                DeleteShortcuts();
                DeleteRegistryKeyTree(Registry.CurrentUser, LegacyUninstallKeyPath);
                DeleteRegistryKeyTree(Registry.CurrentUser, LegacyPublisherKeyPath);
                DeleteDirectoryIfExists(legacyInstallDir);

                Directory.CreateDirectory(layout.RootPath);
                Directory.CreateDirectory(layout.StagingPath);
                InstallerLogger.Info("Ensured install root exists.");

                string stagingDirectoryPath = ActivationManager.PrepareStagingDirectory(layout, DisplayName);
                InstallerLogger.Info("Prepared staging directory: " + stagingDirectoryPath);
                ExtractPayload(stagingDirectoryPath);

                string payloadExecutablePath = Path.Combine(stagingDirectoryPath, ExecutableFileName);
                string payloadVersion = ResolvePayloadVersion(payloadExecutablePath);
                InstallerLogger.Info("Resolved payload version: " + payloadVersion);

                ActivationResult activation = ActivationManager.Activate(layout, stagingDirectoryPath, payloadVersion);
                InstallerLogger.Info("Activated version directory: " + activation.ActiveDirectoryPath);

                DeleteLegacyRootEntries(layout);

                string uninstallerPath = CopyBootstrapperToUninstaller(layout.RootPath);
                CreateUninstallRegistryKeys(layout.RootPath, activation.ActiveExecutablePath, uninstallerPath);
                CreateCompatibilityInstallLocationKey(layout.RootPath);
                CreateShortcuts(layout.RootPath, uninstallerPath, activation.ActiveExecutablePath);

                LaunchApplication(uninstallerPath, LauncherArguments, layout.RootPath);
                InstallerLogger.Info("Installation finished successfully.");
            }).ConfigureAwait(false);
        }

        public static async Task RunUninstallationAsync()
        {
            await Task.Run(() =>
            {
                string localAppData = GetLocalAppDataDirectory();
                InstallRootLayout layout = InstallRootLayout.FromLocalAppData(localAppData);
                string legacyInstallDir = GetLegacyInstallDirectory(localAppData);

                InstallerLogger.Info("Starting uninstallation.");
                InstallerLogger.Info("Install root: " + layout.RootPath);
                InstallerLogger.Info("Legacy install directory: " + legacyInstallDir);
                LogKnownLockDiagnostics(layout, "Pre-uninstall lock snapshot");

                WaitForProcessesToExit(ManagedProcessNames, TimeSpan.FromSeconds(30));
                WaitForInstalledArtifactsToExit(layout.GetInstalledExecutablePaths(ExecutableFileName), layout.RootPath, TimeSpan.FromSeconds(30));
                DeleteShortcuts();
                DeleteRegistryKeyTree(Registry.CurrentUser, CurrentUninstallKeyPath);
                DeleteRegistryKeyTree(Registry.CurrentUser, LegacyUninstallKeyPath);
                DeleteRegistryKeyTree(Registry.CurrentUser, CurrentPublisherKeyPath);
                DeleteRegistryKeyTree(Registry.CurrentUser, LegacyPublisherKeyPath);
                DeleteDirectoryIfExists(legacyInstallDir);
                ScheduleDirectoryDeletion(layout.RootPath);
                InstallerLogger.Info("Uninstallation cleanup scheduled successfully.");
            }).ConfigureAwait(false);
        }

        private static string GetLocalAppDataDirectory()
        {
            return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        }

        private static string GetLegacyInstallDirectory(string localAppData)
        {
            return Path.Combine(localAppData, LegacyInstallDirectoryName);
        }

        private static void WaitForProcessesToExit(IEnumerable<string> processNames, TimeSpan timeout)
        {
            string[] watchedNames = processNames
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (watchedNames.Length == 0)
            {
                return;
            }

            Stopwatch stopwatch = Stopwatch.StartNew();
            bool waitLogged = false;
            bool killLogged = false;
            string lastSnapshot = string.Empty;

            while (stopwatch.Elapsed < timeout)
            {
                Process[] processes = watchedNames.SelectMany(Process.GetProcessesByName).ToArray();
                if (processes.Length == 0)
                {
                    if (!string.IsNullOrWhiteSpace(lastSnapshot))
                    {
                        InstallerLogger.Info("Managed processes exited: " + lastSnapshot);
                    }

                    return;
                }

                try
                {
                    lastSnapshot = DescribeProcesses(processes);

                    if (!waitLogged)
                    {
                        InstallerLogger.Warn("Waiting for managed processes to exit: " + lastSnapshot);
                        waitLogged = true;
                    }

                    if (stopwatch.Elapsed.TotalSeconds > 5)
                    {
                        if (!killLogged)
                        {
                            InstallerLogger.Warn("Force-terminating managed processes: " + lastSnapshot);
                            killLogged = true;
                        }

                        foreach (Process process in processes)
                        {
                            try
                            {
                                process.Kill();
                            }
                            catch
                            {
                            }
                        }
                    }
                }
                finally
                {
                    foreach (Process process in processes)
                    {
                        process.Dispose();
                    }
                }

                Thread.Sleep(500);
            }

            if (!string.IsNullOrWhiteSpace(lastSnapshot))
            {
                InstallerLogger.Warn("Timed out waiting for managed processes to exit: " + lastSnapshot);
            }
        }

        private static void WaitForInstalledArtifactsToExit(IEnumerable<string> watchedPaths, string installRoot, TimeSpan timeout)
        {
            int currentProcessId = Process.GetCurrentProcess().Id;
            string[] normalizedPaths = watchedPaths
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(Path.GetFullPath)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (normalizedPaths.Length == 0)
            {
                return;
            }

            Stopwatch stopwatch = Stopwatch.StartNew();
            bool waitLogged = false;
            bool killLogged = false;
            string lastSnapshot = string.Empty;

            while (stopwatch.Elapsed < timeout)
            {
                Process[] processes = Process.GetProcesses()
                    .Where(process => process.Id != currentProcessId && ProcessMatchesExecutablePath(process, normalizedPaths))
                    .ToArray();

                if (processes.Length == 0)
                {
                    if (!string.IsNullOrWhiteSpace(lastSnapshot))
                    {
                        InstallerLogger.Info("Installed artifacts are no longer running: " + lastSnapshot);
                    }

                    return;
                }

                try
                {
                    lastSnapshot = DescribeProcesses(processes);

                    if (!waitLogged)
                    {
                        InstallerLogger.Warn("Waiting for installed artifacts to exit: " + lastSnapshot);
                        waitLogged = true;
                    }

                    if (stopwatch.Elapsed.TotalSeconds > 5)
                    {
                        if (!killLogged)
                        {
                            InstallerLogger.Warn("Force-terminating installed artifacts: " + lastSnapshot);
                            killLogged = true;
                        }

                        foreach (Process process in processes)
                        {
                            try
                            {
                                process.Kill();
                            }
                            catch
                            {
                            }
                        }
                    }
                }
                finally
                {
                    foreach (Process process in processes)
                    {
                        process.Dispose();
                    }
                }

                Thread.Sleep(500);
            }

            if (!string.IsNullOrWhiteSpace(lastSnapshot))
            {
                InstallerLogger.Warn("Timed out waiting for installed artifacts to exit: " + lastSnapshot);
                LogKnownLockDiagnostics(new InstallRootLayout(installRoot), "Installed-artifact timeout lock snapshot");
            }
        }

        private static bool ProcessMatchesExecutablePath(Process process, IEnumerable<string> watchedPaths)
        {
            try
            {
                ProcessModule mainModule = process.MainModule;
                if (mainModule == null || string.IsNullOrWhiteSpace(mainModule.FileName))
                {
                    return false;
                }

                string processPath = Path.GetFullPath(mainModule.FileName);
                return watchedPaths.Contains(processPath, StringComparer.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        private static void ExtractPayload(string installDir)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            string resourceName = assembly.GetManifestResourceNames().FirstOrDefault(name => name.EndsWith("payload.zip", StringComparison.OrdinalIgnoreCase));
            if (resourceName == null)
            {
                throw new InvalidOperationException("Embedded payload.zip not found. Rebuild the installer after packaging the desktop payload.");
            }

            string installRoot = EnsureTrailingSeparator(Path.GetFullPath(installDir));
            InstallerLogger.Info("Extracting payload resource " + resourceName + " into " + installRoot);
            using (Stream stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null)
                {
                    throw new InvalidOperationException("Embedded installer payload could not be opened.");
                }

                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    InstallerLogger.Info("Payload entry count: " + archive.Entries.Count);
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string destinationPath = Path.GetFullPath(Path.Combine(installRoot, entry.FullName));
                        if (!destinationPath.StartsWith(installRoot, StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }

                        if (string.IsNullOrEmpty(entry.Name))
                        {
                            Directory.CreateDirectory(destinationPath);
                            continue;
                        }

                        string destinationDirectory = Path.GetDirectoryName(destinationPath);
                        if (string.IsNullOrEmpty(destinationDirectory))
                        {
                            throw new InvalidOperationException("Installer payload contains an invalid file path.");
                        }

                        Directory.CreateDirectory(destinationDirectory);
                        const int maxAttempts = 5;
                        for (int attempt = 1; attempt <= maxAttempts; attempt++)
                        {
                            try
                            {
                                entry.ExtractToFile(destinationPath, true);
                                break;
                            }
                            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                            {
                                InstallerLogger.Warn(
                                    "Failed to extract " + entry.FullName + " to " + destinationPath +
                                    " (attempt " + attempt + "/" + maxAttempts + "): " + ex.Message);

                                if (attempt == maxAttempts)
                                {
                                    InstallerLogger.Error(
                                        "Payload extraction permanently failed for " + destinationPath,
                                        ex);
                                    LogKnownLockDiagnostics(
                                        InstallRootLayout.FromExecutablePath(GetCurrentProcessPath()),
                                        "Payload extraction failure for " + destinationPath,
                                        destinationPath);
                                    throw;
                                }

                                Thread.Sleep(1000);
                            }
                        }
                    }
                }
            }

            InstallerLogger.Info("Payload extraction finished.");
        }

        private static string ResolvePayloadVersion(string payloadExecutablePath)
        {
            if (File.Exists(payloadExecutablePath))
            {
                FileVersionInfo versionInfo = FileVersionInfo.GetVersionInfo(payloadExecutablePath);
                string displayVersion = GetDisplayVersion(versionInfo);
                if (!string.IsNullOrWhiteSpace(displayVersion) && displayVersion != "0.0.0")
                {
                    return InstallRootLayout.NormalizeVersion(displayVersion);
                }
            }

            Version assemblyVersion = Assembly.GetExecutingAssembly().GetName().Version;
            if (assemblyVersion != null)
            {
                return InstallRootLayout.NormalizeVersion(assemblyVersion.ToString(3));
            }

            throw new InvalidOperationException("Installer payload version could not be determined.");
        }

        private static string CopyBootstrapperToUninstaller(string installDir)
        {
            string currentProcessPath = GetCurrentProcessPath();
            string uninstallerPath = Path.Combine(installDir, UninstallerName);
            if (PathsEqual(currentProcessPath, uninstallerPath))
            {
                return uninstallerPath;
            }

            InstallerLogger.Info("Copying bootstrapper to uninstaller path " + uninstallerPath);
            string tempUninstallerPath = uninstallerPath + ".tmp";
            DeleteFileIfExists(tempUninstallerPath);
            CopyFileWithRetries(currentProcessPath, tempUninstallerPath);
            ReplaceFileWithRetries(tempUninstallerPath, uninstallerPath);
            return uninstallerPath;
        }

        private static string GetCurrentProcessPath()
        {
            try
            {
                ProcessModule mainModule = Process.GetCurrentProcess().MainModule;
                if (mainModule != null && !string.IsNullOrWhiteSpace(mainModule.FileName))
                {
                    return mainModule.FileName;
                }
            }
            catch
            {
            }

            return Assembly.GetExecutingAssembly().Location;
        }

        private static void CopyFileWithRetries(string sourcePath, string destinationPath)
        {
            const int maxAttempts = 5;
            for (int attempt = 1; attempt <= maxAttempts; attempt++)
            {
                try
                {
                    File.Copy(sourcePath, destinationPath, true);
                    return;
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    InstallerLogger.Warn(
                        "Failed to copy " + sourcePath + " to " + destinationPath +
                        " (attempt " + attempt + "/" + maxAttempts + "): " + ex.Message);

                    if (attempt == maxAttempts)
                    {
                        InstallerLogger.Error("Copy failed for " + destinationPath, ex);
                        InstallerLogger.Warn(FileLockDiagnostics.DescribeLockingProcesses(sourcePath, destinationPath));
                        throw;
                    }

                    Thread.Sleep(250);
                }
            }
        }

        private static void ReplaceFileWithRetries(string sourcePath, string destinationPath)
        {
            const int maxAttempts = 5;
            for (int attempt = 1; attempt <= maxAttempts; attempt++)
            {
                try
                {
                    DeleteFileIfExists(destinationPath);
                    File.Move(sourcePath, destinationPath);
                    return;
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    InstallerLogger.Warn(
                        "Failed to replace " + destinationPath + " from " + sourcePath +
                        " (attempt " + attempt + "/" + maxAttempts + "): " + ex.Message);

                    if (attempt == maxAttempts)
                    {
                        InstallerLogger.Error("Replace failed for " + destinationPath, ex);
                        InstallerLogger.Warn(FileLockDiagnostics.DescribeLockingProcesses(sourcePath, destinationPath));
                        throw;
                    }

                    Thread.Sleep(250);
                }
            }
        }

        private static void CreateUninstallRegistryKeys(string installDir, string exePath, string uninstallerPath)
        {
            if (!File.Exists(exePath))
            {
                throw new FileNotFoundException("Installed desktop executable was not found.", exePath);
            }

            if (!File.Exists(uninstallerPath))
            {
                throw new FileNotFoundException("Installer uninstaller stub was not created.", uninstallerPath);
            }

            FileVersionInfo versionInfo = FileVersionInfo.GetVersionInfo(exePath);
            string displayVersion = GetDisplayVersion(versionInfo);
            string publisher = !string.IsNullOrWhiteSpace(versionInfo.CompanyName) ? versionInfo.CompanyName : Publisher;
            string uninstallCommand = "\"" + uninstallerPath + "\" --uninstall";
            string quietUninstallCommand = uninstallCommand + " /S";

            InstallerLogger.Info("Writing uninstall registry keys.");
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(CurrentUninstallKeyPath))
            {
                if (key == null)
                {
                    throw new InvalidOperationException("Failed to create the current-user uninstall registry key.");
                }

                key.SetValue("DisplayName", DisplayName);
                key.SetValue("DisplayIcon", exePath);
                key.SetValue("DisplayVersion", displayVersion);
                key.SetValue("Publisher", publisher);
                key.SetValue("InstallLocation", installDir);
                key.SetValue("UninstallString", uninstallCommand);
                key.SetValue("QuietUninstallString", quietUninstallCommand);
                key.SetValue("InstallDate", DateTime.UtcNow.ToString("yyyyMMdd"));
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        private static string GetDisplayVersion(FileVersionInfo versionInfo)
        {
            if (!string.IsNullOrWhiteSpace(versionInfo.ProductVersion))
            {
                return versionInfo.ProductVersion;
            }

            if (!string.IsNullOrWhiteSpace(versionInfo.FileVersion))
            {
                return versionInfo.FileVersion;
            }

            return "0.0.0";
        }

        private static void CreateCompatibilityInstallLocationKey(string installDir)
        {
            InstallerLogger.Info("Writing compatibility install-location registry key.");
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(CurrentPublisherKeyPath))
            {
                if (key == null)
                {
                    throw new InvalidOperationException("Failed to create the compatibility install-location registry key.");
                }

                key.SetValue(string.Empty, installDir, RegistryValueKind.String);
            }
        }

        private static void CreateShortcuts(string installDir, string launcherPath, string iconPath)
        {
            InstallerLogger.Info("Creating desktop and Start menu shortcuts.");
            DeleteShortcuts();

            if (!File.Exists(launcherPath))
            {
                throw new FileNotFoundException("Installed launcher was not found.", launcherPath);
            }

            if (string.IsNullOrWhiteSpace(iconPath) || !File.Exists(iconPath))
            {
                iconPath = launcherPath;
            }

            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
            {
                throw new InvalidOperationException("WScript.Shell is unavailable, so installer shortcuts could not be created.");
            }

            dynamic shell = Activator.CreateInstance(shellType);
            CreateShortcut(
                shell,
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), DisplayName + ".lnk"),
                installDir,
                launcherPath,
                LauncherArguments,
                iconPath);
            CreateShortcut(
                shell,
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), DisplayName + ".lnk"),
                installDir,
                launcherPath,
                LauncherArguments,
                iconPath);
        }

        private static void CreateShortcut(dynamic shell, string shortcutPath, string workingDirectory, string targetPath, string arguments, string iconPath)
        {
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = targetPath;
            shortcut.Arguments = arguments;
            shortcut.WorkingDirectory = workingDirectory;
            shortcut.IconLocation = iconPath;
            shortcut.Description = DisplayName;
            shortcut.Save();
        }

        private static void DeleteShortcuts()
        {
            string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string startMenuPath = Environment.GetFolderPath(Environment.SpecialFolder.Programs);

            foreach (string shortcutName in ShortcutFileNames)
            {
                DeleteFileIfExists(Path.Combine(desktopPath, shortcutName));
                DeleteFileIfExists(Path.Combine(startMenuPath, shortcutName));
            }
        }

        private static void DeleteFileIfExists(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch (Exception ex)
            {
                InstallerLogger.Warn("Failed to delete file " + path + ": " + ex.Message);
            }
        }

        private static void DeleteDirectoryIfExists(string path)
        {
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, true);
                }
            }
            catch (Exception ex)
            {
                InstallerLogger.Warn("Failed to delete directory " + path + ": " + ex.Message);
            }
        }

        private static void DeleteRegistryKeyTree(RegistryKey rootKey, string keyPath)
        {
            try
            {
                rootKey.DeleteSubKeyTree(keyPath, false);
            }
            catch (Exception ex)
            {
                InstallerLogger.Warn("Failed to delete registry key tree " + keyPath + ": " + ex.Message);
            }
        }

        private static void ScheduleDirectoryDeletion(params string[] directories)
        {
            string[] uniqueDirectories = directories
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(Path.GetFullPath)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (uniqueDirectories.Length == 0)
            {
                return;
            }

            InstallerLogger.Info("Scheduling directory deletion for: " + string.Join(", ", uniqueDirectories));
            string deleteCommands = string.Join(" & ", uniqueDirectories.Select(path => "if exist \"" + path + "\" rmdir /s /q \"" + path + "\""));
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c timeout /t 2 /nobreak >nul & " + deleteCommands,
                CreateNoWindow = true,
                UseShellExecute = false
            });
        }

        private static string EnsureTrailingSeparator(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                return Path.DirectorySeparatorChar.ToString();
            }

            char lastCharacter = path[path.Length - 1];
            if (lastCharacter == Path.DirectorySeparatorChar || lastCharacter == Path.AltDirectorySeparatorChar)
            {
                return path;
            }

            return path + Path.DirectorySeparatorChar;
        }

        private static bool PathsEqual(string left, string right)
        {
            return string.Equals(
                Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase);
        }

        private static void LaunchApplication(string executablePath, string arguments, string workingDirectory)
        {
            if (!File.Exists(executablePath))
            {
                throw new FileNotFoundException("Installed launcher was not found.", executablePath);
            }

            InstallerLogger.Info("Launching installed application " + executablePath + " " + arguments);
            Process.Start(new ProcessStartInfo
            {
                FileName = executablePath,
                Arguments = arguments ?? string.Empty,
                UseShellExecute = true,
                WorkingDirectory = workingDirectory
            });
        }

        private static void DeleteLegacyRootEntries(InstallRootLayout layout)
        {
            if (layout == null || !Directory.Exists(layout.RootPath))
            {
                return;
            }

            HashSet<string> preservedEntries = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                InstallRootLayout.CurrentStateFileName,
                InstallRootLayout.RootLauncherFileName,
                InstallRootLayout.RootIconFileName,
                InstallRootLayout.StagingDirectoryName,
                InstallRootLayout.LogsDirectoryName
            };

            foreach (string filePath in Directory.GetFiles(layout.RootPath))
            {
                string name = Path.GetFileName(filePath);
                if (preservedEntries.Contains(name))
                {
                    continue;
                }

                InstallerLogger.Info("Deleting legacy root file: " + filePath);
                DeleteFileIfExists(filePath);
            }

            foreach (string directoryPath in Directory.GetDirectories(layout.RootPath))
            {
                string name = Path.GetFileName(directoryPath);
                if (preservedEntries.Contains(name) || name.StartsWith(InstallRootLayout.VersionDirectoryPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                InstallerLogger.Info("Deleting legacy root directory: " + directoryPath);
                DeleteDirectoryIfExists(directoryPath);
            }
        }

        private static void LogKnownLockDiagnostics(InstallRootLayout layout, string context, params string[] extraPaths)
        {
            IEnumerable<string> candidatePaths = GetKnownInstallPaths(layout);
            if (extraPaths != null && extraPaths.Length > 0)
            {
                candidatePaths = candidatePaths.Concat(extraPaths);
            }

            InstallerLogger.Warn("[" + context + "]" + Environment.NewLine + FileLockDiagnostics.DescribeLockingProcesses(candidatePaths.ToArray()));
        }

        private static IEnumerable<string> GetKnownInstallPaths(InstallRootLayout layout)
        {
            if (layout == null)
            {
                return Enumerable.Empty<string>();
            }

            List<string> candidatePaths = new List<string>(layout.GetInstalledExecutablePaths(ExecutableFileName))
            {
                Path.Combine(layout.RootPath, "obs-capture", "graphics-hook32.dll"),
                Path.Combine(layout.RootPath, "obs-capture", "graphics-hook64.dll"),
                Path.Combine(layout.RootPath, "obs-capture", "inject-helper32.exe"),
                Path.Combine(layout.RootPath, "obs-capture", "inject-helper64.exe"),
                Path.Combine(layout.RootPath, "obs-capture", "get-graphics-offsets32.exe"),
                Path.Combine(layout.RootPath, "obs-capture", "get-graphics-offsets64.exe")
            };

            foreach (string versionDirectoryPath in layout.EnumerateVersionDirectoryPaths())
            {
                candidatePaths.Add(Path.Combine(versionDirectoryPath, "obs-capture", "graphics-hook32.dll"));
                candidatePaths.Add(Path.Combine(versionDirectoryPath, "obs-capture", "graphics-hook64.dll"));
                candidatePaths.Add(Path.Combine(versionDirectoryPath, "obs-capture", "inject-helper32.exe"));
                candidatePaths.Add(Path.Combine(versionDirectoryPath, "obs-capture", "inject-helper64.exe"));
                candidatePaths.Add(Path.Combine(versionDirectoryPath, "obs-capture", "get-graphics-offsets32.exe"));
                candidatePaths.Add(Path.Combine(versionDirectoryPath, "obs-capture", "get-graphics-offsets64.exe"));
            }

            return candidatePaths.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        }

        private static string DescribeProcesses(IEnumerable<Process> processes)
        {
            return string.Join(
                "; ",
                processes
                    .Where(process => process != null)
                    .Select(process =>
                    {
                        string processPath = "(unavailable)";

                        try
                        {
                            ProcessModule mainModule = process.MainModule;
                            if (mainModule != null && !string.IsNullOrWhiteSpace(mainModule.FileName))
                            {
                                processPath = mainModule.FileName;
                            }
                        }
                        catch
                        {
                        }

                        return process.ProcessName + " (pid " + process.Id + ", path " + processPath + ")";
                    })
                    .ToArray());
        }
    }
}
