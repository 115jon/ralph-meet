using System;
using System.Diagnostics;
using System.IO;
using Installer;
using Xunit;

namespace Installer.Tests
{
    public sealed class RootLauncherTests : IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), "installer-tests-" + Guid.NewGuid().ToString("N"));
        private readonly InstallRootLayout _layout;

        public RootLauncherTests()
        {
            Directory.CreateDirectory(_root);
            _layout = new InstallRootLayout(_root);
        }

        public void Dispose()
        {
            try
            {
                Directory.Delete(_root, true);
            }
            catch (IOException)
            {
            }
        }

        [Fact]
        public void Refresh_Copies_Payload_Launcher_To_Root()
        {
            string active = CreateVersion("3.6.0", "stub-v2");

            Assert.True(RootLauncher.Refresh(_layout, active));

            Assert.Equal("stub-v2", File.ReadAllText(_layout.RootStubPath));
            Assert.False(File.Exists(_layout.RootStubPath + ".new"));
        }

        [Fact]
        public void Refresh_Replaces_An_Unlocked_Stub_In_Place()
        {
            File.WriteAllText(_layout.RootStubPath, "stub-v1");
            string active = CreateVersion("3.6.0", "stub-v2");

            Assert.True(RootLauncher.Refresh(_layout, active));

            Assert.Equal("stub-v2", File.ReadAllText(_layout.RootStubPath));
            Assert.Empty(Directory.GetFiles(_root, "RalphMeet.exe*.old"));
        }

        [Fact]
        public void Refresh_Keeps_Existing_Stub_When_Payload_Has_None()
        {
            File.WriteAllText(_layout.RootStubPath, "stub-v1");
            string active = Path.Combine(_root, "app-3.6.0");
            Directory.CreateDirectory(active);

            Assert.True(RootLauncher.Refresh(_layout, active));
            Assert.Equal("stub-v1", File.ReadAllText(_layout.RootStubPath));
        }

        [Fact]
        public void Refresh_Moves_A_Running_Stub_Aside_And_Cleans_It_Up_Later()
        {
            // A running image can be renamed but not deleted or overwritten, like a stub that is
            // still starting the app while an update activates.
            string ping = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "PING.EXE");
            File.Copy(ping, _layout.RootStubPath);
            // A stale .old that is not in use is replaced.
            File.WriteAllText(_layout.RootStubPath + ".old", "older");
            string active = CreateVersion("3.6.0", "stub-v2");

            using (Process running = Process.Start(new ProcessStartInfo
            {
                FileName = _layout.RootStubPath,
                Arguments = "-n 30 127.0.0.1",
                UseShellExecute = false,
                CreateNoWindow = true
            }))
            {
                try
                {
                    Assert.Throws<UnauthorizedAccessException>(() => File.Delete(_layout.RootStubPath));

                    Assert.True(RootLauncher.Refresh(_layout, active));

                    Assert.Equal("stub-v2", File.ReadAllText(_layout.RootStubPath));
                    Assert.True(File.Exists(_layout.RootStubPath + ".old"));
                    Assert.Equal(new FileInfo(ping).Length, new FileInfo(_layout.RootStubPath + ".old").Length);

                    // While the old copy runs, cleanup leaves it alone.
                    RootLauncher.DeleteOldCopies(_layout);
                    Assert.True(File.Exists(_layout.RootStubPath + ".old"));
                }
                finally
                {
                    running.Kill();
                    running.WaitForExit();
                }
            }

            WaitUntilDeletable(_layout.RootStubPath + ".old");
            RootLauncher.DeleteOldCopies(_layout);
            Assert.Empty(Directory.GetFiles(_root, "RalphMeet.exe*.old"));
        }

        [Fact]
        public void ResolveEntryPoint_Prefers_Stub_Then_UpdateExe()
        {
            RootLauncher.ResolveEntryPoint(_layout, out string path, out string arguments);
            Assert.Equal(_layout.UpdateExePath, path);
            Assert.Equal("--processStart RalphMeet.exe", arguments);

            File.WriteAllText(_layout.RootStubPath, "stub");
            RootLauncher.ResolveEntryPoint(_layout, out path, out arguments);
            Assert.Equal(_layout.RootStubPath, path);
            Assert.Equal(string.Empty, arguments);
        }

        [Fact]
        public void Root_Stub_Is_Preserved_By_Root_Cleanup()
        {
            Assert.Contains("RalphMeet.exe", _layout.GetPreservedRootEntryNames());
            Assert.Contains(_layout.RootStubPath, _layout.GetInstalledExecutablePaths(InstallerLogic.ExecutableFileName));
        }

        private string CreateVersion(string version, string launcherContents)
        {
            string directory = Path.Combine(_root, "app-" + version);
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, RootLauncher.PayloadFileName), launcherContents);
            return directory;
        }

        private static void WaitUntilDeletable(string path)
        {
            for (int attempt = 0; attempt < 40; attempt++)
            {
                try
                {
                    using (File.Open(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                    {
                        return;
                    }
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    System.Threading.Thread.Sleep(50);
                }
            }
        }
    }
}
