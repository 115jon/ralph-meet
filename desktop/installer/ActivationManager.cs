using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Installer
{
    public sealed class ActivationResult
    {
        public ActivationResult(string activeVersion, string activeDirectoryPath, InstallState installState)
        {
            ActiveVersion = activeVersion;
            ActiveDirectoryPath = activeDirectoryPath;
            InstallState = installState;
        }

        public string ActiveVersion { get; }

        public string ActiveDirectoryPath { get; }

        public InstallState InstallState { get; }

        public string ActiveExecutablePath => Path.Combine(ActiveDirectoryPath, InstallerLogic.ExecutableFileName);
    }

    public static class ActivationManager
    {
        private static readonly string[] RequiredPayloadPaths =
        {
            InstallerLogic.ExecutableFileName,
            Path.Combine("obs-capture", "graphics-hook64.dll")
        };

        public static string PrepareStagingDirectory(InstallRootLayout layout, string versionHint)
        {
            if (layout == null)
            {
                throw new ArgumentNullException(nameof(layout));
            }

            Directory.CreateDirectory(layout.RootPath);
            Directory.CreateDirectory(layout.StagingPath);

            foreach (string staleDirectoryPath in Directory.GetDirectories(layout.StagingPath))
            {
                TryDeleteDirectory(staleDirectoryPath, "Deleting stale staging directory");
            }

            string stagingDirectoryPath = layout.CreateUniqueStagingDirectoryPath(versionHint);
            Directory.CreateDirectory(stagingDirectoryPath);
            return stagingDirectoryPath;
        }

        public static ActivationResult Activate(InstallRootLayout layout, string stagingDirectoryPath, string version)
        {
            if (layout == null)
            {
                throw new ArgumentNullException(nameof(layout));
            }

            string normalizedVersion = InstallRootLayout.NormalizeVersion(version);
            if (string.IsNullOrWhiteSpace(normalizedVersion))
            {
                throw new InvalidOperationException("Installer payload version could not be determined.");
            }

            if (string.IsNullOrWhiteSpace(stagingDirectoryPath) || !Directory.Exists(stagingDirectoryPath))
            {
                throw new DirectoryNotFoundException("Staged payload directory was not found: " + stagingDirectoryPath);
            }

            ValidatePayload(stagingDirectoryPath);

            InstallState previousState = InstallState.LoadIfExists(layout.CurrentStatePath);
            string targetDirectoryPath = layout.GetVersionDirectoryPath(normalizedVersion);

            if (Directory.Exists(targetDirectoryPath))
            {
                InstallerLogger.Warn("Deleting existing target version directory before activation: " + targetDirectoryPath);
                Directory.Delete(targetDirectoryPath, true);
            }

            Directory.Move(stagingDirectoryPath, targetDirectoryPath);

            InstallState newState = BuildState(previousState, normalizedVersion);
            newState.Save(layout.CurrentStatePath);

            List<string> pendingCleanup = CleanupObsoleteDirectories(layout, newState);
            newState.PendingCleanup = pendingCleanup;
            newState.Save(layout.CurrentStatePath);

            return new ActivationResult(normalizedVersion, targetDirectoryPath, newState);
        }

        private static InstallState BuildState(InstallState previousState, string newVersion)
        {
            string previousVersion = previousState?.CurrentVersion;
            if (string.Equals(previousVersion, newVersion, StringComparison.OrdinalIgnoreCase))
            {
                previousVersion = previousState?.PreviousVersion;
            }

            InstallState state = new InstallState
            {
                CurrentVersion = newVersion,
                PreviousVersion = string.IsNullOrWhiteSpace(previousVersion) ? null : previousVersion.Trim(),
                LastLaunchSucceeded = previousState?.LastLaunchSucceeded
            };
            state.MarkActivatedNowUtc();
            return state;
        }

        private static List<string> CleanupObsoleteDirectories(InstallRootLayout layout, InstallState state)
        {
            List<string> pendingCleanup = new List<string>();

            foreach (string directoryPath in layout.GetCleanupCandidateDirectoryPaths(state))
            {
                if (!TryDeleteDirectory(directoryPath, "Deleting obsolete version directory"))
                {
                    pendingCleanup.Add(Path.GetFileName(directoryPath));
                }
            }

            if (Directory.Exists(layout.StagingPath))
            {
                foreach (string directoryPath in Directory.GetDirectories(layout.StagingPath))
                {
                    if (!TryDeleteDirectory(directoryPath, "Deleting staged payload directory"))
                    {
                        pendingCleanup.Add(Path.Combine(InstallRootLayout.StagingDirectoryName, Path.GetFileName(directoryPath)));
                    }
                }
            }

            return pendingCleanup
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(item => item, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static void ValidatePayload(string stagingDirectoryPath)
        {
            foreach (string relativePath in RequiredPayloadPaths)
            {
                string fullPath = Path.Combine(stagingDirectoryPath, relativePath);
                if (!File.Exists(fullPath))
                {
                    throw new FileNotFoundException("Required installer payload file was not found.", fullPath);
                }
            }
        }

        private static bool TryDeleteDirectory(string directoryPath, string action)
        {
            try
            {
                if (Directory.Exists(directoryPath))
                {
                    InstallerLogger.Info(action + ": " + directoryPath);
                    Directory.Delete(directoryPath, true);
                }

                return true;
            }
            catch (Exception ex)
            {
                InstallerLogger.Warn(action + " failed for " + directoryPath + ": " + ex.Message);
                return false;
            }
        }
    }
}
