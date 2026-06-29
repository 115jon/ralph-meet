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
        private const string InstallDirectoryName = "RalphMeet";
        private const string LegacyInstallDirectoryName = "Ralph Meet";
        private const string ExecutableName = "RalphMeet.exe";
        private const string UninstallerName = "Update.exe";
        private const string Publisher = "115jon";
        private const string CurrentUninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\RalphMeet";
        private const string LegacyUninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Ralph Meet";
        private const string CurrentPublisherKeyPath = @"Software\115jon\RalphMeet";
        private const string LegacyPublisherKeyPath = @"Software\Jon Titor\Ralph Meet";

        private static readonly string[] ManagedProcessNames = { "RalphMeet", "ralph-meet-desktop" };
        private static readonly string[] ShortcutFileNames = { "RalphMeet.lnk", "Ralph Meet.lnk" };

        public static async Task RunInstallationAsync()
        {
            await Task.Run(() =>
            {
                string localAppData = GetLocalAppDataDirectory();
                string installDir = GetInstallDirectory(localAppData);
                string legacyInstallDir = GetLegacyInstallDirectory(localAppData);
                string exePath = Path.Combine(installDir, ExecutableName);

                WaitForProcessesToExit(ManagedProcessNames, TimeSpan.FromSeconds(30));
                WaitForInstalledArtifactsToExit(installDir, TimeSpan.FromSeconds(30));
                DeleteShortcuts();
                DeleteRegistryKeyTree(Registry.CurrentUser, LegacyUninstallKeyPath);
                DeleteRegistryKeyTree(Registry.CurrentUser, LegacyPublisherKeyPath);
                DeleteDirectoryIfExists(legacyInstallDir);

                Directory.CreateDirectory(installDir);
                ExtractPayload(installDir);

                string uninstallerPath = CopyBootstrapperToUninstaller(installDir);
                CreateUninstallRegistryKeys(installDir, exePath, uninstallerPath);
                CreateCompatibilityInstallLocationKey(installDir);
                CreateShortcuts(installDir, exePath);

                LaunchApplication(exePath);
            }).ConfigureAwait(false);
        }

        public static async Task RunUninstallationAsync()
        {
            await Task.Run(() =>
            {
                string localAppData = GetLocalAppDataDirectory();
                string installDir = GetInstallDirectory(localAppData);
                string legacyInstallDir = GetLegacyInstallDirectory(localAppData);
                WaitForProcessesToExit(ManagedProcessNames, TimeSpan.FromSeconds(30));
                WaitForInstalledArtifactsToExit(installDir, TimeSpan.FromSeconds(30));
                DeleteShortcuts();
                DeleteRegistryKeyTree(Registry.CurrentUser, CurrentUninstallKeyPath);
                DeleteRegistryKeyTree(Registry.CurrentUser, LegacyUninstallKeyPath);
                DeleteRegistryKeyTree(Registry.CurrentUser, CurrentPublisherKeyPath);
                DeleteRegistryKeyTree(Registry.CurrentUser, LegacyPublisherKeyPath);
                DeleteDirectoryIfExists(legacyInstallDir);
                ScheduleDirectoryDeletion(installDir);
            }).ConfigureAwait(false);
        }

        private static string GetLocalAppDataDirectory()
        {
            return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        }

        private static string GetInstallDirectory(string localAppData)
        {
            return Path.Combine(localAppData, InstallDirectoryName);
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
            while (stopwatch.Elapsed < timeout)
            {
                Process[] processes = watchedNames.SelectMany(Process.GetProcessesByName).ToArray();
                if (processes.Length == 0)
                {
                    return;
                }

                try
                {
                    if (stopwatch.Elapsed.TotalSeconds > 5)
                    {
                        foreach (Process process in processes)
                        {
                            try
                            {
                                process.Kill();
                            }
                            catch { }
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
        }

        private static void WaitForInstalledArtifactsToExit(string installDir, TimeSpan timeout)
        {
            int currentProcessId = Process.GetCurrentProcess().Id;
            string[] watchedPaths = new[]
            {
                Path.Combine(installDir, ExecutableName),
                Path.Combine(installDir, UninstallerName)
            }
                .Select(Path.GetFullPath)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            Stopwatch stopwatch = Stopwatch.StartNew();
            while (stopwatch.Elapsed < timeout)
            {
                Process[] processes = Process.GetProcesses()
                    .Where(process => process.Id != currentProcessId && ProcessMatchesExecutablePath(process, watchedPaths))
                    .ToArray();

                if (processes.Length == 0)
                {
                    return;
                }

                try
                {
                    if (stopwatch.Elapsed.TotalSeconds > 5)
                    {
                        foreach (Process process in processes)
                        {
                            try
                            {
                                process.Kill();
                            }
                            catch { }
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
            using (Stream stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null)
                {
                    throw new InvalidOperationException("Embedded installer payload could not be opened.");
                }

                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
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
                        int retries = 5;
                        while (retries > 0)
                        {
                            try
                            {
                                entry.ExtractToFile(destinationPath, true);
                                break;
                            }
                            catch (IOException)
                            {
                                retries--;
                                if (retries == 0)
                                {
                                    throw;
                                }

                                Thread.Sleep(1000);
                            }
                        }
                    }
                }
            }
        }

        private static string CopyBootstrapperToUninstaller(string installDir)
        {
            string currentProcessPath = GetCurrentProcessPath();
            string uninstallerPath = Path.Combine(installDir, UninstallerName);
            if (PathsEqual(currentProcessPath, uninstallerPath))
            {
                return uninstallerPath;
            }

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
            catch { }

            return Assembly.GetExecutingAssembly().Location;
        }

        private static void CopyFileWithRetries(string sourcePath, string destinationPath)
        {
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    File.Copy(sourcePath, destinationPath, true);
                    return;
                }
                catch (IOException)
                {
                    if (attempt == 4)
                    {
                        throw;
                    }

                    Thread.Sleep(250);
                }
            }
        }

        private static void ReplaceFileWithRetries(string sourcePath, string destinationPath)
        {
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    DeleteFileIfExists(destinationPath);
                    File.Move(sourcePath, destinationPath);
                    return;
                }
                catch (IOException)
                {
                    if (attempt == 4)
                    {
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
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(CurrentPublisherKeyPath))
            {
                if (key == null)
                {
                    throw new InvalidOperationException("Failed to create the compatibility install-location registry key.");
                }

                key.SetValue(string.Empty, installDir, RegistryValueKind.String);
            }
        }

        private static void CreateShortcuts(string installDir, string exePath)
        {
            DeleteShortcuts();

            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
            {
                throw new InvalidOperationException("WScript.Shell is unavailable, so installer shortcuts could not be created.");
            }

            dynamic shell = Activator.CreateInstance(shellType);
            CreateShortcut(shell, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), DisplayName + ".lnk"), installDir, exePath);
            CreateShortcut(shell, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), DisplayName + ".lnk"), installDir, exePath);
        }

        private static void CreateShortcut(dynamic shell, string shortcutPath, string installDir, string exePath)
        {
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = exePath;
            shortcut.WorkingDirectory = installDir;
            shortcut.IconLocation = exePath;
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
            catch { }
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
            catch { }
        }

        private static void DeleteRegistryKeyTree(RegistryKey rootKey, string keyPath)
        {
            try
            {
                rootKey.DeleteSubKeyTree(keyPath, false);
            }
            catch { }
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

        private static void LaunchApplication(string exePath)
        {
            if (!File.Exists(exePath))
            {
                throw new FileNotFoundException("Installed desktop executable was not found.", exePath);
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = exePath,
                UseShellExecute = true,
                WorkingDirectory = Path.GetDirectoryName(exePath)
            });
        }
    }
}
