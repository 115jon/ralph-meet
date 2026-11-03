using System;
using System.IO;
using Microsoft.Win32;

namespace Installer
{
    /// <summary>
    /// The app keeps an OBS-signed Vulkan implicit layer registered while "Game capture hook" is on
    /// (desktop/src-tauri/src/game_capture/vulkan_layer.rs). The registration is a value under
    /// HKCU\Software\Khronos\Vulkan\ImplicitLayers whose name is the layer manifest path, so it
    /// outlives the app: uninstalling must remove it, or the Vulkan loader keeps trying to load a
    /// DLL that is gone. Values written by anything else (OBS, Steam, drivers) are never touched.
    /// </summary>
    public static class VulkanLayerRegistration
    {
        private const string ImplicitLayersPath = @"Software\Khronos\Vulkan\ImplicitLayers";

        /// <summary>The folder, under the install root, the app stages the signed hook in.</summary>
        private const string StagedHookDirectoryName = "capture-hook";

        /// <summary>The folder the old unsigned layer's manifests shipped in.</summary>
        private const string LegacyArtifactDirectoryName = "obs-capture";

        private static readonly string[] ManifestFileNames = { "obs-vulkan64.json", "obs-vulkan32.json" };

        /// <summary>
        /// True when a registered manifest path is one this install wrote: an obs-vulkan{64,32}.json
        /// in a staged hook folder (&lt;install root&gt;\capture-hook\obs-&lt;ver&gt;-&lt;sha8&gt;\), or in an
        /// obs-capture folder of the root or of an app-&lt;ver&gt; folder (the old unsigned layer).
        /// </summary>
        public static bool IsOwnedManifest(string manifestPath, InstallRootLayout layout)
        {
            if (string.IsNullOrWhiteSpace(manifestPath) || layout == null)
            {
                return false;
            }

            string fullPath;
            try
            {
                fullPath = Path.GetFullPath(manifestPath.Trim());
            }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException)
            {
                return false;
            }

            string rootPrefix = layout.RootPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
                                Path.DirectorySeparatorChar;
            if (!fullPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            string[] parts = fullPath.Substring(rootPrefix.Length).Split(Path.DirectorySeparatorChar);
            if (!IsManifestFileName(parts[parts.Length - 1]))
            {
                return false;
            }

            if (parts.Length == 2)
            {
                // obs-capture\obs-vulkan64.json
                return SameName(parts[0], LegacyArtifactDirectoryName);
            }

            if (parts.Length != 3)
            {
                return false;
            }

            // capture-hook\obs-<ver>-<sha8>\obs-vulkan64.json
            if (SameName(parts[0], StagedHookDirectoryName))
            {
                return parts[1].StartsWith("obs-", StringComparison.OrdinalIgnoreCase);
            }

            // app-<ver>\obs-capture\obs-vulkan64.json
            return parts[0].StartsWith(InstallRootLayout.VersionDirectoryPrefix, StringComparison.OrdinalIgnoreCase) &&
                   SameName(parts[1], LegacyArtifactDirectoryName);
        }

        /// <summary>
        /// Deletes this install's registrations under <paramref name="currentUserRoot"/>
        /// (HKCU, or the sandbox key). Returns how many values were removed.
        /// </summary>
        public static int RemoveOwned(RegistryKey currentUserRoot, InstallRootLayout layout)
        {
            if (currentUserRoot == null)
            {
                throw new ArgumentNullException(nameof(currentUserRoot));
            }

            int removed = 0;
            using (RegistryKey key = currentUserRoot.OpenSubKey(ImplicitLayersPath, true))
            {
                if (key == null)
                {
                    return 0;
                }

                foreach (string name in key.GetValueNames())
                {
                    if (!IsOwnedManifest(name, layout))
                    {
                        continue;
                    }

                    key.DeleteValue(name, false);
                    removed++;
                }
            }

            return removed;
        }

        private static bool IsManifestFileName(string fileName)
        {
            foreach (string manifest in ManifestFileNames)
            {
                if (string.Equals(fileName, manifest, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool SameName(string a, string b)
        {
            return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        }
    }
}
