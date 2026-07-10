using System;
using System.Linq;

namespace Installer
{
    public enum InstallLaunchMode
    {
        InteractiveInstall,
        SilentInstall,
    }

    public sealed class InstallLaunchPlan
    {
        public InstallLaunchMode Mode { get; private set; }
        public bool LaunchApplicationAfterInstall { get; private set; }

        private InstallLaunchPlan(InstallLaunchMode mode, bool launchApplicationAfterInstall)
        {
            Mode = mode;
            LaunchApplicationAfterInstall = launchApplicationAfterInstall;
        }

        public static InstallLaunchPlan Create(string[] args, bool hasPersistedConsent)
        {
            bool isSilent = args.Any(arg =>
                arg.Equals("/S", StringComparison.OrdinalIgnoreCase) ||
                arg.Equals("/s", StringComparison.OrdinalIgnoreCase) ||
                arg.Equals("--silent", StringComparison.OrdinalIgnoreCase) ||
                arg.Equals("-silent", StringComparison.OrdinalIgnoreCase));

            if (!isSilent)
            {
                return new InstallLaunchPlan(InstallLaunchMode.InteractiveInstall, true);
            }

            return hasPersistedConsent
                ? new InstallLaunchPlan(InstallLaunchMode.SilentInstall, false)
                : new InstallLaunchPlan(InstallLaunchMode.InteractiveInstall, true);
        }
    }
}
