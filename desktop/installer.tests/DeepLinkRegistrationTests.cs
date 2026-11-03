using Installer;
using Xunit;

namespace Installer.Tests
{
    public sealed class DeepLinkRegistrationTests
    {
        private static readonly InstallRootLayout Layout = new InstallRootLayout("C:\\Users\\jon\\AppData\\Local\\Yap");

        [Fact]
        public void BuildLaunchCommand_Points_Protocol_At_RootStub()
        {
            string command = DeepLinkRegistration.BuildLaunchCommand(Layout.RootStubPath);

            Assert.Equal("\"C:\\Users\\jon\\AppData\\Local\\Yap\\Yap.exe\" \"%1\"", command);
        }

        [Fact]
        public void BuildLaunchCommand_Keeps_UpdateExe_Fallback_Form()
        {
            string command = DeepLinkRegistration.BuildLaunchCommand(Layout.UpdateExePath, "--processStart Yap.exe");

            Assert.Equal(
                "\"C:\\Users\\jon\\AppData\\Local\\Yap\\Update.exe\" --processStart Yap.exe \"%1\"",
                command);
        }

        [Fact]
        public void IsOwnedByInstall_Matches_Stub_And_Legacy_Commands()
        {
            Assert.True(DeepLinkRegistration.IsOwnedByInstall(
                "\"C:\\USERS\\JON\\APPDATA\\LOCAL\\YAP\\YAP.EXE\" \"%1\"",
                Layout));
            Assert.True(DeepLinkRegistration.IsOwnedByInstall(
                "\"C:\\USERS\\JON\\APPDATA\\LOCAL\\YAP\\UPDATE.EXE\" --processStart Yap.exe \"%1\"",
                Layout));
        }

        [Fact]
        public void IsOwnedByInstall_Rejects_Different_Command()
        {
            Assert.False(DeepLinkRegistration.IsOwnedByInstall(
                "\"C:\\Users\\jon\\AppData\\Local\\Yap\\Update.exe\" --processStart OtherApp.exe \"%1\"",
                Layout));
            Assert.False(DeepLinkRegistration.IsOwnedByInstall(
                "\"C:\\Users\\jon\\AppData\\Local\\Other\\Yap.exe\" \"%1\"",
                Layout));
        }
    }
}
