#if DEBUG
using System;
using System.Collections.Generic;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace Installer.Ui
{
    /// <summary>
    /// Debug builds only: shows or captures each window state without installing anything,
    /// and without starting the installer logger.
    ///
    ///   RalphMeetSetup.exe --preview installing [--theme light]
    ///   RalphMeetSetup.exe --capture C:\out [--scale 1.5] [--theme dark|light|all]
    /// </summary>
    internal static class Preview
    {
        private const string SampleLog = @"C:\Users\you\AppData\Roaming\RalphMeet\logs\installer\installer-20261102-101500-pid4242.log";
        private const string SampleError = "Embedded payload.rmpk not found. Rebuild the installer after packaging the desktop payload.";

        private static readonly Dictionary<string, Func<MainWindow>> States = new Dictionary<string, Func<MainWindow>>(StringComparer.OrdinalIgnoreCase)
        {
            { "preparing", () => new MainWindow(Phase.Preparing, -1, false, null, null) },
            { "installing", () => new MainWindow(Phase.Unpacking, 40, false, null, null) },
            { "setting-up", () => new MainWindow(Phase.SettingUp, 100, false, null, null) },
            { "installed", () => new MainWindow(Phase.Installed, 100, false, null, null) },
            { "installed-nolaunch", () => new MainWindow(Phase.Installed, 100, true, null, null) },
            { "error", () => new MainWindow(Phase.InstallFailed, 40, false, SampleError, SampleLog) },
            { "uninstall", () => new MainWindow(Phase.ConfirmUninstall, -1, false, null, null) },
            { "uninstalling", () => new MainWindow(Phase.Uninstalling, -1, false, null, null) },
            { "uninstalled", () => new MainWindow(Phase.Uninstalled, -1, false, null, null) },
            { "uninstall-error", () => new MainWindow(Phase.UninstallFailed, -1, false, "Access to the path 'RalphMeet.exe' is denied.", SampleLog) },
        };

        public static bool TryStart(Application app, string[] args)
        {
            string state = Value(args, "--preview");
            string capture = Value(args, "--capture");
            if (state == null && capture == null)
            {
                return false;
            }

            string theme = Value(args, "--theme") ?? (capture != null ? "all" : null);

            if (capture != null)
            {
                double scale = double.TryParse(Value(args, "--scale"), System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out double s) ? s : 1;
                app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
                app.Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(() =>
                {
                    Capture(capture, scale, theme);
                    app.Shutdown();
                }));
                return true;
            }

            Theme.Apply(app.Resources, ParseTheme(theme) ?? Theme.FromSystem());
            if (!States.TryGetValue(state, out Func<MainWindow> create))
            {
                MessageBox.Show("Unknown state. Use one of: " + string.Join(", ", States.Keys));
                app.Shutdown(2);
                return true;
            }

            create().Show();
            return true;
        }

        private static void Capture(string directory, double scale, string theme)
        {
            Motion.Disable();
            Directory.CreateDirectory(directory);
            ThemeKind[] themes = theme == "all"
                ? new[] { ThemeKind.Dark, ThemeKind.Light }
                : new[] { ParseTheme(theme) ?? ThemeKind.Dark };
            string suffix = Math.Abs(scale - 1) < 0.01 ? string.Empty : "@" + scale.ToString(System.Globalization.CultureInfo.InvariantCulture) + "x";

            foreach (ThemeKind kind in themes)
            {
                Theme.Apply(Application.Current.Resources, kind);
                foreach (KeyValuePair<string, Func<MainWindow>> entry in States)
                {
                    MainWindow window = entry.Value();
                    window.WindowStartupLocation = WindowStartupLocation.Manual;
                    window.Left = -20000;
                    window.Top = -20000;
                    window.ShowActivated = false;
                    window.ShowInTaskbar = false;
                    window.Show();
                    window.Dispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle);

                    FrameworkElement root = (FrameworkElement)window.Content;
                    RenderTargetBitmap bitmap = new RenderTargetBitmap(
                        (int)Math.Ceiling(root.ActualWidth * scale),
                        (int)Math.Ceiling(root.ActualHeight * scale),
                        96 * scale, 96 * scale, PixelFormats.Pbgra32);
                    bitmap.Render(root);

                    PngBitmapEncoder encoder = new PngBitmapEncoder();
                    encoder.Frames.Add(BitmapFrame.Create(bitmap));
                    string file = Path.Combine(directory, kind.ToString().ToLowerInvariant() + "-" + entry.Key + suffix + ".png");
                    using (FileStream stream = File.Create(file))
                    {
                        encoder.Save(stream);
                    }

                    window.Close();
                }
            }
        }

        private static ThemeKind? ParseTheme(string theme)
        {
            switch ((theme ?? string.Empty).ToLowerInvariant())
            {
                case "dark":
                    return ThemeKind.Dark;
                case "light":
                    return ThemeKind.Light;
                case "contrast":
                    return ThemeKind.Contrast;
                default:
                    return null;
            }
        }

        private static string Value(string[] args, string name)
        {
            int index = Array.FindIndex(args, arg => arg.Equals(name, StringComparison.OrdinalIgnoreCase));
            return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
        }
    }
}
#endif
