using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
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
        private const string Publisher = "115jon";
        private const string CurrentUninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\RalphMeet";
        private const string LegacyUninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Ralph Meet";
        private const string CurrentPublisherKeyPath = @"Software\115jon\RalphMeet";
        private const string LegacyPublisherKeyPath = @"Software\Jon Titor\Ralph Meet";

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

        /// <param name="relaunchOnFailure">
        /// Start the installed version again if this install fails. For the silent updater only:
        /// it closed the app and nobody sees the error. The interactive window shows the error
        /// and offers Try again, which would close a relaunched app again.
        /// </param>
        public static async Task RunInstallationAsync(bool launchApplication = true, bool relaunchOnFailure = false)
        {
            await Task.Run(() =>
            {
                InstallEnvironment environment = InstallEnvironment.Current;
                InstallRootLayout layout = environment.Layout;
                string legacyInstallDir = environment.LegacyInstallDirectory;

                InstallerLogger.Info("Starting installation.");
                LogSandbox(environment);
                InstallerLogger.Info("Install root: " + layout.RootPath);
                InstallerLogger.Info("Legacy install directory: " + legacyInstallDir);
                InstallerLogger.Info("Current state path: " + layout.CurrentStatePath);
                LogKnownLockDiagnostics(layout, "Pre-install lock snapshot");

                WaitForManagedProcessesToExit(environment, TimeSpan.FromSeconds(30));

                try
                {
                    InstallAndActivate(environment, layout, legacyInstallDir, launchApplication);
                }
                catch
                {
                    // Nothing destructive ran before activation, so the version that was
                    // installed is intact. The updater closed it; bring it back.
                    if (launchApplication && relaunchOnFailure)
                    {
                        TryRelaunchInstalledVersion(layout);
                    }
                    throw;
                }
            }).ConfigureAwait(false);
        }

        private static void InstallAndActivate(
            InstallEnvironment environment,
            InstallRootLayout layout,
            string legacyInstallDir,
            bool launchApplication)
        {
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

            // Remove the legacy install only once the new version is active, so a failed
            // install never leaves the user without shortcuts or an app. CreateShortcuts
            // below replaces the current shortcuts itself.
            DeleteShortcuts(environment);
            using (RegistryKey userRoot = environment.OpenUserRoot())
            {
                DeleteRegistryKeyTree(userRoot, LegacyUninstallKeyPath);
                DeleteRegistryKeyTree(userRoot, LegacyPublisherKeyPath);
            }
            DeleteDirectoryIfExists(legacyInstallDir);

            DeleteLegacyRootEntries(layout);

            RootLauncher.Refresh(layout, activation.ActiveDirectoryPath);
            string uninstallerPath = CopyBootstrapperToUninstaller(layout.RootPath);
            RootLauncher.ResolveEntryPoint(layout, out string launcherPath, out string launcherArguments);
            bool hasRootStub = File.Exists(layout.RootStubPath);
            InstallerLogger.Info("App entry point: " + launcherPath + " " + launcherArguments);

            using (RegistryKey userRoot = environment.OpenUserRoot())
            {
                CreateUninstallRegistryKeys(userRoot, layout.RootPath, activation.ActiveExecutablePath, uninstallerPath, launcherPath);
                CreateCompatibilityInstallLocationKey(userRoot, layout.RootPath);
                RegisterDeepLinkProtocol(userRoot, launcherPath, launcherArguments);
                if (hasRootStub)
                {
                    LauncherMigration.MigrateRunValue(userRoot, layout);
                }
            }

            CreateShortcuts(environment, launcherPath, launcherArguments);
            if (hasRootStub)
            {
                int pins = LauncherMigration.RetargetPinnedShortcuts(environment.TaskbarPinsDirectory, layout);
                InstallerLogger.Info("Retargeted " + pins + " taskbar pin(s) to the root launcher.");
            }

            if (launchApplication)
            {
                LaunchApplication(launcherPath, launcherArguments, layout.RootPath);
            }
            InstallerLogger.Info("Installation finished successfully.");
        }

        /// <summary>
        /// After a failed install, start the version current.json still points at, if any.
        /// Never throws: the install error is what the caller reports.
        /// </summary>
        private static void TryRelaunchInstalledVersion(InstallRootLayout layout)
        {
            try
            {
                if (InstallState.LoadIfExists(layout.CurrentStatePath) == null)
                {
                    InstallerLogger.Info("Install failed and no version is installed; nothing to relaunch.");
                    return;
                }

                RootLauncher.ResolveEntryPoint(layout, out string launcherPath, out string launcherArguments);
                InstallerLogger.Warn("Install failed; relaunching the installed version.");
                LaunchApplication(launcherPath, launcherArguments, layout.RootPath);
            }
            catch (Exception ex)
            {
                InstallerLogger.Error("Could not relaunch the installed version after a failed install.", ex);
            }
        }

        public static async Task RunUninstallationAsync()
        {
            await Task.Run(() =>
            {
                InstallEnvironment environment = InstallEnvironment.Current;
                InstallRootLayout layout = environment.Layout;
                string legacyInstallDir = environment.LegacyInstallDirectory;

                InstallerLogger.Info("Starting uninstallation.");
                LogSandbox(environment);
                InstallerLogger.Info("Install root: " + layout.RootPath);
                InstallerLogger.Info("Legacy install directory: " + legacyInstallDir);
                LogKnownLockDiagnostics(layout, "Pre-uninstall lock snapshot");

                WaitForManagedProcessesToExit(environment, TimeSpan.FromSeconds(30));
                DeleteShortcuts(environment);
                using (RegistryKey userRoot = environment.OpenUserRoot())
                {
                    DeleteRegistryKeyTree(userRoot, CurrentUninstallKeyPath);
                    DeleteRegistryKeyTree(userRoot, LegacyUninstallKeyPath);
                    DeleteRegistryKeyTree(userRoot, CurrentPublisherKeyPath);
                    DeleteRegistryKeyTree(userRoot, LegacyPublisherKeyPath);
                    UnregisterDeepLinkProtocolIfOwned(userRoot, layout);
                    RemoveVulkanLayerRegistrations(userRoot, layout);
                    if (LauncherMigration.RemoveRunValueIfOwned(userRoot, layout))
                    {
                        InstallerLogger.Info("Removed the RalphMeet Run value.");
                    }
                }
                DeleteDirectoryIfExists(legacyInstallDir);
                ScheduleDirectoryDeletion(layout.RootPath);
                InstallerLogger.Info("Uninstallation cleanup scheduled successfully.");
            }).ConfigureAwait(false);
        }

        private static void LogSandbox(InstallEnvironment environment)
        {
            if (environment.IsSandbox)
            {
                InstallerLogger.Warn(
                    "Sandbox install (" + InstallEnvironment.SandboxRootVariable + "): registry under HKCU\\" +
                    InstallEnvironment.SandboxRegistryPath + ", shortcuts beside the root, processes matched by path only.");
            }
        }

        /// <summary>
        /// Stops the app before files are replaced. Sandbox installs skip the by-name match so
        /// they never stop the real install; the by-path match is scoped to the install root.
        /// </summary>
        private static void WaitForManagedProcessesToExit(InstallEnvironment environment, TimeSpan timeout)
        {
            InstallRootLayout layout = environment.Layout;
            if (!environment.IsSandbox)
            {
                WaitForProcessesToExit(ManagedProcessNames, timeout);
            }

            WaitForInstalledArtifactsToExit(layout.GetInstalledExecutablePaths(ExecutableFileName), layout.RootPath, timeout);
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
            string resourceName = assembly.GetManifestResourceNames().FirstOrDefault(name => name.EndsWith("payload.rmpk", StringComparison.OrdinalIgnoreCase));
            if (resourceName == null)
            {
                throw new InvalidOperationException("Embedded payload.rmpk not found. Rebuild the installer after packaging the desktop payload.");
            }

            InstallerLogger.Info("Extracting payload resource " + resourceName + " into " + installDir);
            using (Stream stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null)
                {
                    throw new InvalidOperationException("Embedded installer payload could not be opened.");
                }

                PayloadExtractor.Extract(
                    stream,
                    installDir,
                    onPermanentFailure: destinationPath => LogKnownLockDiagnostics(
                        InstallRootLayout.FromExecutablePath(GetCurrentProcessPath()),
                        "Payload extraction failure for " + destinationPath,
                        destinationPath));
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
            string uninstallerPath = Path.Combine(installDir, InstallRootLayout.UpdateExeFileName);
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

        private static void CreateUninstallRegistryKeys(RegistryKey userRoot, string installDir, string exePath, string uninstallerPath, string iconPath)
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
            using (RegistryKey key = userRoot.CreateSubKey(CurrentUninstallKeyPath))
            {
                if (key == null)
                {
                    throw new InvalidOperationException("Failed to create the current-user uninstall registry key.");
                }

                key.SetValue("DisplayName", DisplayName);
                // The root stub carries the app icon and, unlike app-<version>, never moves.
                key.SetValue("DisplayIcon", iconPath);
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

        private static void CreateCompatibilityInstallLocationKey(RegistryKey userRoot, string installDir)
        {
            InstallerLogger.Info("Writing compatibility install-location registry key.");
            using (RegistryKey key = userRoot.CreateSubKey(CurrentPublisherKeyPath))
            {
                if (key == null)
                {
                    throw new InvalidOperationException("Failed to create the compatibility install-location registry key.");
                }

                key.SetValue(string.Empty, installDir, RegistryValueKind.String);
            }
        }

        private static void RegisterDeepLinkProtocol(RegistryKey userRoot, string launcherPath, string launcherArguments)
        {
            InstallerLogger.Info("Registering ralphmeet:// deep-link protocol to launcher " + launcherPath);
            DeepLinkRegistration.Register(userRoot, launcherPath, launcherArguments);
        }

        private static void UnregisterDeepLinkProtocolIfOwned(RegistryKey userRoot, InstallRootLayout layout)
        {
            if (DeepLinkRegistration.UnregisterIfOwned(userRoot, layout))
            {
                InstallerLogger.Info("Removed installer-owned ralphmeet:// deep-link protocol registration.");
                return;
            }

            InstallerLogger.Info("Skipped ralphmeet:// deep-link protocol removal because registration was missing or no longer owned by this installer.");
        }

        private static void RemoveVulkanLayerRegistrations(RegistryKey userRoot, InstallRootLayout layout)
        {
            try
            {
                int removed = VulkanLayerRegistration.RemoveOwned(userRoot, layout);
                InstallerLogger.Info("Removed " + removed + " Vulkan capture layer registration(s) written by this install.");
            }
            catch (Exception ex)
            {
                InstallerLogger.Warn("Failed to remove the Vulkan capture layer registrations: " + ex.Message);
            }
        }

        private static void CreateShortcuts(InstallEnvironment environment, string launcherPath, string launcherArguments)
        {
            InstallerLogger.Info("Creating desktop and Start menu shortcuts.");
            DeleteShortcuts(environment);

            if (!File.Exists(launcherPath))
            {
                throw new FileNotFoundException("Installed launcher was not found.", launcherPath);
            }

            // The AppUserModelID matches the one the app sets on its process, so the taskbar groups
            // the running window with this shortcut and pins the root stub, not app-<version>.
            ShellLinkData shortcut = new ShellLinkData
            {
                TargetPath = launcherPath,
                Arguments = launcherArguments,
                WorkingDirectory = environment.Layout.RootPath,
                IconPath = launcherPath,
                IconIndex = 0,
                Description = DisplayName,
                AppUserModelId = RootLauncher.AppUserModelId
            };
            ShellLink.Save(Path.Combine(environment.DesktopDirectory, DisplayName + ".lnk"), shortcut);
            ShellLink.Save(Path.Combine(environment.ProgramsDirectory, DisplayName + ".lnk"), shortcut);
        }

        private static void DeleteShortcuts(InstallEnvironment environment)
        {
            foreach (string shortcutName in ShortcutFileNames)
            {
                DeleteFileIfExists(Path.Combine(environment.DesktopDirectory, shortcutName));
                DeleteFileIfExists(Path.Combine(environment.ProgramsDirectory, shortcutName));
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

            HashSet<string> preservedEntries = new HashSet<string>(
                layout.GetPreservedRootEntryNames(),
                StringComparer.OrdinalIgnoreCase);

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
