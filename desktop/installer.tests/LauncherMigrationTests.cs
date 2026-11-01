using System;
using System.IO;
using Installer;
using Microsoft.Win32;
using Xunit;

namespace Installer.Tests
{
    public sealed class LauncherMigrationTests : IDisposable
    {
        private static readonly InstallRootLayout Layout = new InstallRootLayout("C:\\Users\\jon\\AppData\\Local\\RalphMeet");

        private readonly string _temp = Path.Combine(Path.GetTempPath(), "installer-tests-" + Guid.NewGuid().ToString("N"));
        private readonly string _registryPath = @"Software\115jon\RalphMeetTests\" + Guid.NewGuid().ToString("N");

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
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\Update.exe\" --processStart RalphMeet.exe", "")]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\Update.exe\" --processStart \"RalphMeet.exe\" --minimized", "--minimized")]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\app-3.4.0\\RalphMeet.exe\"", "")]
        [InlineData("C:\\Users\\jon\\AppData\\Local\\RalphMeet\\app-3.4.0\\RalphMeet.exe --autostart", "--autostart")]
        [InlineData("\"c:\\users\\jon\\appdata\\local\\ralphmeet\\ralphmeet.exe\"", "")]
        public void TryParseOwnedCommand_Accepts_This_Installs_Launchers(string command, string expectedArguments)
        {
            Assert.True(LauncherMigration.TryParseOwnedCommand(command, Layout, out string arguments));
            Assert.Equal(expectedArguments, arguments);
        }

        [Theory]
        [InlineData("\"C:\\Program Files\\Other\\Update.exe\" --processStart RalphMeet.exe")]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\staging\\x\\RalphMeet.exe\"")]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\app-3.4.0\\inject-helper64.exe\"")]
        [InlineData("\"C:\\Users\\jon\\AppData\\Local\\Discord\\Update.exe\" --processStart Discord.exe")]
        [InlineData("")]
        public void TryParseOwnedCommand_Rejects_Other_Commands(string command)
        {
            Assert.False(LauncherMigration.TryParseOwnedCommand(command, Layout, out _));
        }

        [Fact]
        public void BuildStubCommand_Quotes_The_Stub()
        {
            Assert.Equal("\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\RalphMeet.exe\"", LauncherMigration.BuildStubCommand(Layout, ""));
            Assert.Equal(
                "\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\RalphMeet.exe\" --minimized",
                LauncherMigration.BuildStubCommand(Layout, "--minimized"));
        }

        [Fact]
        public void MigrateRunValue_Rewrites_Only_Our_Value()
        {
            using (RegistryKey userRoot = Registry.CurrentUser.CreateSubKey(_registryPath))
            using (RegistryKey run = userRoot.CreateSubKey(LauncherMigration.RunKeyPath))
            {
                Assert.False(LauncherMigration.MigrateRunValue(userRoot, Layout));

                run.SetValue("RalphMeet", "\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\Update.exe\" --processStart RalphMeet.exe");
                run.SetValue("Other", "\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\Update.exe\" --processStart RalphMeet.exe");

                Assert.True(LauncherMigration.MigrateRunValue(userRoot, Layout));
                Assert.Equal("\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\RalphMeet.exe\"", run.GetValue("RalphMeet"));
                Assert.False(LauncherMigration.MigrateRunValue(userRoot, Layout));
                Assert.Equal("\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\Update.exe\" --processStart RalphMeet.exe", run.GetValue("Other"));

                run.SetValue("RalphMeet", "\"C:\\Elsewhere\\RalphMeet.exe\"");
                Assert.False(LauncherMigration.MigrateRunValue(userRoot, Layout));
                Assert.False(LauncherMigration.RemoveRunValueIfOwned(userRoot, Layout));
                Assert.Equal("\"C:\\Elsewhere\\RalphMeet.exe\"", run.GetValue("RalphMeet"));

                run.SetValue("RalphMeet", "\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\RalphMeet.exe\"");
                Assert.True(LauncherMigration.RemoveRunValueIfOwned(userRoot, Layout));
                Assert.Null(run.GetValue("RalphMeet"));
            }
        }

        [Fact]
        public void ShellLink_Roundtrips_AppUserModelId()
        {
            string target = Path.Combine(_temp, "RalphMeet.exe");
            File.WriteAllText(target, "stub");
            string shortcut = Path.Combine(_temp, "RalphMeet.lnk");

            ShellLink.Save(shortcut, new ShellLinkData
            {
                TargetPath = target,
                Arguments = "--flag",
                WorkingDirectory = _temp,
                IconPath = target,
                Description = "RalphMeet",
                AppUserModelId = RootLauncher.AppUserModelId
            });

            ShellLinkData loaded = ShellLink.Load(shortcut);
            Assert.Equal(target, loaded.TargetPath, ignoreCase: true);
            Assert.Equal("--flag", loaded.Arguments);
            Assert.Equal(_temp, loaded.WorkingDirectory, ignoreCase: true);
            Assert.Equal("RalphMeet", loaded.Description);
            Assert.Equal("site.115jon.ralphmeet", loaded.AppUserModelId);
        }

        [Fact]
        public void RetargetPinnedShortcuts_Moves_Our_Pins_To_The_Stub()
        {
            string root = Path.Combine(_temp, "RalphMeet");
            InstallRootLayout layout = new InstallRootLayout(root);
            string versionDirectory = Path.Combine(root, "app-3.4.0");
            Directory.CreateDirectory(versionDirectory);
            File.WriteAllText(layout.RootStubPath, "stub");
            File.WriteAllText(layout.UpdateExePath, "update");
            File.WriteAllText(Path.Combine(versionDirectory, "RalphMeet.exe"), "app");
            string otherTarget = Path.Combine(_temp, "Other.exe");
            File.WriteAllText(otherTarget, "other");

            string pins = Path.Combine(_temp, "TaskBar");
            Directory.CreateDirectory(pins);
            ShellLink.Save(Path.Combine(pins, "RalphMeet.lnk"), new ShellLinkData
            {
                TargetPath = layout.UpdateExePath,
                Arguments = "--processStart RalphMeet.exe",
                Description = "RalphMeet"
            });
            ShellLink.Save(Path.Combine(pins, "RalphMeet (2).lnk"), new ShellLinkData
            {
                TargetPath = Path.Combine(versionDirectory, "RalphMeet.exe")
            });
            ShellLink.Save(Path.Combine(pins, "Other.lnk"), new ShellLinkData { TargetPath = otherTarget });

            Assert.Equal(2, LauncherMigration.RetargetPinnedShortcuts(pins, layout));

            foreach (string name in new[] { "RalphMeet.lnk", "RalphMeet (2).lnk" })
            {
                ShellLinkData pin = ShellLink.Load(Path.Combine(pins, name));
                Assert.Equal(layout.RootStubPath, pin.TargetPath, ignoreCase: true);
                Assert.Equal(string.Empty, pin.Arguments);
                Assert.Equal("site.115jon.ralphmeet", pin.AppUserModelId);
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
