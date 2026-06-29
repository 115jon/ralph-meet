using System.IO;
using Installer;
using Xunit;

namespace Installer.Tests
{
    public sealed class DeepLinkRegistrationTests
    {
        [Fact]
        public void BuildLaunchCommand_Points_Protocol_At_StableRootLauncher()
        {
            string launcherPath = Path.Combine(
                "C:\\Users\\jon\\AppData\\Local\\RalphMeet",
                "Update.exe");

            string command = DeepLinkRegistration.BuildLaunchCommand(launcherPath);

            Assert.Equal(
                "\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\Update.exe\" --processStart RalphMeet.exe \"%1\"",
                command);
        }

        [Fact]
        public void IsOwnedByLauncherCommand_Matches_Our_Installed_Command()
        {
            string launcherPath = Path.Combine(
                "C:\\Users\\jon\\AppData\\Local\\RalphMeet",
                "Update.exe");
            string command = "\"C:\\USERS\\JON\\APPDATA\\LOCAL\\RALPHMEET\\UPDATE.EXE\" --processStart RalphMeet.exe \"%1\"";

            Assert.True(DeepLinkRegistration.IsOwnedByLauncherCommand(command, launcherPath));
        }

        [Fact]
        public void IsOwnedByLauncherCommand_Rejects_Different_Command()
        {
            string launcherPath = Path.Combine(
                "C:\\Users\\jon\\AppData\\Local\\RalphMeet",
                "Update.exe");
            string command = "\"C:\\Users\\jon\\AppData\\Local\\RalphMeet\\Update.exe\" --processStart OtherApp.exe \"%1\"";

            Assert.False(DeepLinkRegistration.IsOwnedByLauncherCommand(command, launcherPath));
        }
    }
}
