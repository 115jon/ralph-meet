using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Installer.Ui;
using Microsoft.Win32;

namespace Installer
{
    /// <summary>What the window is showing. The install logic never sees this.</summary>
    internal enum Phase
    {
        Preparing,
        Unpacking,
        SettingUp,
        Installed,
        InstallFailed,
        ConfirmUninstall,
        Uninstalling,
        Uninstalled,
        UninstallFailed,
    }

    public partial class MainWindow : Window
    {
        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TOOLWINDOW = 0x00000080;
        private const int WS_EX_APPWINDOW = 0x00040000;

        [DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOACTIVATE = 0x0010;

        private readonly bool _preview;
        private Phase _phase = Phase.Preparing;
        private bool _hasPhase;
        private bool _noLaunch;
        private string _error = string.Empty;
        private string _logPath = string.Empty;

        // Latest payload progress from the extracting thread, coalesced into one UI update.
        private long _payloadDone;
        private long _payloadTotal = -1;
        private int _progressQueued;
        private bool _extractionFinished;

        private ScaleTransform _meterFill;
        private TranslateTransform _meterSegmentShift;
        private FrameworkElement _meterSegment;
        private DispatcherTimer _copiedTimer;

        public MainWindow()
        {
            Theme.EnsureApplied();
            InitializeComponent();
            Loaded += MainWindow_Loaded;
            Closed += (sender, args) => SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
        }

        /// <summary>Shows one state without running anything (Debug builds' --preview and --capture).</summary>
        internal MainWindow(Phase phase, double percent, bool noLaunch, string error, string logPath) : this()
        {
            _preview = true;
            _noLaunch = noLaunch;
            _error = error ?? string.Empty;
            _logPath = logPath ?? string.Empty;
            if (percent >= 0)
            {
                _payloadTotal = 407L * 1024 * 1024;
                _payloadDone = (long)(_payloadTotal * percent / 100);
            }

            _phase = phase;
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);

            try
            {
                IntPtr hWnd = new WindowInteropHelper(this).Handle;

                // Fix Alt-Tab issue: clear WS_EX_TOOLWINDOW and set WS_EX_APPWINDOW
                int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
                exStyle = (exStyle & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW;
                SetWindowLong(hWnd, GWL_EXSTYLE, exStyle);

                // Fix Topmost issue: explicitly force the window to HWND_NOTOPMOST
                SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
            catch (Exception ex)
            {
                Console.WriteLine("Failed to apply Win32 window style fixes: " + ex.Message);
            }
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            Meter.ApplyTemplate();
            // Template transforms are frozen; give the fill and the segment live ones to animate.
            ((Border)Meter.Template.FindName("Fill", Meter)).RenderTransform = _meterFill = new ScaleTransform(0, 1);
            _meterSegment = (FrameworkElement)Meter.Template.FindName("Segment", Meter);
            _meterSegment.RenderTransform = _meterSegmentShift = new TranslateTransform(-_meterSegment.Width, 0);

            if (_preview)
            {
                _extractionFinished = _phase != Phase.Preparing && _phase != Phase.Unpacking;
                Present(_phase, animate: false);
                return;
            }

            SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;

            if (App.IsUninstallLaunch)
            {
                Present(Phase.ConfirmUninstall);
                return;
            }

            _noLaunch = App.IsNoLaunch;
            await InstallAsync();
        }

        private async Task InstallAsync()
        {
            Title = "Ralph Meet Setup";
            _payloadDone = 0;
            _payloadTotal = -1;
            _extractionFinished = false;
            Present(Phase.Preparing);

            InstallProgress.PayloadProgress += OnPayloadProgress;
            try
            {
                await InstallerLogic.RunInstallationAsync(!App.IsNoLaunch);
                InstallProgress.PayloadProgress -= OnPayloadProgress;
                FlushProgress();
                Present(Phase.Installed);
                if (!App.IsNoLaunch)
                {
                    await Task.Delay(1000);
                }

                Application.Current.Shutdown();
            }
            catch (Exception ex)
            {
                InstallProgress.PayloadProgress -= OnPayloadProgress;
                InstallerLogger.Error("Interactive installation failed.", ex);
                _error = Describe(ex);
                _logPath = InstallerLogger.LogFilePath;
                Present(Phase.InstallFailed);
            }
        }

        private async Task UninstallAsync()
        {
            Present(Phase.Uninstalling);
            try
            {
                await InstallerLogic.RunUninstallationAsync();
                Present(Phase.Uninstalled);
                await Task.Delay(1200);
                Application.Current.Shutdown();
            }
            catch (Exception ex)
            {
                InstallerLogger.Error("Interactive uninstallation failed.", ex);
                _error = Describe(ex);
                _logPath = InstallerLogger.LogFilePath;
                Present(Phase.UninstallFailed);
            }
        }

        // Raised on the extracting thread, once per write: keep the latest and post one update.
        private void OnPayloadProgress(long done, long total)
        {
            Interlocked.Exchange(ref _payloadTotal, total);
            Interlocked.Exchange(ref _payloadDone, done);
            if (Interlocked.Exchange(ref _progressQueued, 1) == 0)
            {
                Dispatcher.BeginInvoke(DispatcherPriority.Normal, new Action(FlushProgress));
            }
        }

        private void FlushProgress()
        {
            Interlocked.Exchange(ref _progressQueued, 0);
            long total = Interlocked.Read(ref _payloadTotal);
            long done = Interlocked.Read(ref _payloadDone);
            if (total < 0 || _phase > Phase.SettingUp)
            {
                return;
            }

            if (done >= total)
            {
                _extractionFinished = true;
                if (_phase != Phase.SettingUp)
                {
                    Present(Phase.SettingUp);
                }

                return;
            }

            if (_phase == Phase.Preparing)
            {
                Present(Phase.Unpacking);
            }
            else
            {
                UpdateMeter(animate: true);
            }
        }

        private void Present(Phase phase, bool animate = true)
        {
            bool changedScreen = !_hasPhase || ScreenOf(phase) != ScreenOf(_phase);
            _phase = phase;
            _hasPhase = true;

            bool install = phase <= Phase.InstallFailed;
            bool failed = phase == Phase.InstallFailed || phase == Phase.UninstallFailed;
            bool busy = phase == Phase.Preparing || phase == Phase.Unpacking || phase == Phase.SettingUp || phase == Phase.Uninstalling;

            Title = install ? "Ralph Meet Setup" : "Ralph Meet Uninstall";
            WindowLabel.Text = install ? "RALPH MEET SETUP" : "RALPH MEET UNINSTALL";
            AutomationProperties.SetName(WindowLabel, Title);
            AutomationProperties.SetName(this, Title);

            // The mark is half-resolved while anything is pending, whole once nothing is. After a
            // failure it steps down to 2px cells to leave room for the message and the log.
            Mark.Pending = busy;
            Mark.Width = Mark.Height = failed ? 64 : 96;
            StatusScroll.MaxHeight = failed ? 66 : 88;

            // Only a state that needs the person shows the close key; Alt+F4 is unchanged.
            CloseKey.Visibility = busy || phase == Phase.Installed || phase == Phase.Uninstalled ? Visibility.Collapsed : Visibility.Visible;

            switch (phase)
            {
                case Phase.Preparing:
                case Phase.Unpacking:
                case Phase.SettingUp:
                    SetKicker("SETUP" + VersionSuffix(), null);
                    SetText("Installing Ralph Meet",
                        phase == Phase.Preparing ? "Getting ready…" :
                        phase == Phase.Unpacking ? "Unpacking files…" : "Adding shortcuts and links…");
                    break;
                case Phase.Installed:
                    SetKicker("INSTALLED", "Talk");
                    SetText("Ralph Meet is installed",
                        _noLaunch ? "Open it from the Start menu or your desktop." : "Starting Ralph Meet…");
                    break;
                case Phase.InstallFailed:
                    SetKicker("INSTALL FAILED", "Danger");
                    SetText("Setup didn’t finish", ErrorText());
                    break;
                case Phase.ConfirmUninstall:
                    SetKicker("UNINSTALL", null);
                    SetText("Uninstall Ralph Meet?",
                        "This will remove the desktop app and shortcuts from this PC. Your Ralph Meet data in AppData\\Roaming\\RalphMeet will be kept.");
                    break;
                case Phase.Uninstalling:
                    SetKicker("UNINSTALL", null);
                    SetText("Removing Ralph Meet", "Removing Ralph Meet from this PC.");
                    break;
                case Phase.Uninstalled:
                    SetKicker("REMOVED", "Talk");
                    SetText("Ralph Meet was removed",
                        "Your Ralph Meet data was left intact, and you can reinstall any time with the latest setup.");
                    break;
                case Phase.UninstallFailed:
                    SetKicker("UNINSTALL FAILED", "Danger");
                    SetText("Uninstall didn’t finish", ErrorText());
                    break;
            }

            // Middle: progress while installing or removing, the log plate after a failure.
            ProgressPanel.Visibility = failed || phase == Phase.ConfirmUninstall || phase == Phase.Uninstalled
                ? Visibility.Collapsed
                : Visibility.Visible;
            Steps.Visibility = install && !failed ? Visibility.Visible : Visibility.Collapsed;
            LogPanel.Visibility = failed ? Visibility.Visible : Visibility.Collapsed;
            LogPathText.Text = string.IsNullOrWhiteSpace(_logPath) ? "No log was written." : _logPath;
            CopyKey.IsEnabled = OpenLogKey.IsEnabled = !string.IsNullOrWhiteSpace(_logPath);
            ResetCopied();

            UpdateSteps();
            UpdateMeter(animate && !changedScreen);

            // Footer keys.
            bool confirm = phase == Phase.ConfirmUninstall;
            Footer.Visibility = failed || confirm ? Visibility.Visible : Visibility.Collapsed;
            SecondaryKey.Content = confirm ? "Cancel" : "Close";
            SecondaryKey.IsCancel = failed || confirm;
            PrimaryKey.Visibility = failed ? Visibility.Visible : Visibility.Collapsed;
            PrimaryKey.IsDefault = failed;
            DangerKey.Visibility = confirm ? Visibility.Visible : Visibility.Collapsed;
            DangerKey.IsDefault = confirm;
            PrimaryKey.IsEnabled = DangerKey.IsEnabled = SecondaryKey.IsEnabled = true;

            if (changedScreen && animate)
            {
                Motion.Enter(Screen, ScreenSettle);
            }

            // Focus: Cancel first on a destructive question, Try again after a failure.
            if (IsLoaded)
            {
                if (confirm)
                {
                    SecondaryKey.Focus();
                }
                else if (failed)
                {
                    PrimaryKey.Focus();
                }
            }
        }

        // States that share a screen update in place (the meter, the steps); others fade in.
        private static int ScreenOf(Phase phase)
        {
            switch (phase)
            {
                case Phase.Preparing:
                case Phase.Unpacking:
                case Phase.SettingUp:
                case Phase.Installed:
                    return 0;
                case Phase.ConfirmUninstall:
                    return 1;
                case Phase.Uninstalling:
                case Phase.Uninstalled:
                    return 2;
                default:
                    return 3;
            }
        }

        /// <summary>The exception's message, plus the file it names when the message leaves it out.</summary>
        private static string Describe(Exception ex)
        {
            string fileName = (ex as FileNotFoundException)?.FileName;
            if (!string.IsNullOrWhiteSpace(fileName) && ex.Message.IndexOf(fileName, StringComparison.OrdinalIgnoreCase) < 0)
            {
                return ex.Message + " Missing: " + Path.GetFileName(fileName);
            }

            return ex.Message;
        }

        private string ErrorText()
        {
            return string.IsNullOrWhiteSpace(_error) ? "Something went wrong." : _error.Trim();
        }

        private void SetText(string title, string status)
        {
            TitleText.Text = title;
            if (StatusText.Text == status)
            {
                return;
            }

            StatusText.Text = status;
            StatusScroll.ScrollToTop();
            AutomationPeer peer = UIElementAutomationPeer.FromElement(StatusText) ?? UIElementAutomationPeer.CreatePeerForElement(StatusText);
            peer?.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
        }

        /// <summary>A silkscreen kicker, or (with an LED colour) an LED label: the word carries the meaning.</summary>
        private void SetKicker(string text, string led)
        {
            KickerText.Text = text;
            if (led == null)
            {
                KickerLed.Visibility = Visibility.Collapsed;
                KickerText.SetResourceReference(TextBlock.ForegroundProperty, "Ink3");
                return;
            }

            KickerLed.Visibility = Visibility.Visible;
            KickerDot.SetResourceReference(System.Windows.Shapes.Shape.FillProperty, led == "Danger" ? "DangerInk" : "Talk");
            KickerHalo.SetResourceReference(System.Windows.Shapes.Shape.FillProperty, led == "Danger" ? "DangerHalo" : "TalkHalo");
            KickerText.SetResourceReference(TextBlock.ForegroundProperty, led == "Danger" ? "DangerInk" : "Talk");
        }

        private void UpdateSteps()
        {
            int current;
            switch (_phase)
            {
                case Phase.Preparing:
                case Phase.Unpacking:
                    current = 0;
                    break;
                case Phase.SettingUp:
                    current = 1;
                    break;
                case Phase.Installed:
                    current = 3;
                    break;
                default:
                    current = _extractionFinished ? 1 : 0;
                    break;
            }

            StepFinish.Label = _noLaunch ? "Finish" : "Start Ralph Meet";
            TreeStep[] steps = { StepUnpack, StepSetup, StepFinish };
            for (int i = 0; i < steps.Length; i++)
            {
                StepState state = i < current ? StepState.Done : i == current ? StepState.Active : StepState.Pending;
                if (i == current && _phase == Phase.InstallFailed)
                {
                    state = StepState.Failed;
                }

                steps[i].State = state;
                steps[i].PathThrough = i < current && current < steps.Length;
            }

            StepCount.Text = string.Format("{0:00} / {1:00}", Math.Min(current + 1, steps.Length), steps.Length);
        }

        private void UpdateMeter(bool animate)
        {
            if (_meterFill == null)
            {
                return;
            }

            long total = Interlocked.Read(ref _payloadTotal);
            long done = Interlocked.Read(ref _payloadDone);
            bool known = total > 0 && (_phase == Phase.Unpacking || _phase == Phase.SettingUp || _phase == Phase.Installed);
            bool finished = _extractionFinished || _phase == Phase.Installed || _phase == Phase.SettingUp;
            double fraction = !known ? (finished ? 1 : 0) : finished ? 1 : Math.Max(0, Math.Min(1, (double)done / total));

            // Waiting with nothing to measure (getting ready, removing): the one allowed loop.
            bool waiting = _phase == Phase.Preparing || _phase == Phase.Uninstalling;
            SetWaiting(waiting);

            Meter.IsIndeterminate = false;
            Meter.Value = Math.Round(fraction * 100);
            AutomationProperties.SetItemStatus(Meter, waiting ? "Waiting" : Math.Round(fraction * 100) + " percent");
            if (animate)
            {
                Motion.To(_meterFill, ScaleTransform.ScaleXProperty, waiting ? 0 : fraction, 250);
            }
            else
            {
                _meterFill.BeginAnimation(ScaleTransform.ScaleXProperty, null);
                _meterFill.ScaleX = waiting ? 0 : fraction;
            }

            if (waiting)
            {
                SizeText.Text = string.Empty;
                PercentText.Text = string.Empty;
            }
            else if (total > 0)
            {
                long shown = finished ? total : done;
                SizeText.Text = string.Format("{0} / {1} MB", ToMegabytes(shown), ToMegabytes(total));
                PercentText.Text = Math.Round(fraction * 100) + "%";
            }
            else
            {
                SizeText.Text = string.Empty;
                PercentText.Text = finished ? "100%" : string.Empty;
            }
        }

        private void SetWaiting(bool waiting)
        {
            if (_meterSegment == null)
            {
                return;
            }

            bool run = waiting && Motion.Enabled;
            if (!run)
            {
                _meterSegmentShift.BeginAnimation(TranslateTransform.XProperty, null);
                _meterSegment.Visibility = Visibility.Collapsed;
                return;
            }

            if (_meterSegment.Visibility == Visibility.Visible)
            {
                return;
            }

            _meterSegment.Visibility = Visibility.Visible;
            double width = Meter.ActualWidth > 0 ? Meter.ActualWidth : 376;
            DoubleAnimation sweep = new DoubleAnimation(-_meterSegment.Width, width, TimeSpan.FromMilliseconds(1400))
            {
                EasingFunction = Motion.EaseInOut,
                RepeatBehavior = RepeatBehavior.Forever,
            };
            sweep.Freeze();
            _meterSegmentShift.BeginAnimation(TranslateTransform.XProperty, sweep);
        }

        private static long ToMegabytes(long bytes)
        {
            return (long)Math.Round(bytes / (1024.0 * 1024.0));
        }

        private static string VersionSuffix()
        {
            string version = typeof(MainWindow).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
            if (string.IsNullOrWhiteSpace(version))
            {
                return string.Empty;
            }

            int plus = version.IndexOf('+');
            return " · " + (plus >= 0 ? version.Substring(0, plus) : version);
        }

        private async void PrimaryKey_Click(object sender, RoutedEventArgs e)
        {
            if (_preview)
            {
                return;
            }

            PrimaryKey.IsEnabled = DangerKey.IsEnabled = SecondaryKey.IsEnabled = false;
            if (_phase == Phase.InstallFailed)
            {
                await InstallAsync();
            }
            else
            {
                await UninstallAsync();
            }
        }

        private void SecondaryKey_Click(object sender, RoutedEventArgs e)
        {
            Application.Current.Shutdown();
        }

        private void CloseKey_Click(object sender, RoutedEventArgs e)
        {
            Application.Current.Shutdown();
        }

        private void MinimizeKey_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState.Minimized;
        }

        private void CopyKey_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(_logPath))
            {
                return;
            }

