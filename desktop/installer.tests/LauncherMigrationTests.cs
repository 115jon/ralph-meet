using System;
using System.IO;
using Installer;
using Microsoft.Win32;
using Xunit;

namespace Installer.Tests
{
    public sealed class LauncherMigrationTests : IDisposable
    {
        private static readonly InstallRootLayout Layout = new InstallRootLayout("C:\\Users\\jon\\AppData\\Local\\Yap");

        private readonly string _temp = Path.Combine(Path.GetTempPath(), "installer-tests-" + Guid.NewGuid().ToString("N"));
        private readonly string _registryPath = @"Software\115jon\YapTests\" + Guid.NewGuid().ToString("N");

        public LauncherMigrationTests()
        {
            Directory.CreateDirectory(_temp);
        }

        public void Dispose()
        {
            Registry.CurrentUser.DeleteSubKeyTree(_registryPath, false);
            try
            {
                Directory.Delete(_temp, true);
            }
            catch (IOException)
            {
            }
        }

        [Theory]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\Yap\\Update.exe\" --processStart Yap.exe", "")]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\Yap\\Update.exe\" --processStart \"Yap.exe\" --minimized", "--minimized")]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\Yap\\app-3.4.0\\Yap.exe\"", "")]
        [InlineData("C:\\Users\\jon\\AppData\\Local\\Yap\\app-3.4.0\\Yap.exe --autostart", "--autostart")]
        [InlineData("\"c:\\users\\jon\\appdata\\local\\yap\\yap.exe\"", "")]
        public void TryParseOwnedCommand_Accepts_This_Installs_Launchers(string command, string expectedArguments)
        {
            Assert.True(LauncherMigration.TryParseOwnedCommand(command, Layout, out string arguments));
            Assert.Equal(expectedArguments, arguments);
        }

        [Theory]
        [InlineData("\"C:\\Program Files\\Other\\Update.exe\" --processStart Yap.exe")]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\Yap\\staging\\x\\Yap.exe\"")]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\Yap\\app-3.4.0\\inject-helper64.exe\"")]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\Discord\\Update.exe\" --processStart Discord.exe")]
        [InlineData("")]
        public void TryParseOwnedCommand_Rejects_Other_Commands(string command)
        {
            Assert.False(LauncherMigration.TryParseOwnedCommand(command, Layout, out _));
        }

        [Fact]
        public void BuildStubCommand_Quotes_The_Stub()
        {
            Assert.Equal("\"C:\\Users\\jon\\AppData\\Local\\Yap\\Yap.exe\"", LauncherMigration.BuildStubCommand(Layout, ""));
            Assert.Equal(
                "\"C:\\Users\\jon\\AppData\\Local\\Yap\\Yap.exe\" --minimized",
                LauncherMigration.BuildStubCommand(Layout, "--minimized"));
        }

        [Fact]
        public void MigrateRunValue_Rewrites_Only_Our_Value()
        {
            using (RegistryKey userRoot = Registry.CurrentUser.CreateSubKey(_registryPath))
            using (RegistryKey run = userRoot.CreateSubKey(LauncherMigration.RunKeyPath))
            {
                Assert.False(LauncherMigration.MigrateRunValue(userRoot, Layout));

                run.SetValue("Yap", "\"C:\\Users\\jon\\AppData\\Local\\Yap\\Update.exe\" --processStart Yap.exe");
                run.SetValue("Other", "\"C:\\Users\\jon\\AppData\\Local\\Yap\\Update.exe\" --processStart Yap.exe");

                Assert.True(LauncherMigration.MigrateRunValue(userRoot, Layout));
                Assert.Equal("\"C:\\Users\\jon\\AppData\\Local\\Yap\\Yap.exe\"", run.GetValue("Yap"));
                Assert.False(LauncherMigration.MigrateRunValue(userRoot, Layout));
                Assert.Equal("\"C:\\Users\\jon\\AppData\\Local\\Yap\\Update.exe\" --processStart Yap.exe", run.GetValue("Other"));

                run.SetValue("Yap", "\"C:\\Elsewhere\\Yap.exe\"");
                Assert.False(LauncherMigration.MigrateRunValue(userRoot, Layout));
                Assert.False(LauncherMigration.RemoveRunValueIfOwned(userRoot, Layout));
                Assert.Equal("\"C:\\Elsewhere\\Yap.exe\"", run.GetValue("Yap"));

                run.SetValue("Yap", "\"C:\\Users\\jon\\AppData\\Local\\Yap\\Yap.exe\"");
                Assert.True(LauncherMigration.RemoveRunValueIfOwned(userRoot, Layout));
                Assert.Null(run.GetValue("Yap"));
            }
        }

        [Fact]
        public void ShellLink_Roundtrips_AppUserModelId()
        {
            string target = Path.Combine(_temp, "Yap.exe");
            File.WriteAllText(target, "stub");
            string shortcut = Path.Combine(_temp, "Yap.lnk");

            ShellLink.Save(shortcut, new ShellLinkData
            {
                TargetPath = target,
                Arguments = "--flag",
                WorkingDirectory = _temp,
                IconPath = target,
                Description = "Yap",
                AppUserModelId = RootLauncher.AppUserModelId
            });

            ShellLinkData loaded = ShellLink.Load(shortcut);
            Assert.Equal(target, loaded.TargetPath, ignoreCase: true);
            Assert.Equal("--flag", loaded.Arguments);
            Assert.Equal(_temp, loaded.WorkingDirectory, ignoreCase: true);
            Assert.Equal("Yap", loaded.Description);
            Assert.Equal("com.115jon.yap", loaded.AppUserModelId);
        }

        [Fact]
        public void RetargetPinnedShortcuts_Moves_Our_Pins_To_The_Stub()
        {
            string root = Path.Combine(_temp, "Yap");
            InstallRootLayout layout = new InstallRootLayout(root);
            string versionDirectory = Path.Combine(root, "app-3.4.0");
            Directory.CreateDirectory(versionDirectory);
            File.WriteAllText(layout.RootStubPath, "stub");
            File.WriteAllText(layout.UpdateExePath, "update");
            File.WriteAllText(Path.Combine(versionDirectory, "Yap.exe"), "app");
            string otherTarget = Path.Combine(_temp, "Other.exe");
            File.WriteAllText(otherTarget, "other");

            string pins = Path.Combine(_temp, "TaskBar");
            Directory.CreateDirectory(pins);
            ShellLink.Save(Path.Combine(pins, "Yap.lnk"), new ShellLinkData
            {
                TargetPath = layout.UpdateExePath,
                Arguments = "--processStart Yap.exe",
                Description = "Yap"
            });
            ShellLink.Save(Path.Combine(pins, "Yap (2).lnk"), new ShellLinkData
            {
                TargetPath = Path.Combine(versionDirectory, "Yap.exe")
            });
            ShellLink.Save(Path.Combine(pins, "Other.lnk"), new ShellLinkData { TargetPath = otherTarget });

            Assert.Equal(2, LauncherMigration.RetargetPinnedShortcuts(pins, layout));

            foreach (string name in new[] { "Yap.lnk", "Yap (2).lnk" })
            {
                ShellLinkData pin = ShellLink.Load(Path.Combine(pins, name));
                Assert.Equal(layout.RootStubPath, pin.TargetPath, ignoreCase: true);
                Assert.Equal(string.Empty, pin.Arguments);
                Assert.Equal("com.115jon.yap", pin.AppUserModelId);
            }

            Assert.Equal(otherTarget, ShellLink.Load(Path.Combine(pins, "Other.lnk")).TargetPath, ignoreCase: true);
            Assert.Null(ShellLink.Load(Path.Combine(pins, "Other.lnk")).AppUserModelId);
            // Already current pins are left alone.
            Assert.Equal(0, LauncherMigration.RetargetPinnedShortcuts(pins, layout));
        }

        [Fact]
        public void Sandbox_Environment_Redirects_Everything_Beside_The_Root()
        {
            string root = Path.Combine(_temp, "Sandbox");
            InstallEnvironment environment = InstallEnvironment.FromSandboxRoot(root);

            Assert.True(environment.IsSandbox);
            Assert.Equal(root, environment.Layout.RootPath);
            foreach (string path in new[]
            {
                environment.DesktopDirectory,
                environment.ProgramsDirectory,
                environment.TaskbarPinsDirectory,
                environment.LegacyInstallDirectory,
                environment.LogsDirectory
            })
            {
                Assert.StartsWith(root + ".sandbox" + Path.DirectorySeparatorChar, path);
            }

            Assert.False(InstallEnvironment.FromSandboxRoot(null).IsSandbox);
        }
    }
}
