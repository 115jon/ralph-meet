using System;
using System.Linq;
using System.Windows;

namespace Installer
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            // Check for silent or passive flags
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

            if (isUninstall)
            {
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
