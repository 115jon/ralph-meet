using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
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

        [Fact]
        public void RequiredPayloadPaths_Are_All_Shipped_By_The_Payload_Manifest()
        {
            // 3.8.0 moved the capture hook to obs-capture/obs-signed/ in the manifest while
            // the installer still required obs-capture/graphics-hook64.dll, so every install failed.
            string manifest = File.ReadAllText(FindPayloadManifest());
            HashSet<string> shipped = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Match entry in Regex.Matches(manifest, @"\{[^{}]*\}"))
            {
                Match from = Regex.Match(entry.Value, @"""from""\s*:\s*""([^""]+)""");
                Match to = Regex.Match(entry.Value, @"""to""\s*:\s*""([^""]+)""");
                if (from.Success)
                {
                    shipped.Add((to.Success ? to.Groups[1].Value : from.Groups[1].Value).Replace('\\', '/'));
                }
            }

            foreach (string required in ActivationManager.RequiredPayloadPaths)
            {
                Assert.Contains(required.Replace('\\', '/'), shipped);
            }
        }

        [Fact]
        public void Activate_Rejects_A_Payload_Without_A_Required_File()
        {
            string tempRoot = CreateTempDirectory();

            try
            {
                InstallRootLayout layout = new InstallRootLayout(tempRoot);
                string stagingDirectoryPath = CreateStagedPayload(layout.StagingPath, "app-1.13.0");
                File.Delete(Path.Combine(stagingDirectoryPath, ActivationManager.RequiredPayloadPaths[1]));

                Assert.Throws<FileNotFoundException>(() => ActivationManager.Activate(layout, stagingDirectoryPath, "1.13.0"));
                Assert.False(File.Exists(layout.CurrentStatePath));
            }
            finally
            {
                Directory.Delete(tempRoot, true);
            }
        }

        private static string FindPayloadManifest()
        {
            string directory = AppDomain.CurrentDomain.BaseDirectory;
            while (!string.IsNullOrEmpty(directory))
            {
                string candidate = Path.Combine(directory, "packaging", "payload-manifest.json");
                if (File.Exists(candidate))
                {
                    return candidate;
                }
                directory = Path.GetDirectoryName(directory.TrimEnd(Path.DirectorySeparatorChar));
            }
            throw new FileNotFoundException("desktop/packaging/payload-manifest.json was not found above the test output.");
        }

        private static string CreateStagedPayload(string stagingRoot, string directoryName)
        {
            string stagingDirectoryPath = Path.Combine(stagingRoot, directoryName + "." + Guid.NewGuid().ToString("N") + ".tmp");
            foreach (string relativePath in ActivationManager.RequiredPayloadPaths)
            {
                string fullPath = Path.Combine(stagingDirectoryPath, relativePath);
                Directory.CreateDirectory(Path.GetDirectoryName(fullPath));
                File.WriteAllText(fullPath, "stub");
            }
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
