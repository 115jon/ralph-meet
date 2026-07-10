using Installer;
using Xunit;

namespace Installer.Tests
{
    public sealed class InstallLaunchPlanTests
    {
        [Fact]
        public void Create_UsesInteractiveDisclosureForFirstTimeSilentInstallWithoutConsent()
        {
            InstallLaunchPlan plan = InstallLaunchPlan.Create(new[] { "/S" }, false);

            Assert.Equal(InstallLaunchMode.InteractiveInstall, plan.Mode);
            Assert.True(plan.LaunchApplicationAfterInstall);
        }

        [Fact]
        public void Create_AllowsSilentUpdateWithPersistedConsentWithoutLaunchingApp()
        {
            InstallLaunchPlan plan = InstallLaunchPlan.Create(new[] { "--silent" }, true);

            Assert.Equal(InstallLaunchMode.SilentInstall, plan.Mode);
            Assert.False(plan.LaunchApplicationAfterInstall);
        }

        [Fact]
        public void Create_TreatsPassiveInstallAsInteractive()
        {
            InstallLaunchPlan plan = InstallLaunchPlan.Create(new[] { "--passive" }, false);

            Assert.Equal(InstallLaunchMode.InteractiveInstall, plan.Mode);
            Assert.True(plan.LaunchApplicationAfterInstall);
        }
    }
}
