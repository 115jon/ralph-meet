using System;
using System.Linq;
using Installer;
using Microsoft.Win32;
using Xunit;

namespace Installer.Tests
{
    public sealed class VulkanLayerRegistrationTests : IDisposable
    {
        private const string Root = "C:\\Users\\jon\\AppData\\Local\\Yap";
        private const string ImplicitLayers = @"Software\Khronos\Vulkan\ImplicitLayers";

        private static readonly InstallRootLayout Layout = new InstallRootLayout(Root);

        // A throwaway stand-in for HKCU, so the real Khronos key is never touched.
        private readonly string _registryPath = @"Software\115jon\YapTests\" + Guid.NewGuid().ToString("N");

        public void Dispose()
        {
            Registry.CurrentUser.DeleteSubKeyTree(_registryPath, false);
        }

        [Theory]
        [InlineData(Root + "\\capture-hook\\obs-33.0.1-c37f4412\\obs-vulkan64.json")]
        [InlineData(Root + "\\capture-hook\\obs-33.0.1-c37f4412\\obs-vulkan32.json")]
        [InlineData(Root + "\\capture-hook\\obs-32.1.2-12345678\\OBS-VULKAN64.JSON")]
        [InlineData("c:\\users\\jon\\appdata\\local\\yap\\capture-hook\\obs-33.0.1-c37f4412\\obs-vulkan64.json")]
        [InlineData(Root + "\\app-3.7.0\\obs-capture\\obs-vulkan64.json")]
        [InlineData(Root + "\\app-3.3.0\\obs-capture\\obs-vulkan32.json")]
        [InlineData(Root + "\\obs-capture\\obs-vulkan64.json")]
        public void IsOwnedManifest_Matches_Staged_And_Legacy_Layers(string path)
        {
            Assert.True(VulkanLayerRegistration.IsOwnedManifest(path, Layout), path);
        }

        [Theory]
        [InlineData("C:\\ProgramData\\obs-studio-hook\\obs-vulkan64.json")]
        [InlineData("C:\\Program Files (x86)\\Steam\\SteamOverlayVulkanLayer64.json")]
        [InlineData("C:\\Users\\jon\\AppData\\Local\\Other\\capture-hook\\obs-33.0.1-c37f4412\\obs-vulkan64.json")]
        [InlineData("C:\\Users\\jon\\AppData\\Local\\YapEvil\\capture-hook\\obs-33.0.1-c37f4412\\obs-vulkan64.json")]
        [InlineData(Root + "\\capture-hook\\obs-vulkan64.json")]
        [InlineData(Root + "\\capture-hook\\elsewhere\\obs-vulkan64.json")]
        [InlineData(Root + "\\capture-hook\\obs-33.0.1-c37f4412\\other-layer.json")]
        [InlineData(Root + "\\capture-hook\\obs-33.0.1-c37f4412\\nested\\obs-vulkan64.json")]
        [InlineData(Root + "\\app-3.7.0\\other\\obs-vulkan64.json")]
        [InlineData(Root + "\\elsewhere\\obs-capture\\obs-vulkan64.json")]
        [InlineData(Root + "\\..\\Other\\capture-hook\\obs-33.0.1-c37f4412\\obs-vulkan64.json")]
        [InlineData("")]
        [InlineData("   ")]
        public void IsOwnedManifest_Rejects_Everyone_Elses_Layers(string path)
        {
            Assert.False(VulkanLayerRegistration.IsOwnedManifest(path, Layout), path);
        }

        [Fact]
        public void RemoveOwned_Deletes_Only_This_Installs_Values()
        {
            string ours64 = Root + "\\capture-hook\\obs-33.0.1-c37f4412\\obs-vulkan64.json";
            string ours32 = Root + "\\capture-hook\\obs-33.0.1-c37f4412\\obs-vulkan32.json";
            string stale = Root + "\\capture-hook\\obs-32.1.2-12345678\\obs-vulkan64.json";
            string legacy = Root + "\\app-3.7.0\\obs-capture\\obs-vulkan64.json";
            string obs = "C:\\ProgramData\\obs-studio-hook\\obs-vulkan64.json";
            string steam = "C:\\Program Files (x86)\\Steam\\SteamOverlayVulkanLayer64.json";

            using (RegistryKey userRoot = Registry.CurrentUser.CreateSubKey(_registryPath))
            {
                using (RegistryKey layers = userRoot.CreateSubKey(ImplicitLayers))
                {
                    foreach (string name in new[] { ours64, ours32, stale, legacy, obs, steam })
                    {
                        layers.SetValue(name, 0, RegistryValueKind.DWord);
                    }
                }

                int removed = VulkanLayerRegistration.RemoveOwned(userRoot, Layout);

                Assert.Equal(4, removed);
                using (RegistryKey layers = userRoot.OpenSubKey(ImplicitLayers))
                {
                    Assert.Equal(
                        new[] { obs, steam }.OrderBy(v => v, StringComparer.OrdinalIgnoreCase),
                        layers.GetValueNames().OrderBy(v => v, StringComparer.OrdinalIgnoreCase));
                }
            }
        }

        [Fact]
        public void RemoveOwned_Without_The_Khronos_Key_Removes_Nothing()
        {
            using (RegistryKey userRoot = Registry.CurrentUser.CreateSubKey(_registryPath))
            {
                Assert.Equal(0, VulkanLayerRegistration.RemoveOwned(userRoot, Layout));
            }
        }
    }
}
