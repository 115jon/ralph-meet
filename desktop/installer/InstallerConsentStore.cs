using System;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;

namespace Installer
{
    [DataContract]
    public sealed class InstallerConsent
    {
        [DataMember]
        public bool AutomaticUpdateChecksEnabled { get; set; }

        [DataMember]
        public string AcceptedAtUtc { get; set; }
    }

    public static class InstallerConsentStore
    {
        private const string FileName = "installer-consent.json";

        public static string GetDefaultPath()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appData, "RalphMeet", FileName);
        }

        public static bool ExistsAtDefaultPath()
        {
            return File.Exists(GetDefaultPath());
        }

        public static InstallerConsent Load(string path)
        {
            using (FileStream stream = File.OpenRead(path))
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(InstallerConsent));
                return (InstallerConsent)serializer.ReadObject(stream);
            }
        }

        public static void Save(string path, InstallerConsent consent)
        {
            string directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            using (FileStream stream = File.Create(path))
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(InstallerConsent));
                serializer.WriteObject(stream, consent);
            }
        }

        public static void SaveDefault(InstallerConsent consent)
        {
            Save(GetDefaultPath(), consent);
        }
    }
}
