using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Installer
{
    public sealed class InstallRootLayout
    {
        public const string DefaultInstallDirectoryName = "RalphMeet";
        public const string CurrentStateFileName = "current.json";
        public const string RootLauncherFileName = "Update.exe";
        public const string RootIconFileName = "app.ico";
        public const string StagingDirectoryName = "staging";
        public const string LogsDirectoryName = "logs";
        public const string InstallerLogsDirectoryName = "installer";
        public const string CefDirectoryName = "cef";
        public const string VersionDirectoryPrefix = "app-";

        private static readonly string[] PreservedRootFileNames =
        {
            CurrentStateFileName,
            RootLauncherFileName,
            RootIconFileName
        };

        private static readonly string[] PreservedRootDirectoryNames =
        {
            StagingDirectoryName,
            LogsDirectoryName,
            CefDirectoryName
        };

        public InstallRootLayout(string rootPath)
        {
            if (string.IsNullOrWhiteSpace(rootPath))
            {
                throw new ArgumentException("Install root path is required.", nameof(rootPath));
            }

            RootPath = Path.GetFullPath(rootPath);
        }

        public string RootPath { get; }

        public string UpdateExePath => Path.Combine(RootPath, RootLauncherFileName);

        public string CurrentStatePath => Path.Combine(RootPath, CurrentStateFileName);

        public string RootIconPath => Path.Combine(RootPath, RootIconFileName);

        public string StagingPath => Path.Combine(RootPath, StagingDirectoryName);

        public string LogsPath => Path.Combine(RootPath, LogsDirectoryName);

        public string InstallerLogsPath => Path.Combine(LogsPath, InstallerLogsDirectoryName);

        public IEnumerable<string> GetPreservedRootEntryNames()
        {
            return PreservedRootFileNames
                .Concat(PreservedRootDirectoryNames)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        public IEnumerable<string> GetPreservedRootDirectoryNames()
        {
            return PreservedRootDirectoryNames.ToArray();
        }

        public string GetVersionDirectoryName(string version)
        {
            string normalizedVersion = NormalizeVersion(version);
            if (string.IsNullOrWhiteSpace(normalizedVersion))
            {
                throw new ArgumentException("Version is required.", nameof(version));
            }

            return VersionDirectoryPrefix + normalizedVersion;
        }

        public string GetVersionDirectoryPath(string version)
        {
            return Path.Combine(RootPath, GetVersionDirectoryName(version));
        }

        public string CreateUniqueStagingDirectoryPath(string versionHint)
        {
            string safeHint = string.IsNullOrWhiteSpace(versionHint)
                ? "app"
                : GetVersionDirectoryName(versionHint);

            return Path.Combine(StagingPath, safeHint + "." + Guid.NewGuid().ToString("N") + ".tmp");
        }

        public IEnumerable<string> EnumerateVersionDirectoryPaths()
        {
            if (!Directory.Exists(RootPath))
            {
                return Enumerable.Empty<string>();
            }

            return Directory.GetDirectories(RootPath, VersionDirectoryPrefix + "*", SearchOption.TopDirectoryOnly)
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        public IEnumerable<string> EnumerateVersionDirectoryNames()
        {
            return EnumerateVersionDirectoryPaths()
                .Select(Path.GetFileName)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .ToArray();
        }

        public IEnumerable<string> GetCleanupCandidateDirectoryNames(InstallState state)
        {
            HashSet<string> protectedNames = new HashSet<string>(
                (state ?? new InstallState())
                    .GetProtectedVersions()
                    .Select(GetVersionDirectoryName),
                StringComparer.OrdinalIgnoreCase);

            return EnumerateVersionDirectoryNames()
                .Where(name => !protectedNames.Contains(name))
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        public IEnumerable<string> GetCleanupCandidateDirectoryPaths(InstallState state)
        {
            return GetCleanupCandidateDirectoryNames(state)
                .Select(name => Path.Combine(RootPath, name))
                .ToArray();
        }

        public IEnumerable<string> GetInstalledExecutablePaths(string executableName)
        {
            List<string> paths = new List<string>();

            if (!string.IsNullOrWhiteSpace(executableName))
            {
                paths.Add(Path.Combine(RootPath, executableName));

                foreach (string versionDirectoryPath in EnumerateVersionDirectoryPaths())
                {
                    paths.Add(Path.Combine(versionDirectoryPath, executableName));
                }
            }

            paths.Add(UpdateExePath);

            return paths
                .Select(Path.GetFullPath)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        public static InstallRootLayout FromLocalAppData(string localAppData)
        {
            if (string.IsNullOrWhiteSpace(localAppData))
            {
                throw new ArgumentException("LocalAppData root is required.", nameof(localAppData));
            }

            return new InstallRootLayout(Path.Combine(localAppData, DefaultInstallDirectoryName));
        }

        public static InstallRootLayout FromExecutablePath(string executablePath)
        {
            if (string.IsNullOrWhiteSpace(executablePath))
            {
                throw new ArgumentException("Executable path is required.", nameof(executablePath));
            }

            string directoryPath = Path.GetDirectoryName(Path.GetFullPath(executablePath));
            if (string.IsNullOrWhiteSpace(directoryPath))
            {
                throw new InvalidOperationException("Executable path does not have a parent directory.");
            }

            return new InstallRootLayout(directoryPath);
        }

        public static string NormalizeVersion(string version)
        {
            if (string.IsNullOrWhiteSpace(version))
            {
                return string.Empty;
            }

            string trimmedVersion = version.Trim();
            if (trimmedVersion.StartsWith(VersionDirectoryPrefix, StringComparison.OrdinalIgnoreCase))
            {
                trimmedVersion = trimmedVersion.Substring(VersionDirectoryPrefix.Length);
            }

            char[] invalidChars = Path.GetInvalidFileNameChars();
            foreach (char invalidChar in invalidChars)
            {
                trimmedVersion = trimmedVersion.Replace(invalidChar, '-');
            }

            return trimmedVersion.Trim();
        }
    }
}
