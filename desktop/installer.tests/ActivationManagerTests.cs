using System;
using System.IO;
using Installer;
using Xunit;

namespace Installer.Tests
{
    public sealed class ActivationManagerTests
    {
        [Fact]
        public void Activate_Moves_StagedPayload_Into_VersionDirectory_AndUpdates_CurrentState()
        {
            string tempRoot = CreateTempDirectory();

            try
            {
                InstallRootLayout layout = new InstallRootLayout(tempRoot);
                Directory.CreateDirectory(Path.Combine(tempRoot, "app-1.11.0"));
                Directory.CreateDirectory(Path.Combine(tempRoot, "app-1.12.0"));

                new InstallState
                {
                    CurrentVersion = "1.12.0",
                    PreviousVersion = "1.11.0"
                }.Save(layout.CurrentStatePath);

                string stagingDirectoryPath = CreateStagedPayload(layout.StagingPath, "app-1.13.0");
                string obsoleteDirectoryPath = Path.Combine(tempRoot, "app-1.10.0");
                Directory.CreateDirectory(obsoleteDirectoryPath);

                ActivationResult result = ActivationManager.Activate(layout, stagingDirectoryPath, "1.13.0");
                InstallState state = InstallState.Load(layout.CurrentStatePath);

                Assert.Equal("1.13.0", result.ActiveVersion);
                Assert.True(Directory.Exists(Path.Combine(tempRoot, "app-1.13.0")));
                Assert.False(Directory.Exists(stagingDirectoryPath));
                Assert.Equal("1.13.0", state.CurrentVersion);
                Assert.Equal("1.12.0", state.PreviousVersion);
                Assert.True(Directory.Exists(Path.Combine(tempRoot, "app-1.12.0")));
                Assert.False(Directory.Exists(obsoleteDirectoryPath));
            }
            finally
            {
                DeleteDirectory(tempRoot);
            }
        }

        [Fact]
        public void Activate_DoesNotRewrite_CurrentState_WhenValidationFails()
        {
            string tempRoot = CreateTempDirectory();

            try
            {
                InstallRootLayout layout = new InstallRootLayout(tempRoot);
                InstallState originalState = new InstallState
                {
                    CurrentVersion = "1.12.0",
                    PreviousVersion = "1.11.0"
                };
                originalState.Save(layout.CurrentStatePath);

                string stagingDirectoryPath = Path.Combine(layout.StagingPath, "app-1.13.0.tmp");
                Directory.CreateDirectory(stagingDirectoryPath);
                File.WriteAllText(Path.Combine(stagingDirectoryPath, "RalphMeet.exe"), "stub");

                Assert.Throws<FileNotFoundException>(() =>
                    ActivationManager.Activate(layout, stagingDirectoryPath, "1.13.0"));

                InstallState state = InstallState.Load(layout.CurrentStatePath);
                Assert.Equal("1.12.0", state.CurrentVersion);
                Assert.Equal("1.11.0", state.PreviousVersion);
                Assert.False(Directory.Exists(Path.Combine(tempRoot, "app-1.13.0")));
            }
            finally
            {
                DeleteDirectory(tempRoot);
            }
        }

        private static string CreateStagedPayload(string stagingRoot, string directoryName)
        {
            string stagingDirectoryPath = Path.Combine(stagingRoot, directoryName + "." + Guid.NewGuid().ToString("N") + ".tmp");
            Directory.CreateDirectory(Path.Combine(stagingDirectoryPath, "obs-capture"));
            File.WriteAllText(Path.Combine(stagingDirectoryPath, "RalphMeet.exe"), "stub");
            File.WriteAllText(Path.Combine(stagingDirectoryPath, "obs-capture", "graphics-hook64.dll"), "stub");
            return stagingDirectoryPath;
        }

        private static string CreateTempDirectory()
        {
            string path = Path.Combine(Path.GetTempPath(), "installer-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(path);
            return path;
        }

        private static void DeleteDirectory(string path)
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, true);
            }
        }
    }
}
