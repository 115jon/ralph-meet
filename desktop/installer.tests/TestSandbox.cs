using System;
using System.IO;
using System.Runtime.CompilerServices;
using Installer;

namespace System.Runtime.CompilerServices
{
    // net48 lacks the attribute; the C# compiler only needs it to exist.
    [AttributeUsage(AttributeTargets.Method, Inherited = false)]
    internal sealed class ModuleInitializerAttribute : Attribute
    {
    }
}

namespace Installer.Tests
{
    /// <summary>
    /// Points InstallEnvironment.Current (and with it the installer log) at a temp sandbox before
    /// any test runs, so the suite never writes to the real %APPDATA%\Yap or HKCU.
    /// </summary>
    internal static class TestSandbox
    {
        [ModuleInitializer]
        internal static void Initialize()
        {
            string root = Path.Combine(Path.GetTempPath(), "installer-tests-sandbox-" + Guid.NewGuid().ToString("N"), "Yap");
            Environment.SetEnvironmentVariable(InstallEnvironment.SandboxRootVariable, root);
        }
    }
}
