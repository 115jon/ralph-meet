using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;

namespace Installer
{
    public sealed class LaunchRequest
    {
        public LaunchRequest(string executablePath, string workingDirectory, string arguments, string activeVersion)
        {
            ExecutablePath = executablePath;
            WorkingDirectory = workingDirectory;
            Arguments = arguments ?? string.Empty;
            ActiveVersion = activeVersion;
        }

        public string ExecutablePath { get; }

        public string WorkingDirectory { get; }

        public string Arguments { get; }

        public string ActiveVersion { get; }
    }

    public static class LaunchCurrentVersion
    {
        private const string ProcessStartSwitch = "--processStart";
        private const string ProcessStartArgsSwitch = "--process-start-args";

        public static bool IsLaunchRequest(string[] args)
        {
            return TryParseCommand(args, out _);
        }

        public static LaunchRequest CreateLaunchRequest(string maintenanceExecutablePath, string[] args)
        {
            if (!TryParseCommand(args, out LaunchCommand command))
            {
                throw new InvalidOperationException("No process-start command was provided.");
            }

            InstallRootLayout layout = InstallRootLayout.FromExecutablePath(maintenanceExecutablePath);
            InstallState state = InstallState.LoadIfExists(layout.CurrentStatePath);
            if (state == null || string.IsNullOrWhiteSpace(state.CurrentVersion))
            {
                throw new InvalidOperationException("Installed app state was not found at " + layout.CurrentStatePath + ".");
            }

            string targetExecutablePath = Path.Combine(
                layout.GetVersionDirectoryPath(state.CurrentVersion),
                Path.GetFileName(command.ProcessName));

            if (!File.Exists(targetExecutablePath))
            {
                throw new FileNotFoundException("Active version executable was not found.", targetExecutablePath);
            }

            string workingDirectory = Path.GetDirectoryName(targetExecutablePath) ?? layout.RootPath;
            string launchArguments = BuildArguments(command.PassthroughArguments, command.RawProcessStartArguments);

            return new LaunchRequest(targetExecutablePath, workingDirectory, launchArguments, state.CurrentVersion);
        }

        public static void Execute(LaunchRequest request)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = request.ExecutablePath,
                Arguments = request.Arguments,
                UseShellExecute = true,
                WorkingDirectory = request.WorkingDirectory
            });
        }

        private static bool TryParseCommand(string[] args, out LaunchCommand command)
        {
            command = null;
            if (args == null || args.Length == 0)
            {
                return false;
            }

            List<string> passthroughArguments = new List<string>();
            string processName = null;
            string rawProcessStartArguments = null;

            for (int index = 0; index < args.Length; index++)
            {
                string arg = args[index];
                if (string.Equals(arg, ProcessStartSwitch, StringComparison.OrdinalIgnoreCase))
                {
                    if (index + 1 >= args.Length)
                    {
                        throw new InvalidOperationException("The --processStart switch requires an executable name.");
                    }

                    processName = args[++index];
                    continue;
                }

                if (string.Equals(arg, ProcessStartArgsSwitch, StringComparison.OrdinalIgnoreCase))
                {
                    if (index + 1 >= args.Length)
                    {
                        throw new InvalidOperationException("The --process-start-args switch requires an argument payload.");
                    }

                    rawProcessStartArguments = args[++index];
                    continue;
                }

                passthroughArguments.Add(arg);
            }

            if (string.IsNullOrWhiteSpace(processName))
            {
                return false;
            }

            command = new LaunchCommand(processName, passthroughArguments, rawProcessStartArguments);
            return true;
        }

        private static string BuildArguments(IEnumerable<string> passthroughArguments, string rawProcessStartArguments)
        {
            List<string> parts = new List<string>();

            if (passthroughArguments != null)
            {
                parts.AddRange(
                    passthroughArguments
                        .Where(arg => arg != null)
                        .Select(QuoteIfNeeded));
            }

            if (!string.IsNullOrWhiteSpace(rawProcessStartArguments))
            {
                parts.Add(rawProcessStartArguments);
            }

            return string.Join(" ", parts.Where(part => !string.IsNullOrWhiteSpace(part)));
        }

        private static string QuoteIfNeeded(string arg)
        {
            if (string.IsNullOrEmpty(arg))
            {
                return "\"\"";
            }

            if (arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
            {
                return arg;
            }

            return "\"" + arg.Replace("\"", "\\\"") + "\"";
        }

        private sealed class LaunchCommand
        {
            public LaunchCommand(string processName, IEnumerable<string> passthroughArguments, string rawProcessStartArguments)
            {
                ProcessName = processName;
                PassthroughArguments = passthroughArguments == null
                    ? Array.Empty<string>()
                    : passthroughArguments.ToArray();
                RawProcessStartArguments = rawProcessStartArguments;
            }

            public string ProcessName { get; }

            public IReadOnlyCollection<string> PassthroughArguments { get; }

            public string RawProcessStartArguments { get; }
        }
    }
}
