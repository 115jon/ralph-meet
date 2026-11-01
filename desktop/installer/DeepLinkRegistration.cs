using System;
using System.IO;
using Microsoft.Win32;

namespace Installer
{
    public static class DeepLinkRegistration
    {
        public const string SchemeName = "ralphmeet";

        private const string ProtocolRegistryPath = @"Software\Classes\" + SchemeName;
        private const string DefaultIconSubKeyPath = @"DefaultIcon";
        private const string ShellOpenCommandSubKeyPath = @"shell\open\command";
        private const string ProtocolDescription = "URL:RalphMeet Protocol";

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
                       BuildLaunchCommand(layout.UpdateExePath, LaunchCurrentVersion.ProcessStartArguments),
                       StringComparison.OrdinalIgnoreCase);
        }

        public static void Register(RegistryKey currentUserRoot, string launcherPath, string launcherArguments = "")
        {
            if (currentUserRoot == null)
            {
                throw new ArgumentNullException(nameof(currentUserRoot));
            }

            string normalizedLauncherPath = NormalizeLauncherPath(launcherPath);

            using (RegistryKey protocolKey = currentUserRoot.CreateSubKey(ProtocolRegistryPath))
            {
                if (protocolKey == null)
                {
                    throw new InvalidOperationException("Failed to create the deep-link protocol registry key.");
                }

                protocolKey.SetValue(string.Empty, ProtocolDescription, RegistryValueKind.String);
                protocolKey.SetValue("URL Protocol", string.Empty, RegistryValueKind.String);

                using (RegistryKey defaultIconKey = protocolKey.CreateSubKey(DefaultIconSubKeyPath))
                {
                    if (defaultIconKey == null)
                    {
                        throw new InvalidOperationException("Failed to create the deep-link icon registry key.");
                    }

                    defaultIconKey.SetValue(string.Empty, normalizedLauncherPath, RegistryValueKind.String);
                }

                using (RegistryKey commandKey = protocolKey.CreateSubKey(ShellOpenCommandSubKeyPath))
                {
                    if (commandKey == null)
                    {
                        throw new InvalidOperationException("Failed to create the deep-link launch command registry key.");
                    }

                    commandKey.SetValue(
                        string.Empty,
                        BuildLaunchCommand(normalizedLauncherPath, launcherArguments),
                        RegistryValueKind.String);
                }
            }
        }

        public static bool UnregisterIfOwned(RegistryKey currentUserRoot, InstallRootLayout layout)
        {
            if (currentUserRoot == null)
            {
                throw new ArgumentNullException(nameof(currentUserRoot));
            }

            using (RegistryKey protocolKey = currentUserRoot.OpenSubKey(ProtocolRegistryPath))
            {
                if (protocolKey == null)
                {
                    return false;
                }

                using (RegistryKey commandKey = protocolKey.OpenSubKey(ShellOpenCommandSubKeyPath))
                {
                    string existingCommand = commandKey?.GetValue(string.Empty) as string;
                    if (!IsOwnedByInstall(existingCommand, layout))
                    {
                        return false;
                    }
                }
            }

            currentUserRoot.DeleteSubKeyTree(ProtocolRegistryPath, false);
            return true;
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
