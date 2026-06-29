using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace Installer
{
    internal static class FileLockDiagnostics
    {
        private const int ErrorMoreData = 234;
        private const int RmRebootReasonNone = 0;
        private const int CchRmMaxAppName = 255;
        private const int CchRmMaxSvcName = 63;

        public static string DescribeLockingProcesses(params string[] resourcePaths)
        {
            string[] normalizedPaths = resourcePaths
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(Path.GetFullPath)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Where(File.Exists)
                .ToArray();

            if (normalizedPaths.Length == 0)
            {
                return "Lock scan skipped because no candidate files currently exist.";
            }

            uint sessionHandle;
            int startResult = RmStartSession(out sessionHandle, 0, Guid.NewGuid().ToString("N"));
            if (startResult != 0)
            {
                return "Restart Manager could not start a lock-inspection session. Error=" + startResult;
            }

            try
            {
                int registerResult = RmRegisterResources(
                    sessionHandle,
                    (uint)normalizedPaths.Length,
                    normalizedPaths,
                    0,
                    null,
                    0,
                    null);

                if (registerResult != 0)
                {
                    return "Restart Manager could not register lock-inspection resources. Error=" + registerResult;
                }

                uint processInfoNeeded = 0;
                uint processInfoCount = 0;
                int rebootReasons = RmRebootReasonNone;
                int listResult = RmGetList(
                    sessionHandle,
                    out processInfoNeeded,
                    ref processInfoCount,
                    null,
                    ref rebootReasons);

                if (listResult == 0 && processInfoCount == 0)
                {
                    return "Restart Manager found no active lock holders for: " + string.Join(", ", normalizedPaths);
                }

                if (listResult != ErrorMoreData)
                {
                    return "Restart Manager could not enumerate lock holders. Error=" + listResult;
                }

                RM_PROCESS_INFO[] processInfo = new RM_PROCESS_INFO[processInfoNeeded];
                processInfoCount = processInfoNeeded;
                listResult = RmGetList(
                    sessionHandle,
                    out processInfoNeeded,
                    ref processInfoCount,
                    processInfo,
                    ref rebootReasons);

                if (listResult != 0)
                {
                    return "Restart Manager could not complete lock-holder enumeration. Error=" + listResult;
                }

                return FormatLockReport(
                    normalizedPaths,
                    processInfo.Take((int)processInfoCount).ToArray(),
                    rebootReasons);
            }
            finally
            {
                RmEndSession(sessionHandle);
            }
        }

        private static string FormatLockReport(
            IEnumerable<string> normalizedPaths,
            IEnumerable<RM_PROCESS_INFO> processes,
            int rebootReasons)
        {
            StringBuilder builder = new StringBuilder();
            builder.AppendLine("Lock scan resources:");

            foreach (string path in normalizedPaths)
            {
                builder.AppendLine("  - " + path);
            }

            RM_PROCESS_INFO[] processArray = processes.ToArray();
            if (processArray.Length == 0)
            {
                builder.Append("Restart Manager found no active lock holders.");
                return builder.ToString().TrimEnd();
            }

            builder.AppendLine("Lock holders:");

            foreach (RM_PROCESS_INFO processInfo in processArray)
            {
                builder.AppendLine("  - " + DescribeProcess(processInfo));
            }

            builder.Append("Restart Manager reboot reasons: ").Append(rebootReasons);
            return builder.ToString().TrimEnd();
        }

        private static string DescribeProcess(RM_PROCESS_INFO processInfo)
        {
            int processId = processInfo.Process.dwProcessId;
            string name = processInfo.strAppName;
            string processPath = string.Empty;

            try
            {
                using (Process process = Process.GetProcessById(processId))
                {
                    if (string.IsNullOrWhiteSpace(name))
                    {
                        name = process.ProcessName;
                    }

                    try
                    {
                        ProcessModule mainModule = process.MainModule;
                        if (mainModule != null && !string.IsNullOrWhiteSpace(mainModule.FileName))
                        {
                            processPath = mainModule.FileName;
                        }
                    }
                    catch
                    {
                    }
                }
            }
            catch
            {
            }

            List<string> parts = new List<string>
            {
                "pid=" + processId,
                "name=" + (string.IsNullOrWhiteSpace(name) ? "(unknown)" : name),
                "type=" + processInfo.ApplicationType,
                "restartable=" + processInfo.bRestartable
            };

            if (!string.IsNullOrWhiteSpace(processInfo.strServiceShortName))
            {
                parts.Add("service=" + processInfo.strServiceShortName);
            }

            if (!string.IsNullOrWhiteSpace(processPath))
            {
                parts.Add("path=" + processPath);
            }

            return string.Join(", ", parts);
        }

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        private static extern int RmStartSession(out uint sessionHandle, int sessionFlags, string sessionKey);

        [DllImport("rstrtmgr.dll")]
        private static extern int RmEndSession(uint sessionHandle);

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        private static extern int RmRegisterResources(
            uint sessionHandle,
            uint fileCount,
            string[] fileNames,
            uint applicationCount,
            [In] RM_UNIQUE_PROCESS[] applications,
            uint serviceCount,
            string[] serviceNames);

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        private static extern int RmGetList(
            uint sessionHandle,
            out uint processInfoNeeded,
            ref uint processInfoCount,
            [In, Out] RM_PROCESS_INFO[] processInfo,
            ref int rebootReasons);

        [StructLayout(LayoutKind.Sequential)]
        private struct RM_UNIQUE_PROCESS
        {
            public int dwProcessId;
            public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
        }

        private enum RM_APP_TYPE
        {
            RmUnknownApp = 0,
            RmMainWindow = 1,
            RmOtherWindow = 2,
            RmService = 3,
            RmExplorer = 4,
            RmConsole = 5,
            RmCritical = 1000
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct RM_PROCESS_INFO
        {
            public RM_UNIQUE_PROCESS Process;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CchRmMaxAppName + 1)]
            public string strAppName;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CchRmMaxSvcName + 1)]
            public string strServiceShortName;

            public RM_APP_TYPE ApplicationType;
            public uint AppStatus;
            public uint TSSessionId;

            [MarshalAs(UnmanagedType.Bool)]
            public bool bRestartable;
        }
    }
}
