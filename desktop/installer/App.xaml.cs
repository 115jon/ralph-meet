using System;
using System.Linq;
using System.Windows;

namespace Installer
{
    public partial class App : Application
    {
        public static bool IsSilentLaunch { get; private set; }
        public static bool IsUninstallLaunch { get; private set; }

        protected override void OnStartup(StartupEventArgs e)
        {
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
                catch (Exception)
                {
                    Environment.Exit(1);
                }
                Environment.Exit(0);
            }

            if (isSilent)
            {
                try
                {
                    InstallerLogic.RunInstallationAsync().GetAwaiter().GetResult();
                }
                catch (Exception)
                {
                    Environment.Exit(1);
                }
                Environment.Exit(0);
            }

            base.OnStartup(e);
        }
    }
}
