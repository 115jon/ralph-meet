using System;
using System.IO;
using Installer;
using Microsoft.Win32;
using Xunit;

namespace Installer.Tests
{
    /// <summary>
    /// Ralph Meet -> Yap migration, run against a sandbox environment (temp folders) and a
    /// throwaway HKCU\Software\115jon\YapTests\&lt;guid&gt; key, never the real install.
    /// </summary>
    public sealed class LegacyCleanupTests : IDisposable
    {
        private const string UninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Yap";

        private readonly string _temp = Path.Combine(Path.GetTempPath(), "installer-tests-" + Guid.NewGuid().ToString("N"));
        private readonly string _registryPath = @"Software\115jon\YapTests\" + Guid.NewGuid().ToString("N");
        private readonly InstallEnvironment _environment;
        private readonly RegistryKey _userRoot;

        public LegacyCleanupTests()
        {
            Directory.CreateDirectory(_temp);
            _environment = InstallEnvironment.FromSandboxRoot(Path.Combine(_temp, "Yap"));
            _userRoot = Registry.CurrentUser.CreateSubKey(_registryPath);
        }

        public void Dispose()
        {
            _userRoot.Dispose();
            Registry.CurrentUser.DeleteSubKeyTree(_registryPath, false);
            try
            {
                Directory.Delete(_temp, true);
            }
            catch (IOException)
            {
            }
        }

        private InstallRootLayout Legacy => _environment.LegacyLayout;

        private string NewStub => _environment.Layout.RootStubPath;

        [Fact]
        public void Sandbox_Keeps_Everything_Under_The_Temp_Folder()
        {
            foreach (string path in new[]
            {
                _environment.Layout.RootPath, Legacy.RootPath, _environment.DataDirectory,
                _environment.LegacyDataDirectory, _environment.DesktopDirectory, _environment.ProgramsDirectory
            })
            {
                Assert.StartsWith(_temp, path, StringComparison.OrdinalIgnoreCase);
            }

            Assert.Equal("RalphMeet.exe", Path.GetFileName(Legacy.RootStubPath));
            Assert.Equal("Yap.exe", Path.GetFileName(NewStub));
        }

        [Fact]
        public void Moves_User_Data_When_Yap_Has_None()
        {
            Write(_environment.LegacyDataDirectory, @"cef\Network\Cookies", "session");
            Write(_environment.LegacyDataDirectory, "desktop-settings.json", "{}");
            Write(_environment.LegacyDataDirectory, ".window-state.json", "{}");

            LegacyCleanupResult result = Run();

            Assert.True(result.DataDirectoryMoved);
            Assert.False(Directory.Exists(_environment.LegacyDataDirectory));
            Assert.Equal("session", Read(_environment.DataDirectory, @"cef\Network\Cookies"));
            Assert.Equal("{}", Read(_environment.DataDirectory, "desktop-settings.json"));
            Assert.Equal("{}", Read(_environment.DataDirectory, ".window-state.json"));
        }

        [Fact]
        public void Moves_Entries_Into_A_Yap_Folder_That_Only_Has_Installer_Logs()
        {
            Write(_environment.DataDirectory, @"logs\installer\installer.log", "new log");
            Write(_environment.LegacyDataDirectory, @"logs\installer\installer.log", "old log");
            Write(_environment.LegacyDataDirectory, @"cef\Network\Cookies", "session");

            LegacyCleanupResult result = Run();

            Assert.False(result.DataDirectoryMoved);
            Assert.Contains("cef", result.DataEntriesMoved);
            Assert.Equal("session", Read(_environment.DataDirectory, @"cef\Network\Cookies"));
            Assert.Equal("new log", Read(_environment.DataDirectory, @"logs\installer\installer.log"));
            Assert.False(Directory.Exists(_environment.LegacyDataDirectory));
        }

        [Fact]
        public void Never_Overwrites_Or_Deletes_Data_When_Both_Exist()
        {
            Write(_environment.DataDirectory, @"cef\Network\Cookies", "yap session");
            Write(_environment.DataDirectory, "desktop-settings.json", "yap");
            Write(_environment.LegacyDataDirectory, @"cef\Network\Cookies", "ralph session");
            Write(_environment.LegacyDataDirectory, "desktop-settings.json", "ralph");

            LegacyCleanupResult result = Run();

            Assert.Empty(result.DataEntriesMoved);
            Assert.Equal(new[] { "cef", "desktop-settings.json" }, result.DataEntriesKept.ToArray());
            Assert.Equal("yap session", Read(_environment.DataDirectory, @"cef\Network\Cookies"));
            Assert.Equal("yap", Read(_environment.DataDirectory, "desktop-settings.json"));
            Assert.Equal("ralph session", Read(_environment.LegacyDataDirectory, @"cef\Network\Cookies"));
            Assert.Equal("ralph", Read(_environment.LegacyDataDirectory, "desktop-settings.json"));
            Assert.False(result.LegacyDataDirectoryRemoved);
        }