            // The clipboard can be held by another process for a moment; try a few times.
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    Clipboard.SetText(_logPath);
                    ShowCopied();
                    return;
                }
                catch (COMException)
                {
                    Thread.Sleep(40);
                }
            }
        }

        private void ShowCopied()
        {
            CopyLabel.Text = "Copied";
            CopyGlyph.Data = (Geometry)FindResource("GlyphCheck");
            if (_copiedTimer == null)
            {
                _copiedTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1600) };
                _copiedTimer.Tick += (sender, args) => ResetCopied();
            }

            _copiedTimer.Stop();
            _copiedTimer.Start();
        }

        private void ResetCopied()
        {
            _copiedTimer?.Stop();
            CopyLabel.Text = "Copy path";
            CopyGlyph.Data = (Geometry)FindResource("GlyphCopy");
        }

        private void OpenLogKey_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(_logPath) || _preview)
            {
                return;
            }

            try
            {
                if (File.Exists(_logPath))
                {
                    Process.Start(new ProcessStartInfo(_logPath) { UseShellExecute = true });
                }
                else if (Directory.Exists(Path.GetDirectoryName(_logPath)))
                {
                    Process.Start(new ProcessStartInfo(Path.GetDirectoryName(_logPath)) { UseShellExecute = true });
                }
            }
            catch (Exception ex)
            {
                InstallerLogger.Warn("Could not open the installer log: " + ex.Message);
            }
        }

        private void Root_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            // The whole window drags, as before; keys and the log field handle their own clicks.
            try
            {
                DragMove();
            }
            catch
            {
                /* Ignore drag errors */
            }
        }

        private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                ThemeKind next = Theme.FromSystem();
                if (next != Theme.Current)
                {
                    Theme.Apply(Application.Current.Resources, next);
                }
            }));
        }
    }
}
