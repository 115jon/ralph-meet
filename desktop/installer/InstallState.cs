using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

namespace Installer
{
    [DataContract]
    public sealed class InstallState
    {
        private static readonly DataContractJsonSerializer Serializer = new DataContractJsonSerializer(typeof(InstallState));

        [DataMember(Name = "currentVersion", EmitDefaultValue = false)]
        public string CurrentVersion { get; set; }

        [DataMember(Name = "previousVersion", EmitDefaultValue = false)]
        public string PreviousVersion { get; set; }

        [DataMember(Name = "activatedAtUtc", EmitDefaultValue = false)]
        public string ActivatedAtUtc { get; set; }

        [DataMember(Name = "pendingCleanup", EmitDefaultValue = false)]
        public List<string> PendingCleanup { get; set; }

        [DataMember(Name = "lastLaunchSucceeded", EmitDefaultValue = false)]
        public bool? LastLaunchSucceeded { get; set; }

        public IEnumerable<string> GetProtectedVersions()
        {
            return new[] { CurrentVersion, PreviousVersion }
                .Where(version => !string.IsNullOrWhiteSpace(version))
                .Select(version => version.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase);
        }

        public void MarkActivatedNowUtc()
        {
            ActivatedAtUtc = DateTime.UtcNow.ToString("o");
        }

        public string ToJson()
        {
            using (MemoryStream stream = new MemoryStream())
            {
                Serializer.WriteObject(stream, CreateSerializableClone());
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        public void Save(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("Install state path is required.", nameof(path));
            }

            string fullPath = Path.GetFullPath(path);
            string directoryPath = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrWhiteSpace(directoryPath))
            {
                throw new InvalidOperationException("Install state path does not have a parent directory.");
            }

            Directory.CreateDirectory(directoryPath);

            string tempPath = fullPath + ".tmp";
            using (FileStream stream = File.Create(tempPath))
            {
                Serializer.WriteObject(stream, CreateSerializableClone());
            }

            ReplaceOrMove(tempPath, fullPath);
        }

        public static InstallState FromJson(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                return new InstallState();
            }

            byte[] bytes = Encoding.UTF8.GetBytes(json);
            using (MemoryStream stream = new MemoryStream(bytes))
            {
                InstallState state = Serializer.ReadObject(stream) as InstallState;
                return state ?? new InstallState();
            }
        }

        public static InstallState Load(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("Install state path is required.", nameof(path));
            }

            string fullPath = Path.GetFullPath(path);
            if (!File.Exists(fullPath))
            {
                throw new FileNotFoundException("Install state was not found.", fullPath);
            }

            using (FileStream stream = File.OpenRead(fullPath))
            {
                InstallState state = Serializer.ReadObject(stream) as InstallState;
                if (state == null)
                {
                    throw new InvalidDataException("Install state file was empty or invalid: " + fullPath);
                }

                return state;
            }
        }

        public static InstallState LoadIfExists(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return null;
            }

            string fullPath = Path.GetFullPath(path);
            return File.Exists(fullPath) ? Load(fullPath) : null;
        }

        private InstallState CreateSerializableClone()
        {
            return new InstallState
            {
                CurrentVersion = NormalizeValue(CurrentVersion),
                PreviousVersion = NormalizeValue(PreviousVersion),
                ActivatedAtUtc = NormalizeValue(ActivatedAtUtc),
                PendingCleanup = NormalizePendingCleanup(PendingCleanup),
                LastLaunchSucceeded = LastLaunchSucceeded
            };
        }

        private static List<string> NormalizePendingCleanup(IEnumerable<string> pendingCleanup)
        {
            List<string> normalized = pendingCleanup == null
                ? new List<string>()
                : pendingCleanup
                    .Where(item => !string.IsNullOrWhiteSpace(item))
                    .Select(item => item.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(item => item, StringComparer.OrdinalIgnoreCase)
                    .ToList();

            return normalized.Count == 0 ? null : normalized;
        }

        private static string NormalizeValue(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        private static void ReplaceOrMove(string sourcePath, string destinationPath)
        {
            if (File.Exists(destinationPath))
            {
                string backupPath = destinationPath + ".bak";
                DeleteFileIfExists(backupPath);
                File.Replace(sourcePath, destinationPath, backupPath, true);
                DeleteFileIfExists(backupPath);
                return;
            }

            if (File.Exists(sourcePath))
            {
                File.Move(sourcePath, destinationPath);
            }
        }

        private static void DeleteFileIfExists(string path)
        {
            if (!File.Exists(path))
            {
                return;
            }

            File.Delete(path);
        }
    }
}