        [Fact]
        public void Moves_Nothing_When_The_Profile_Is_Locked()
        {
            Write(_environment.DataDirectory, @"logs\installer\installer.log", "new log");
            Write(_environment.LegacyDataDirectory, @"cef\Network\Cookies", "session");
            Write(_environment.LegacyDataDirectory, "desktop-settings.json", "{}");

            LegacyCleanupResult result;
            using (new FileStream(
                Path.Combine(_environment.LegacyDataDirectory, @"cef\Network\Cookies"),
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read))
            {
                result = Run();
            }

            Assert.Empty(result.DataEntriesMoved);
            Assert.Equal("{}", Read(_environment.LegacyDataDirectory, "desktop-settings.json"));
            Assert.Equal("session", Read(_environment.LegacyDataDirectory, @"cef\Network\Cookies"));
            Assert.False(Directory.Exists(Path.Combine(_environment.DataDirectory, "cef")));

            // Once the handle is gone, a re-run (--cleanup-legacy) moves everything.
            result = Run();
            Assert.Contains("cef", result.DataEntriesMoved);
            Assert.Equal("session", Read(_environment.DataDirectory, @"cef\Network\Cookies"));
            Assert.False(Directory.Exists(_environment.LegacyDataDirectory));
        }

        [Theory]
        [InlineData("\"{legacy}\\RalphMeet.exe\" --autostart", "\"{new}\\Yap.exe\" --autostart")]
        [InlineData("\"{legacy}\\Update.exe\" --processStart RalphMeet.exe", "\"{new}\\Yap.exe\"")]
        [InlineData("\"{legacy}\\app-3.9.0\\RalphMeet.exe\"", "\"{new}\\Yap.exe\"")]
        public void Carries_Autostart_Over_To_The_Yap_Run_Value(string legacyCommand, string expected)
        {
            SetRun(LauncherMigration.LegacyRunValueName, Expand(legacyCommand));

            LegacyCleanupResult result = Run();

            Assert.True(result.AutostartCarriedOver);
            Assert.Equal(Expand(expected), GetRun(LauncherMigration.RunValueName));
            Assert.Null(GetRun(LauncherMigration.LegacyRunValueName));
        }

        [Fact]
        public void Keeps_An_Existing_Yap_Run_Value_And_Foreign_RalphMeet_Values()
        {
            SetRun(LauncherMigration.RunValueName, "\"" + NewStub + "\"");
            SetRun(LauncherMigration.LegacyRunValueName, "\"" + Legacy.RootStubPath + "\" --autostart");

            Assert.True(Run().AutostartCarriedOver);
            Assert.Equal("\"" + NewStub + "\"", GetRun(LauncherMigration.RunValueName));
            Assert.Null(GetRun(LauncherMigration.LegacyRunValueName));

            SetRun(LauncherMigration.LegacyRunValueName, "\"C:\\Elsewhere\\RalphMeet.exe\"");
            Assert.False(Run().AutostartCarriedOver);
            Assert.Equal("\"C:\\Elsewhere\\RalphMeet.exe\"", GetRun(LauncherMigration.LegacyRunValueName));
        }

