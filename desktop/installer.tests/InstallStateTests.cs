using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Installer;
using Xunit;

namespace Installer.Tests
{
    public sealed class InstallStateTests
    {
        [Fact]
        public void InstallState_RoundTrips_CurrentJson()
        {
            string tempRoot = CreateTempDirectory();

            try
            {
                string statePath = Path.Combine(tempRoot, "current.json");
                InstallState expected = new InstallState
                {
                    CurrentVersion = "1.13.0",
                    PreviousVersion = "1.12.0",
                    ActivatedAtUtc = "2026-06-29T10:00:00Z",
                    PendingCleanup = new List<string> { "app-1.11.0", "staging/app-1.10.0.tmp" },
                    LastLaunchSucceeded = true
                };

                expected.Save(statePath);
                InstallState actual = InstallState.Load(statePath);

                Assert.Equal(expected.CurrentVersion, actual.CurrentVersion);
                Assert.Equal(expected.PreviousVersion, actual.PreviousVersion);
                Assert.Equal(expected.ActivatedAtUtc, actual.ActivatedAtUtc);
                Assert.Equal(expected.LastLaunchSucceeded, actual.LastLaunchSucceeded);
                Assert.Equal(expected.PendingCleanup, actual.PendingCleanup);
            }
            finally
            {
                DeleteDirectory(tempRoot);
            }
        }

        [Fact]
        public void InstallRootLayout_Produces_VersionedPaths_AndCleanupCandidates()
        {
            string tempRoot = CreateTempDirectory();

            try
            {
                Directory.CreateDirectory(Path.Combine(tempRoot, "app-1.11.0"));
                Directory.CreateDirectory(Path.Combine(tempRoot, "app-1.12.0"));
                Directory.CreateDirectory(Path.Combine(tempRoot, "app-1.13.0"));

                InstallRootLayout layout = new InstallRootLayout(tempRoot);
                InstallState state = new InstallState
                {
                    CurrentVersion = "1.13.0",
                    PreviousVersion = "1.12.0"
                };

                Assert.Equal(Path.Combine(tempRoot, "Update.exe"), layout.UpdateExePath);
                Assert.Equal(Path.Combine(tempRoot, "current.json"), layout.CurrentStatePath);
                Assert.Equal(Path.Combine(tempRoot, "staging"), layout.StagingPath);
                Assert.Equal(Path.Combine(tempRoot, "logs", "installer"), layout.InstallerLogsPath);
                Assert.Equal(Path.Combine(tempRoot, "app-1.13.0"), layout.GetVersionDirectoryPath("1.13.0"));

                string[] cleanupCandidates = layout.GetCleanupCandidateDirectoryNames(state).ToArray();
                Assert.Equal(new[] { "app-1.11.0" }, cleanupCandidates);
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
