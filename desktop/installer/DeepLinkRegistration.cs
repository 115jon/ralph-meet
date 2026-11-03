using System;
using System.IO;
using Microsoft.Win32;

namespace Installer
{
    public static class DeepLinkRegistration
    {
        public const string SchemeName = "yap";

        /// <summary>
        /// Ralph Meet's scheme. Still registered, pointing at Yap, so links already shared open the app.
        /// </summary>
        public const string LegacySchemeName = "ralphmeet";

        /// <summary>Every scheme an install registers and an uninstall removes.</summary>
        public static readonly string[] SchemeNames = { SchemeName, LegacySchemeName };

        private const string ClassesRegistryPath = @"Software\Classes\";
        private const string DefaultIconSubKeyPath = @"DefaultIcon";
        private const string ShellOpenCommandSubKeyPath = @"shell\open\command";
        private const string ProtocolDescription = "URL:Yap Protocol";

        public static string GetProtocolRegistryPath(string scheme)
        {
            return ClassesRegistryPath + scheme;
        }

        /// <summary>The shell\open\command value registered for <paramref name="scheme"/>, or null.</summary>
        public static string ReadLaunchCommand(RegistryKey currentUserRoot, string scheme)
        {
            using (RegistryKey commandKey = currentUserRoot?.OpenSubKey(GetProtocolRegistryPath(scheme) + @"\" + ShellOpenCommandSubKeyPath))
            {
                return commandKey?.GetValue(string.Empty) as string;
            }
        }

        /// <summary>
        /// The shell\open\command value: the launcher, its own arguments if any, then the URL.
        /// </summary>
        public static string BuildLaunchCommand(string launcherPath, string launcherArguments = "")
        {
            string normalizedLauncherPath = NormalizeLauncherPath(launcherPath);
            string arguments = string.IsNullOrWhiteSpace(launcherArguments) ? string.Empty : launcherArguments.Trim() + " ";
            return "\"" + normalizedLauncherPath + "\" " + arguments + "\"%1\"";
        }

        /// <summary>
        /// True when the registered command is one this install wrote: the root stub, or the
        /// Update.exe --processStart form older builds registered.
        /// </summary>
        public static bool IsOwnedByInstall(string commandValue, InstallRootLayout layout)
        {
            if (string.IsNullOrWhiteSpace(commandValue) || layout == null)
            {
                return false;
            }

            string trimmed = commandValue.Trim();
            return string.Equals(trimmed, BuildLaunchCommand(layout.RootStubPath), StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(
                       trimmed,
                       BuildLaunchCommand(layout.UpdateExePath, LaunchCurrentVersion.ProcessStartSwitch + " " + layout.ExecutableFileName),
                       StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Points every scheme in <see cref="SchemeNames"/> at the launcher.</summary>
        public static void Register(RegistryKey currentUserRoot, string launcherPath, string launcherArguments = "")
        {
            if (currentUserRoot == null)
            {
                throw new ArgumentNullException(nameof(currentUserRoot));
            }

            string normalizedLauncherPath = NormalizeLauncherPath(launcherPath);
            foreach (string scheme in SchemeNames)
            {
                RegisterScheme(currentUserRoot, scheme, normalizedLauncherPath, launcherArguments);
            }
        }

        /// <summary>
        /// Removes each scheme whose command this install (<paramref name="layout"/>) wrote. Returns
        /// how many were removed. A scheme another app has taken over is left alone.
        /// </summary>
        public static int UnregisterIfOwned(RegistryKey currentUserRoot, InstallRootLayout layout)
        {
            if (currentUserRoot == null)
            {
                throw new ArgumentNullException(nameof(currentUserRoot));
            }

            int removed = 0;
            foreach (string scheme in SchemeNames)
            {
                if (!IsOwnedByInstall(ReadLaunchCommand(currentUserRoot, scheme), layout))
                {
                    continue;
                }

                currentUserRoot.DeleteSubKeyTree(GetProtocolRegistryPath(scheme), false);
                removed++;
            }

            return removed;
        }

        private static void RegisterScheme(RegistryKey currentUserRoot, string scheme, string launcherPath, string launcherArguments)
        {
            using (RegistryKey protocolKey = currentUserRoot.CreateSubKey(GetProtocolRegistryPath(scheme)))
            {
                if (protocolKey == null)
                {
                    throw new InvalidOperationException("Failed to create the " + scheme + ":// protocol registry key.");
                }

                protocolKey.SetValue(string.Empty, ProtocolDescription, RegistryValueKind.String);
                protocolKey.SetValue("URL Protocol", string.Empty, RegistryValueKind.String);

                using (RegistryKey defaultIconKey = protocolKey.CreateSubKey(DefaultIconSubKeyPath))
                {
                    if (defaultIconKey == null)
                    {
                        throw new InvalidOperationException("Failed to create the " + scheme + ":// icon registry key.");
                    }

                    defaultIconKey.SetValue(string.Empty, launcherPath, RegistryValueKind.String);
                }

                using (RegistryKey commandKey = protocolKey.CreateSubKey(ShellOpenCommandSubKeyPath))
                {
                    if (commandKey == null)
                    {
                        throw new InvalidOperationException("Failed to create the " + scheme + ":// launch command registry key.");
                    }

                    commandKey.SetValue(
                        string.Empty,
                        BuildLaunchCommand(launcherPath, launcherArguments),
                        RegistryValueKind.String);
                }
            }
        }

        private static string NormalizeLauncherPath(string launcherPath)
        {
            if (string.IsNullOrWhiteSpace(launcherPath))
            {
                throw new ArgumentException("Launcher path is required.", nameof(launcherPath));
            }

            return Path.GetFullPath(launcherPath);
        }
    }
}
