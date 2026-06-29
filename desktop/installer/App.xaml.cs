using System;
using System.Diagnostics;
using System.Linq;
using System.Windows;
using System.Windows.Threading;

namespace Installer
{
    public partial class App : Application
    {
        public static bool IsSilentLaunch { get; private set; }
        public static bool IsUninstallLaunch { get; private set; }

        protected override void OnStartup(StartupEventArgs e)
        {
            InstallerLogger.Initialize(e.Args);
            InstallerLogger.Info("App startup entered.");

            if (LaunchCurrentVersion.IsLaunchRequest(e.Args))
            {
                try
                {
                    LaunchRequest request = LaunchCurrentVersion.CreateLaunchRequest(GetCurrentProcessPath(), e.Args);
                    InstallerLogger.Info(
                        "Launching active version " + request.ActiveVersion +
                        " from " + request.ExecutablePath +
                        (string.IsNullOrWhiteSpace(request.Arguments) ? "." : " with args: " + request.Arguments));
                    LaunchCurrentVersion.Execute(request);
                    Environment.Exit(0);
                }
                catch (Exception ex)
                {
                    InstallerLogger.Error("Failed to launch the active installed version.", ex);
                    MessageBox.Show(
                        InstallerLogger.AppendLogPath(ex.Message),
                        "RalphMeet Launch Failed",
                        MessageBoxButton.OK,
                        MessageBoxImage.Error);
                    Environment.Exit(1);
                }
            }

            bool isSilent = e.Args.Any(arg => 
                arg.Equals("/S", StringComparison.OrdinalIgnoreCase) || 
                arg.Equals("/s", StringComparison.OrdinalIgnoreCase) || 
                arg.Equals("--silent", StringComparison.OrdinalIgnoreCase) || 
                arg.Equals("-silent", StringComparison.OrdinalIgnoreCase) || 
                arg.Equals("--passive", StringComparison.OrdinalIgnoreCase) || 
                arg.Equals("-passive", StringComparison.OrdinalIgnoreCase)
            );

            bool isUninstall = e.Args.Any(arg => 
                arg.Equals("--uninstall", StringComparison.OrdinalIgnoreCase) || 
                arg.Equals("-uninstall", StringComparison.OrdinalIgnoreCase) || 
                arg.Equals("/uninstall", StringComparison.OrdinalIgnoreCase)
            );

            IsSilentLaunch = isSilent;
            IsUninstallLaunch = isUninstall;

            DispatcherUnhandledException += (sender, args) =>
            {
                InstallerLogger.Error("Dispatcher unhandled exception.", args.Exception);
            };
            AppDomain.CurrentDomain.UnhandledException += (sender, args) =>
            {
                Exception ex = args.ExceptionObject as Exception;
                InstallerLogger.Error("AppDomain unhandled exception.", ex ?? new Exception("Non-Exception unhandled failure."));
            };

            if (isUninstall)
            {
                if (!isSilent)
                {
                    base.OnStartup(e);
                    return;
                }

                try
                {
                    InstallerLogic.RunUninstallationAsync().GetAwaiter().GetResult();
                }
                catch (Exception ex)
                {
                    InstallerLogger.Error("Silent uninstallation failed.", ex);
                    Environment.Exit(1);
                }
                InstallerLogger.Info("Silent uninstallation completed successfully.");
                Environment.Exit(0);
            }

            if (isSilent)
            {
                try
                {
                    InstallerLogic.RunInstallationAsync().GetAwaiter().GetResult();
                }
                catch (Exception ex)
                {
                    InstallerLogger.Error("Silent installation failed.", ex);
                    Environment.Exit(1);
                }
                InstallerLogger.Info("Silent installation completed successfully.");
                Environment.Exit(0);
            }

            base.OnStartup(e);
        }

        private static string GetCurrentProcessPath()
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
    }
}