        [Fact]
        public void Removes_Legacy_Shortcuts_Keys_Vulkan_Layers_And_Binaries()
        {
            foreach (string name in LegacyCleanup.ShortcutFileNames)
            {
                Write(_environment.DesktopDirectory, name, "lnk");
                Write(_environment.ProgramsDirectory, name, "lnk");
            }

            Write(_environment.DesktopDirectory, "Yap.lnk", "keep");
            _userRoot.CreateSubKey(LegacyCleanup.UninstallKeyPath).Dispose();
            _userRoot.CreateSubKey(LegacyCleanup.PublisherKeyPath).Dispose();
            _userRoot.CreateSubKey(LegacyCleanup.OldestUninstallKeyPath).Dispose();
            _userRoot.CreateSubKey(UninstallKeyPath).Dispose();

            string legacyLayer = Path.Combine(Legacy.RootPath, "capture-hook", "obs-33.0.1-c37f4412", "obs-vulkan64.json");
            string yapLayer = Path.Combine(_environment.Layout.RootPath, "capture-hook", "obs-33.0.1-c37f4412", "obs-vulkan64.json");
            using (RegistryKey layers = _userRoot.CreateSubKey(@"Software\Khronos\Vulkan\ImplicitLayers"))
            {
                layers.SetValue(legacyLayer, 0, RegistryValueKind.DWord);
                layers.SetValue(yapLayer, 0, RegistryValueKind.DWord);
            }

            CreateLegacyInstall();

            LegacyCleanupResult result = Run();

            Assert.Equal(4, result.ShortcutsRemoved);
            Assert.True(File.Exists(Path.Combine(_environment.DesktopDirectory, "Yap.lnk")));
            Assert.Null(_userRoot.OpenSubKey(LegacyCleanup.UninstallKeyPath));
            Assert.Null(_userRoot.OpenSubKey(LegacyCleanup.PublisherKeyPath));
            Assert.Null(_userRoot.OpenSubKey(LegacyCleanup.OldestUninstallKeyPath));
            Assert.NotNull(_userRoot.OpenSubKey(UninstallKeyPath));
            Assert.Equal(1, result.VulkanRegistrationsRemoved);
            using (RegistryKey layers = _userRoot.OpenSubKey(@"Software\Khronos\Vulkan\ImplicitLayers"))
            {
                Assert.Equal(new[] { yapLayer }, layers.GetValueNames());
            }

            Assert.True(result.LegacyInstallRootRemoved);
            Assert.False(Directory.Exists(Legacy.RootPath));
        }

        [Fact]
        public void Keeps_Unknown_Files_And_An_Unmoved_Legacy_Profile_In_The_Install_Root()
        {
            CreateLegacyInstall();
            Write(Legacy.RootPath, "notes.txt", "mine");
            Write(Legacy.RootPath, @"cef\Preferences", "old profile");
            Write(_environment.DataDirectory, @"cef\Preferences", "yap profile");

            LegacyCleanupResult result = Run();

            Assert.False(result.LegacyInstallRootRemoved);
            Assert.Equal("mine", Read(Legacy.RootPath, "notes.txt"));
            Assert.Equal("old profile", Read(Legacy.RootPath, @"cef\Preferences"));
            Assert.False(File.Exists(Legacy.RootStubPath));
            Assert.False(Directory.Exists(Path.Combine(Legacy.RootPath, "app-3.9.0")));
        }

        [Fact]
        public void Cleanup_Legacy_Registers_Yap_Deletes_RalphMeet_Scheme_And_Is_Idempotent()
        {
            CreateYapInstall();
            CreateLegacyInstall();
            Write(_environment.LegacyDataDirectory, "desktop-settings.json", "{}");
            DeepLinkRegistration.Register(_userRoot, Legacy.RootStubPath);
            RegisterRalphMeetScheme(DeepLinkRegistration.BuildLaunchCommand(Legacy.RootStubPath));
            SetRun(LauncherMigration.LegacyRunValueName, "\"" + Legacy.RootStubPath + "\" --autostart");
            string expectedCommand = DeepLinkRegistration.BuildLaunchCommand(NewStub);

            for (int run = 0; run < 2; run++)
            {
                LegacyCleanupResult result = InstallerLogic.RunLegacyCleanup(_environment, _userRoot);

                Assert.Null(_userRoot.OpenSubKey(DeepLinkRegistration.GetProtocolRegistryPath("ralphmeet")));
                Assert.Equal(expectedCommand, DeepLinkRegistration.ReadLaunchCommand(_userRoot, "yap"));
                Assert.Equal("\"" + NewStub + "\" --autostart", GetRun(LauncherMigration.RunValueName));
                Assert.Null(GetRun(LauncherMigration.LegacyRunValueName));
                Assert.Equal("{}", Read(_environment.DataDirectory, "desktop-settings.json"));
                Assert.False(Directory.Exists(Legacy.RootPath));
                Assert.True(result.LegacyInstallRootRemoved);
                Assert.Equal(run == 0, result.AutostartCarriedOver);
                Assert.Equal(run == 0 ? 2 : 0, result.DeepLinksRemoved);
            }
        }

