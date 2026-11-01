using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace Installer
{
    /// <summary>A .lnk file's fields, including System.AppUserModel.ID.</summary>
    public sealed class ShellLinkData
    {
        public string TargetPath { get; set; }

        public string Arguments { get; set; }

        public string WorkingDirectory { get; set; }

        public string IconPath { get; set; }

        public int IconIndex { get; set; }

        public string Description { get; set; }

        public string AppUserModelId { get; set; }
    }

    /// <summary>
    /// Reads and writes shortcuts through IShellLinkW. WScript.Shell cannot set the
    /// AppUserModelID, which the taskbar needs to tie the running window to the shortcut.
    /// </summary>
    public static class ShellLink
    {
        private const ushort VT_LPWSTR = 31;
        private const int STGM_READ = 0;
        private const int MaxPath = 32768;

        // PKEY_AppUserModel_ID
        private static readonly PropertyKey AppUserModelIdKey =
            new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);

        public static void Save(string shortcutPath, ShellLinkData data)
        {
            if (data == null)
            {
                throw new ArgumentNullException(nameof(data));
            }

            string directory = Path.GetDirectoryName(Path.GetFullPath(shortcutPath));
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            IShellLinkW link = (IShellLinkW)new CShellLink();
            try
            {
                link.SetPath(data.TargetPath ?? string.Empty);
                link.SetArguments(data.Arguments ?? string.Empty);
                link.SetWorkingDirectory(data.WorkingDirectory ?? string.Empty);
                link.SetDescription(data.Description ?? string.Empty);
                if (!string.IsNullOrEmpty(data.IconPath))
                {
                    link.SetIconLocation(data.IconPath, data.IconIndex);
                }

                if (!string.IsNullOrEmpty(data.AppUserModelId))
                {
                    IPropertyStore store = (IPropertyStore)link;
                    PropertyKey key = AppUserModelIdKey;
                    PropVariant value = PropVariant.FromString(data.AppUserModelId);
                    try
                    {
                        store.SetValue(ref key, ref value);
                        store.Commit();
                    }
                    finally
                    {
                        PropVariantClear(ref value);
                    }
                }

                ((IPersistFile)link).Save(shortcutPath, true);
            }
            finally
            {
                Marshal.FinalReleaseComObject(link);
            }
        }

        public static ShellLinkData Load(string shortcutPath)
        {
            IShellLinkW link = (IShellLinkW)new CShellLink();
            try
            {
                ((IPersistFile)link).Load(shortcutPath, STGM_READ);

                StringBuilder buffer = new StringBuilder(MaxPath);
                ShellLinkData data = new ShellLinkData();

                link.GetPath(buffer, buffer.Capacity, IntPtr.Zero, 0);
                data.TargetPath = buffer.ToString();
                buffer.Clear();
                link.GetArguments(buffer, buffer.Capacity);
                data.Arguments = buffer.ToString();
                buffer.Clear();
                link.GetWorkingDirectory(buffer, buffer.Capacity);
                data.WorkingDirectory = buffer.ToString();
                buffer.Clear();
                link.GetDescription(buffer, buffer.Capacity);
                data.Description = buffer.ToString();
                buffer.Clear();
                link.GetIconLocation(buffer, buffer.Capacity, out int iconIndex);
                data.IconPath = buffer.ToString();
                data.IconIndex = iconIndex;

                IPropertyStore store = (IPropertyStore)link;
                PropertyKey key = AppUserModelIdKey;
                store.GetValue(ref key, out PropVariant value);
                try
                {
                    data.AppUserModelId = value.vt == VT_LPWSTR ? Marshal.PtrToStringUni(value.pointer) : null;
                }
                finally
                {
                    PropVariantClear(ref value);
                }

                return data;
            }
            finally
            {
                Marshal.FinalReleaseComObject(link);
            }
        }

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PropVariant pvar);

        [ComImport]
        [Guid("00021401-0000-0000-C000-000000000046")]
        private class CShellLink
        {
        }

        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("000214F9-0000-0000-C000-000000000046")]
        private interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
            void GetIDList(out IntPtr ppidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
            void GetHotkey(out short pwHotkey);
            void SetHotkey(short wHotkey);
            void GetShowCmd(out int piShowCmd);
            void SetShowCmd(int iShowCmd);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
            void Resolve(IntPtr hwnd, uint fFlags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
        }

        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        private interface IPropertyStore
        {
            void GetCount(out uint cProps);
            void GetAt(uint iProp, out PropertyKey pkey);
            void GetValue(ref PropertyKey key, out PropVariant pv);
            void SetValue(ref PropertyKey key, ref PropVariant pv);
            void Commit();
        }

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        private struct PropertyKey
        {
            public Guid fmtid;
            public uint pid;

            public PropertyKey(Guid fmtid, uint pid)
            {
                this.fmtid = fmtid;
                this.pid = pid;
            }
        }

        // PROPVARIANT: a 2-byte type tag, 6 reserved bytes, then a union two pointers wide.
        [StructLayout(LayoutKind.Sequential)]
        private struct PropVariant
        {
            public ushort vt;
            public ushort reserved1;
            public ushort reserved2;
            public ushort reserved3;
            public IntPtr pointer;
            public IntPtr pointer2;

            public static PropVariant FromString(string value)
            {
                return new PropVariant { vt = VT_LPWSTR, pointer = Marshal.StringToCoTaskMemUni(value) };
            }
        }
    }
}
