using System;
using System.IO;
using Microsoft.Win32;

namespace Installer
{
    /// <summary>
    /// Moves entry points written by older builds (Update.exe --processStart Yap.exe, or a
    /// versioned app-&lt;version&gt;\Yap.exe) onto the root stub: the HKCU Run value and taskbar
    /// pins. Shortcuts and the yap:// handler are rewritten on every install
    /// anyway. LegacyCleanup uses the same parsing to move Ralph Meet's entry points onto Yap.
    /// </summary>
    public static class LauncherMigration
    {
        public const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        public const string RunValueName = "Yap";

        /// <summary>Ralph Meet's Run value, carried over to <see cref="RunValueName"/> by LegacyCleanup.</summary>
        public const string LegacyRunValueName = "RalphMeet";

        private const string ProcessStartSwitch = "--processStart";

        /// <summary>
        /// True when <paramref name="command"/> starts this install through one of its launchers
        /// (the root stub, Update.exe, or a versioned app exe). <paramref name="callerArguments"/>
        /// is what remains after the executable and any --processStart &lt;name&gt; pair.
        /// </summary>
        public static bool TryParseOwnedCommand(string command, InstallRootLayout layout, out string callerArguments)
        {
            callerArguments = string.Empty;
            if (string.IsNullOrWhiteSpace(command) || layout == null)
            {
                return false;
            }

            SplitFirstToken(command.Trim(), out string executable, out string rest);
            if (!IsOwnedLauncherPath(executable, layout))
            {
                return false;
            }

            callerArguments = StripProcessStart(rest);
            return true;
        }

        public static string BuildStubCommand(InstallRootLayout layout, string callerArguments)
        {
            string command = "\"" + layout.RootStubPath + "\"";
            return string.IsNullOrWhiteSpace(callerArguments) ? command : command + " " + callerArguments.Trim();
        }

        /// <summary>
        /// Root\&lt;exe&gt;, root\Update.exe, or root\app-*\&lt;exe&gt; of this install, where &lt;exe&gt; is
        /// the layout's executable (Yap.exe, or RalphMeet.exe for the legacy root).
        /// </summary>
        public static bool IsOwnedLauncherPath(string path, InstallRootLayout layout)
        {
            if (string.IsNullOrWhiteSpace(path) || layout == null)
            {
                return false;
            }

            string fullPath;
            try
            {
                fullPath = Path.GetFullPath(Environment.ExpandEnvironmentVariables(path.Trim()));
            }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException)
            {
                return false;
            }

            string fileName = Path.GetFileName(fullPath);
            string directory = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrEmpty(directory))
            {
                return false;
            }

            if (PathsEqual(directory, layout.RootPath))
            {
                return string.Equals(fileName, InstallRootLayout.UpdateExeFileName, StringComparison.OrdinalIgnoreCase) ||
                       string.Equals(fileName, layout.ExecutableFileName, StringComparison.OrdinalIgnoreCase);
            }

