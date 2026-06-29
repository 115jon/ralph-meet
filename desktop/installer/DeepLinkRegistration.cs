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
        private const string LaunchArguments = "--processStart RalphMeet.exe";

        public static string BuildLaunchCommand(string launcherPath)
        {
            string normalizedLauncherPath = NormalizeLauncherPath(launcherPath);
            return "\"" + normalizedLauncherPath + "\" " + LaunchArguments + " \"%1\"";
        }

        public static bool IsOwnedByLauncherCommand(string commandValue, string launcherPath)
        {
            if (string.IsNullOrWhiteSpace(commandValue))
            {
                return false;
            }

            return string.Equals(
                commandValue.Trim(),
                BuildLaunchCommand(launcherPath),
                StringComparison.OrdinalIgnoreCase);
        }

        public static void Register(RegistryKey currentUserRoot, string launcherPath)
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

                    commandKey.SetValue(string.Empty, BuildLaunchCommand(normalizedLauncherPath), RegistryValueKind.String);
                }
            }
        }

        public static bool UnregisterIfOwned(RegistryKey currentUserRoot, string launcherPath)
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
                    if (!IsOwnedByLauncherCommand(existingCommand, launcherPath))
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