        [Theory]
        [InlineData("yap")]
        [InlineData("legacy")]
        [InlineData("foreign")]
        public void Deletes_The_RalphMeet_Scheme_Whatever_It_Points_At(string target)
        {
            string command = target == "yap"
                ? DeepLinkRegistration.BuildLaunchCommand(NewStub)
                : target == "legacy"
                    ? DeepLinkRegistration.BuildLaunchCommand(Legacy.RootStubPath)
                    : "\"C:\\Elsewhere\\Other.exe\" \"%1\"";
            RegisterRalphMeetScheme(command);

            LegacyCleanupResult result = LegacyCleanup.RemoveLeftovers(_environment, _userRoot);

            Assert.Null(_userRoot.OpenSubKey(DeepLinkRegistration.GetProtocolRegistryPath("ralphmeet")));
            Assert.Equal(1, result.DeepLinksRemoved);
        }

        [Fact]
        public void Install_Registers_Only_The_Yap_Scheme()
        {
            DeepLinkRegistration.Register(_userRoot, NewStub);

            Assert.Equal(new[] { "yap" }, DeepLinkRegistration.SchemeNames);
            Assert.NotNull(DeepLinkRegistration.ReadLaunchCommand(_userRoot, "yap"));
            Assert.Null(_userRoot.OpenSubKey(DeepLinkRegistration.GetProtocolRegistryPath("ralphmeet")));
        }

        [Fact]
        public void Cleanup_Legacy_Refuses_Without_A_Yap_Install()
        {
            CreateLegacyInstall();

            Assert.Throws<InvalidOperationException>(() => InstallerLogic.RunLegacyCleanup(_environment, _userRoot));
            Assert.True(File.Exists(Legacy.RootStubPath));
        }

        [Fact]
        public void Removes_Older_Identity_Folders_Once_Yap_Has_Data()
        {
            string identifier = _environment.LegacyIdentifierDirectory;
            string preLocal = _environment.PreRalphMeetDirectories[0];
            string preRoaming = _environment.PreRalphMeetDirectories[1];
            Directory.CreateDirectory(identifier);
            Write(preLocal, @"logs\desktop.log", "log");
            Write(preLocal, @"notification-images\a.png", "png");
            Write(preLocal, "runtime-settings.json", "{}");
            Write(preRoaming, ".window-state.json", "{}");

            // No Yap data folder yet: nothing is touched.
            Run();
            Assert.True(Directory.Exists(identifier));
            Assert.True(File.Exists(Path.Combine(preLocal, "runtime-settings.json")));

            Write(_environment.DataDirectory, "runtime-settings.json", "{}");
            Write(_environment.DataDirectory, ".window-state.json", "{}");
            LegacyCleanupResult result = Run();

            Assert.Equal(3, result.OlderIdentityFoldersRemoved);
            Assert.False(Directory.Exists(identifier));
            Assert.False(Directory.Exists(preLocal));
            Assert.False(Directory.Exists(preRoaming));
            Assert.Equal(0, Run().OlderIdentityFoldersRemoved);
        }

        [Fact]
        public void Keeps_Older_Identity_Folders_With_Unknown_Or_Unmigrated_Entries()
        {
            string identifier = _environment.LegacyIdentifierDirectory;
            string preLocal = _environment.PreRalphMeetDirectories[0];
            Write(identifier, @"EBWebView\Default\Cache\x", "cache");
            Write(identifier, @"cef\Preferences", "profile");
            Write(preLocal, @"logs\desktop.log", "log");
            Write(preLocal, "desktop-settings.json", "pre");
            Write(preLocal, "notes.txt", "mine");
            Directory.CreateDirectory(_environment.DataDirectory);

            Run();

            Assert.False(Directory.Exists(Path.Combine(identifier, "EBWebView")));
            Assert.Equal("profile", Read(identifier, @"cef\Preferences"));
            Assert.False(Directory.Exists(Path.Combine(preLocal, "logs")));
            Assert.Equal("pre", Read(preLocal, "desktop-settings.json"));
            Assert.Equal("mine", Read(preLocal, "notes.txt"));
        }