            string parent = Path.GetDirectoryName(directory);
            return !string.IsNullOrEmpty(parent) &&
                   PathsEqual(parent, layout.RootPath) &&
                   Path.GetFileName(directory).StartsWith(InstallRootLayout.VersionDirectoryPrefix, StringComparison.OrdinalIgnoreCase) &&
                   string.Equals(fileName, layout.ExecutableFileName, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Removes a leading "--processStart &lt;name&gt;" pair, which only Update.exe understands.</summary>
        public static string StripProcessStart(string arguments)
        {
            string rest = (arguments ?? string.Empty).Trim();
            SplitFirstToken(rest, out string first, out string afterFirst);
            if (!string.Equals(first, ProcessStartSwitch, StringComparison.OrdinalIgnoreCase))
            {
                return rest;
            }

            SplitFirstToken(afterFirst, out _, out string afterName);
            return afterName;
        }

        /// <summary>Points an existing Run value of this install at the root stub. Leaves other values alone.</summary>
        public static bool MigrateRunValue(RegistryKey userRoot, InstallRootLayout layout)
        {
            using (RegistryKey runKey = userRoot.OpenSubKey(RunKeyPath, true))
            {
                string existing = runKey?.GetValue(RunValueName) as string;
                if (existing == null || !TryParseOwnedCommand(existing, layout, out string callerArguments))
                {
                    return false;
                }

                string migrated = BuildStubCommand(layout, callerArguments);
                if (string.Equals(existing, migrated, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }

                runKey.SetValue(RunValueName, migrated, RegistryValueKind.String);
                InstallerLogger.Info("Migrated the Run value from " + existing + " to " + migrated);
                return true;
            }
        }

        public static bool RemoveRunValueIfOwned(RegistryKey userRoot, InstallRootLayout layout, string valueName = RunValueName)
        {
            using (RegistryKey runKey = userRoot.OpenSubKey(RunKeyPath, true))
            {
                string existing = runKey?.GetValue(valueName) as string;
                if (existing == null || !TryParseOwnedCommand(existing, layout, out _))
                {
                    return false;
                }

                runKey.DeleteValue(valueName, false);
                return true;
            }
        }

        /// <summary>
        /// Rewrites taskbar pins that start this install through Update.exe or a versioned exe
        /// (a pin made from the running window points at app-&lt;version&gt;, which a later update
        /// deletes) so they start the root stub and carry the shared AppUserModelID.
        /// </summary>
        public static int RetargetPinnedShortcuts(string pinsDirectory, InstallRootLayout layout)
        {
            return RetargetPinnedShortcuts(pinsDirectory, layout, layout);
        }

        /// <summary>
        /// Rewrites pins that start <paramref name="sourceLayout"/> so they start the root stub of
        /// <paramref name="targetLayout"/>. With the legacy root as the source this moves Ralph Meet
        /// pins onto Yap.
        /// </summary>
        public static int RetargetPinnedShortcuts(string pinsDirectory, InstallRootLayout sourceLayout, InstallRootLayout targetLayout)
        {
            if (string.IsNullOrWhiteSpace(pinsDirectory) || !Directory.Exists(pinsDirectory))
            {
                return 0;
            }

            int retargeted = 0;
            foreach (string shortcutPath in Directory.GetFiles(pinsDirectory, "*.lnk"))
            {
                try
                {
                    ShellLinkData link = ShellLink.Load(shortcutPath);
                    if (!IsOwnedLauncherPath(link.TargetPath, sourceLayout))
                    {
                        continue;
                    }

                    string callerArguments = StripProcessStart(link.Arguments);
                    bool current = PathsEqual(link.TargetPath, targetLayout.RootStubPath) &&
                                   callerArguments == (link.Arguments ?? string.Empty).Trim() &&
                                   string.Equals(link.AppUserModelId, RootLauncher.AppUserModelId, StringComparison.Ordinal);
                    if (current)
                    {
                        continue;
                    }

                    ShellLink.Save(shortcutPath, new ShellLinkData
                    {
                        TargetPath = targetLayout.RootStubPath,
                        Arguments = callerArguments,
                        WorkingDirectory = targetLayout.RootPath,
                        IconPath = targetLayout.RootStubPath,
                        IconIndex = 0,
                        Description = string.IsNullOrWhiteSpace(link.Description) ? InstallerLogic.DisplayName : link.Description,
                        AppUserModelId = RootLauncher.AppUserModelId
                    });
                    InstallerLogger.Info("Retargeted taskbar pin " + shortcutPath + " from " + link.TargetPath + " to the root launcher.");
                    retargeted++;
                }
                catch (Exception ex)
                {
                    InstallerLogger.Warn("Could not inspect or retarget taskbar pin " + shortcutPath + ": " + ex.Message);
                }
            }

            return retargeted;
        }

        private static void SplitFirstToken(string text, out string token, out string rest)
        {
            text = (text ?? string.Empty).TrimStart();
            if (text.StartsWith("\"", StringComparison.Ordinal))
            {
                int end = text.IndexOf('"', 1);
                if (end < 0)
                {
                    token = text.Substring(1);
                    rest = string.Empty;
                    return;
                }

                token = text.Substring(1, end - 1);
                rest = text.Substring(end + 1).Trim();
                return;
            }

            int space = text.IndexOfAny(new[] { ' ', '\t' });
            token = space < 0 ? text : text.Substring(0, space);
            rest = space < 0 ? string.Empty : text.Substring(space + 1).Trim();
        }

        private static bool PathsEqual(string left, string right)
        {
            return string.Equals(
                Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase);
        }
    }
}
