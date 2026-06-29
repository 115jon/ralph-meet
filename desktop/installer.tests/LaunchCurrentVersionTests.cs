using System;
using System.IO;
using Installer;
using Xunit;

namespace Installer.Tests
{
    public sealed class LaunchCurrentVersionTests
    {
        [Fact]
        public void CreateLaunchRequest_Resolves_ActiveVersion_AndPassesThroughArgs()
        {
            string tempRoot = CreateTempDirectory();

            try
            {
                string updateExePath = Path.Combine(tempRoot, "Update.exe");
                string versionDirectoryPath = Path.Combine(tempRoot, "app-1.13.0");
                string appExePath = Path.Combine(versionDirectoryPath, "RalphMeet.exe");

                File.WriteAllText(updateExePath, "stub");
                Directory.CreateDirectory(versionDirectoryPath);
                File.WriteAllText(appExePath, "stub");

                new InstallState
                {
                    CurrentVersion = "1.13.0",
                    PreviousVersion = "1.12.0"
                }.Save(Path.Combine(tempRoot, "current.json"));

                LaunchRequest request = LaunchCurrentVersion.CreateLaunchRequest(
                    updateExePath,
                    new[] { "--processStart", "RalphMeet.exe", "ralphmeet://join/test?room=abc" });

                Assert.Equal(appExePath, request.ExecutablePath);
                Assert.Equal(versionDirectoryPath, request.WorkingDirectory);
                Assert.Equal("ralphmeet://join/test?room=abc", request.Arguments);
                Assert.Equal("1.13.0", request.ActiveVersion);
            }
            finally
            {
                DeleteDirectory(tempRoot);
            }
        }

        [Fact]
        public void CreateLaunchRequest_Fails_Clearly_WhenCurrentStateIsMissing()
        {
            string tempRoot = CreateTempDirectory();

            try
            {
                string updateExePath = Path.Combine(tempRoot, "Update.exe");
                File.WriteAllText(updateExePath, "stub");

                InvalidOperationException error = Assert.Throws<InvalidOperationException>(() =>
                    LaunchCurrentVersion.CreateLaunchRequest(
                        updateExePath,
                        new[] { "--processStart", "RalphMeet.exe" }));

                Assert.Contains("current.json", error.Message);
            }
            finally
            {
                DeleteDirectory(tempRoot);
            }
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
