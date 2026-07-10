using System;
using System.IO;
using Installer;
using Xunit;

namespace Installer.Tests
{
    public sealed class InstallerConsentStoreTests
    {
        [Fact]
        public void SaveAndLoad_RoundTripsDisclosureChoices()
        {
            string tempDirectory = Path.Combine(Path.GetTempPath(), "installer-consent-" + Guid.NewGuid().ToString("N"));
            string consentPath = Path.Combine(tempDirectory, "installer-consent.json");

            try
            {
                InstallerConsent expected = new InstallerConsent
                {
                    AutomaticUpdateChecksEnabled = false,
                    AcceptedAtUtc = "2026-07-10T00:00:00Z"
                };

                InstallerConsentStore.Save(consentPath, expected);
                InstallerConsent actual = InstallerConsentStore.Load(consentPath);

                Assert.False(actual.AutomaticUpdateChecksEnabled);
                Assert.Equal(expected.AcceptedAtUtc, actual.AcceptedAtUtc);
            }
            finally
            {
                if (Directory.Exists(tempDirectory))
                {
                    Directory.Delete(tempDirectory, true);
                }
            }
        }
    }
}