        [Fact]
        public void Removes_Empty_RalphMeet_Folders_In_Every_Mode()
        {
            Directory.CreateDirectory(_environment.LegacyDataDirectory);
            Directory.CreateDirectory(Legacy.RootPath);

            LegacyCleanupResult result = LegacyCleanup.RemoveLeftovers(_environment, _userRoot);

            Assert.True(result.LegacyDataDirectoryRemoved);
            Assert.True(result.LegacyInstallRootRemoved);
            Assert.False(Directory.Exists(_environment.LegacyDataDirectory));
            Assert.False(Directory.Exists(Legacy.RootPath));
        }

        [Fact]
        public void Recognizes_The_Cleanup_Switch()
        {
            Assert.True(LegacyCleanup.IsCleanupRequest(new[] { "/S", "--CLEANUP-LEGACY" }));
            Assert.False(LegacyCleanup.IsCleanupRequest(new[] { "--uninstall" }));
            Assert.False(LegacyCleanup.IsCleanupRequest(null));
        }

        [Fact]
        public void Uninstall_Leftover_Removal_Keeps_User_Data()
        {
            CreateLegacyInstall();
            Write(_environment.LegacyDataDirectory, "desktop-settings.json", "{}");
            DeepLinkRegistration.Register(_userRoot, Legacy.RootStubPath);
            RegisterRalphMeetScheme(DeepLinkRegistration.BuildLaunchCommand(Legacy.RootStubPath));
            SetRun(LauncherMigration.LegacyRunValueName, "\"" + Legacy.RootStubPath + "\"");

            LegacyCleanup.RemoveLeftovers(_environment, _userRoot);

            Assert.Equal("{}", Read(_environment.LegacyDataDirectory, "desktop-settings.json"));
            Assert.False(Directory.Exists(_environment.DataDirectory));
            Assert.Null(_userRoot.OpenSubKey(DeepLinkRegistration.GetProtocolRegistryPath("ralphmeet")));
            Assert.Null(DeepLinkRegistration.ReadLaunchCommand(_userRoot, "yap"));
            Assert.Null(GetRun(LauncherMigration.LegacyRunValueName));
            Assert.False(Directory.Exists(Legacy.RootPath));
        }

        private void RegisterRalphMeetScheme(string command)
        {
            using (RegistryKey key = _userRoot.CreateSubKey(DeepLinkRegistration.GetProtocolRegistryPath("ralphmeet")))
            {
                key.SetValue(string.Empty, "URL:Ralph Meet Protocol");
                key.SetValue("URL Protocol", string.Empty);
                using (RegistryKey commandKey = key.CreateSubKey(@"shell\open\command"))
                {
                    commandKey.SetValue(string.Empty, command);
                }
            }
        }

        private LegacyCleanupResult Run()
        {
            return LegacyCleanup.Run(_environment, _userRoot, NewStub, string.Empty);
        }

        private void CreateLegacyInstall()
        {
            Write(Legacy.RootPath, "RalphMeet.exe", "stub");
            Write(Legacy.RootPath, "Update.exe", "update");
            Write(Legacy.RootPath, "current.json", "{\"currentVersion\":\"3.9.0\"}");
            Write(Legacy.RootPath, @"app-3.9.0\RalphMeet.exe", "app");
            Write(Legacy.RootPath, @"logs\desktop.log", "log");
            Write(Legacy.RootPath, @"capture-hook\obs-33.0.1-c37f4412\obs-vulkan64.json", "{}");
        }

        private void CreateYapInstall()
        {
            InstallRootLayout layout = _environment.Layout;
            Write(layout.RootPath, "Yap.exe", "stub");
            Write(layout.RootPath, @"app-4.0.0\Yap.exe", "app");
            new InstallState { CurrentVersion = "4.0.0" }.Save(layout.CurrentStatePath);
        }

        private string Expand(string command)
        {
            return command.Replace("{legacy}", Legacy.RootPath).Replace("{new}", _environment.Layout.RootPath);
        }

        private void SetRun(string name, string value)
        {
            using (RegistryKey run = _userRoot.CreateSubKey(LauncherMigration.RunKeyPath))
            {
                run.SetValue(name, value);
            }
        }

        private string GetRun(string name)
        {
            using (RegistryKey run = _userRoot.OpenSubKey(LauncherMigration.RunKeyPath))
            {
                return run?.GetValue(name) as string;
            }
        }

        private static void Write(string directory, string relativePath, string contents)
        {
            string path = Path.Combine(directory, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, contents);
        }

        private static string Read(string directory, string relativePath)
        {
            return File.ReadAllText(Path.Combine(directory, relativePath));
        }
    }
}
