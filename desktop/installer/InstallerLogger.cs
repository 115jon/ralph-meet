using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

namespace Installer
{
    internal static class InstallerLogger
    {
        private static readonly object Sync = new object();

        private static bool _initialized;
        private static string _logDirectoryPath = string.Empty;
        private static string _logFilePath = string.Empty;

        public static string LogDirectoryPath => _logDirectoryPath;
        public static string LogFilePath => _logFilePath;

        public static void Initialize(string[] args)
        {
            EnsureInitialized();

            Info("Installer logging initialized.");
            Info("Log file: " + _logFilePath);
            Info("Command line args: " + FormatArgs(args));
            Info("Process path: " + TryGetCurrentProcessPath());
            Info("OS version: " + Environment.OSVersion);
            Info(".NET runtime: " + Environment.Version);
        }

        public static void Info(string message)
        {
            Write("INFO", message, null);
        }

        public static void Warn(string message)
        {
            Write("WARN", message, null);
        }

        public static void Error(string message, Exception ex = null)
        {
            Write("ERROR", message, ex);
        }

        public static string AppendLogPath(string message)
        {
            EnsureInitialized();

            if (string.IsNullOrWhiteSpace(_logFilePath))
            {
                return message;
            }

            return message + Environment.NewLine + "Installer log: " + _logFilePath;
        }

        private static void EnsureInitialized()
        {
            if (_initialized)
            {
                return;
            }

            lock (Sync)
            {
                if (_initialized)
                {
                    return;
                }

                _logDirectoryPath = ResolveLogDirectoryPath();
                Directory.CreateDirectory(_logDirectoryPath);
                _logFilePath = Path.Combine(
                    _logDirectoryPath,
                    string.Format(
                        "installer-{0:yyyyMMdd-HHmmss}-pid{1}.log",
                        DateTime.Now,
                        Process.GetCurrentProcess().Id));
                _initialized = true;
            }
        }

        private static string ResolveLogDirectoryPath()
        {
            string roamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (!string.IsNullOrWhiteSpace(roamingAppData))
            {
                return Path.Combine(roamingAppData, "RalphMeet", "logs", "installer");
            }

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!string.IsNullOrWhiteSpace(localAppData))
            {
                return Path.Combine(localAppData, "RalphMeet", "logs", "installer");
            }

            return Path.Combine(Path.GetTempPath(), "RalphMeet", "logs", "installer");
        }

        private static string FormatArgs(string[] args)
        {
            if (args == null || args.Length == 0)
            {
                return "(none)";
            }

            return string.Join(" ", args.Select(QuoteIfNeeded));
        }

        private static string QuoteIfNeeded(string arg)
        {
            if (string.IsNullOrEmpty(arg))
            {
                return "\"\"";
            }

            return arg.IndexOf(' ') >= 0 ? "\"" + arg + "\"" : arg;
        }

        private static string TryGetCurrentProcessPath()
        {
            try
            {
                ProcessModule mainModule = Process.GetCurrentProcess().MainModule;
                if (mainModule != null && !string.IsNullOrWhiteSpace(mainModule.FileName))
                {
                    return mainModule.FileName;
                }
            }
            catch
            {
            }

            return AppDomain.CurrentDomain.BaseDirectory;
        }

        private static void Write(string level, string message, Exception ex)
        {
            EnsureInitialized();

            StringBuilder builder = new StringBuilder();
            builder.Append('[')
                .Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff"))
                .Append("] [")
                .Append(level)
                .Append("] ")
                .Append(message ?? string.Empty);

            if (ex != null)
            {
                builder.AppendLine();
                builder.Append(ex);
            }

            string line = builder.ToString();

            try
            {
                lock (Sync)
                {
                    if (!string.IsNullOrWhiteSpace(_logFilePath))
                    {
                        File.AppendAllText(_logFilePath, line + Environment.NewLine, Encoding.UTF8);
                    }
                }
            }
            catch
            {
            }

            try
            {
                Debug.WriteLine(line);
            }
            catch
            {
            }
        }
    }
}
