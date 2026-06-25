using System;
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
        public static async Task RunInstallationAsync()
        {
            await Task.Run(() =>
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string installDir = Path.Combine(localAppData, "RalphMeet");
                string exePath = Path.Combine(installDir, "RalphMeet.exe");

                // 1. Wait for any running instances to exit (for updates)
                WaitForProcessToExit("RalphMeet", TimeSpan.FromSeconds(30));

                // 2. Ensure directory exists
                if (!Directory.Exists(installDir))
                {
                    Directory.CreateDirectory(installDir);
                }

                // 3. Extract the embedded payload.zip
                ExtractPayload(installDir);

                // 4. Create Registry Keys for Add/Remove Programs
                CreateUninstallRegistryKeys(installDir, exePath);

                // 5. Create Desktop Shortcut
                CreateShortcut(installDir, exePath);

                // 6. Launch the application
                LaunchApplication(exePath);
            });
        }

        public static async Task RunUninstallationAsync()
        {
            await Task.Run(() =>
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string installDir = Path.Combine(localAppData, "RalphMeet");

                // 1. Wait for RalphMeet to exit
                WaitForProcessToExit("RalphMeet", TimeSpan.FromSeconds(30));

                // 2. Delete Shortcuts
                try
                {
                    string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    string shortcutPath = Path.Combine(desktopPath, "Ralph Meet.lnk");
                    if (File.Exists(shortcutPath)) File.Delete(shortcutPath);

                    string startMenuPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Ralph Meet.lnk");
                    if (File.Exists(startMenuPath)) File.Delete(startMenuPath);
                }
                catch { }

                // 3. Delete Registry keys
                try
                {
                    string keyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";
                    using (RegistryKey key = Registry.CurrentUser.OpenSubKey(keyPath, true))
                    {
                        if (key != null)
                        {
                            key.DeleteSubKeyTree("RalphMeet", false);
                        }
                    }
                }
                catch { }

                // 4. Schedule self-deletion of directory after exit
                try
                {
                    string uninstallerPath = Process.GetCurrentProcess().MainModule.FileName;
                    string parentDir = Path.GetDirectoryName(uninstallerPath);

                    // Launch a detached process to delete the folder after we exit
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = $"/c timeout /t 1 & rmdir /s /q \"{parentDir}\"",
                        CreateNoWindow = true,
                        UseShellExecute = false
                    });
                }
                catch { }
            });
        }

        private static void WaitForProcessToExit(string processName, TimeSpan timeout)
        {
            var stopwatch = Stopwatch.StartNew();
            while (stopwatch.Elapsed < timeout)
            {
                var processes = Process.GetProcessesByName(processName);
                if (processes.Length == 0)
                {
                    // No processes running, we can proceed
                    return;
                }

                // Try to aggressively kill them if they don't exit gracefully within a few seconds
                if (stopwatch.Elapsed.TotalSeconds > 5)
                {
                    foreach (var process in processes)
                    {
                        try
                        {
                            process.Kill();
                        }
                        catch { /* Ignore access denied etc */ }
                    }
                }

                Thread.Sleep(500);
            }
        }

        private static void ExtractPayload(string installDir)
        {
            var assembly = Assembly.GetExecutingAssembly();
            var resourceName = assembly.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("payload.zip"));

            if (resourceName == null)
            {
                // If we are debugging without payload, skip
                return;
            }

            using (Stream stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream != null)
                {
                    using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                    {
                        foreach (ZipArchiveEntry entry in archive.Entries)
                        {
                            string destinationPath = Path.GetFullPath(Path.Combine(installDir, entry.FullName));

                            // Prevent ZipSlip vulnerability
                            if (destinationPath.StartsWith(installDir, StringComparison.Ordinal))
                            {
                                if (string.IsNullOrEmpty(entry.Name))
                                {
                                    Directory.CreateDirectory(destinationPath);
                                }
                                else
                                {
                                    Directory.CreateDirectory(Path.GetDirectoryName(destinationPath));

                                    // Retry loop for locked files
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
                                            Thread.Sleep(1000);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        private static void CreateUninstallRegistryKeys(string installDir, string exePath)
        {
            try
            {
                string keyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\RalphMeet";
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(keyPath))
                {
                    key.SetValue("DisplayName", "Ralph Meet");
                    key.SetValue("DisplayIcon", exePath);
                    key.SetValue("DisplayVersion", "1.0.0"); // Dynamic versioning could be read from manifest
                    key.SetValue("Publisher", "Cloudflare");
                    key.SetValue("InstallLocation", installDir);

                    // The bootstrapper also acts as an uninstaller if passed a flag
                    string uninstallerPath = Path.Combine(installDir, "Update.exe"); // Save copy of installer
                    File.Copy(Process.GetCurrentProcess().MainModule.FileName, uninstallerPath, true);

                    key.SetValue("UninstallString", $"\"{uninstallerPath}\" --uninstall");
                }
            }
            catch { /* Ignore registry errors for non-admin execution etc */ }
        }

        private static void CreateShortcut(string installDir, string exePath)
        {
            try
            {
                string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string shortcutPath = Path.Combine(desktopPath, "Ralph Meet.lnk");

                // Note: using WScript.Shell via COM is standard for C# shortcuts without dependencies
                Type t = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(t);
                var shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = exePath;
                shortcut.WorkingDirectory = installDir;
                shortcut.IconLocation = exePath;
                shortcut.Save();

                // Start menu
                string startMenuPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Ralph Meet.lnk");
                var startShortcut = shell.CreateShortcut(startMenuPath);
                startShortcut.TargetPath = exePath;
                startShortcut.WorkingDirectory = installDir;
                startShortcut.IconLocation = exePath;
                startShortcut.Save();
            }
            catch { /* Ignore shortcut errors */ }
        }

        private static void LaunchApplication(string exePath)
        {
            if (File.Exists(exePath))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = exePath,
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(exePath)
                });
            }
        }
    }
}
