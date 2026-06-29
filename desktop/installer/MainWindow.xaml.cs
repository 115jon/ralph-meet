using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace Installer
{
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

        public MainWindow()
        {
            InitializeComponent();
            this.Loaded += MainWindow_Loaded;
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
            if (this.Resources["BreatheAnimation"] is Storyboard breatheStoryboard)
            {
                breatheStoryboard.Begin();
            }

            if (this.Resources["LoadingAnimation"] is Storyboard loadingStoryboard)
            {
                loadingStoryboard.Begin();
            }

            if (App.IsUninstallLaunch)
            {
                ConfigureForInteractiveUninstall();
                return;
            }

            try
            {
                await RunInstallationAsync();
                StatusText.Text = "Launching...";
                await Task.Delay(1000);

                Application.Current.Shutdown();
            }
            catch (Exception ex)
            {
                InstallerLogger.Error("Interactive installation failed.", ex);
                StatusText.Text = "Install failed";
                DetailText.Text = InstallerLogger.AppendLogPath(ex.Message);
                DetailText.Visibility = Visibility.Visible;
                ProgressContainer.Visibility = Visibility.Collapsed;
            }
        }

        private async Task RunInstallationAsync()
        {
            Dispatcher.Invoke(() =>
            {
                Title = "Ralph Meet Setup";
                StatusText.Text = "Extracting files...";
                DetailText.Visibility = Visibility.Collapsed;
                ActionButtonsPanel.Visibility = Visibility.Collapsed;
                ProgressContainer.Visibility = Visibility.Visible;
            });
            await InstallerLogic.RunInstallationAsync();
        }

        private void ConfigureForInteractiveUninstall()
        {
            Title = "Ralph Meet Uninstall";
            StatusText.Text = "Uninstall Ralph Meet?";
            DetailText.Text = "This will remove the desktop app and shortcuts from this PC. Your Ralph Meet data in AppData\\Roaming\\RalphMeet will be kept.";
            DetailText.Visibility = Visibility.Visible;
            ProgressContainer.Visibility = Visibility.Collapsed;
            ActionButtonsPanel.Visibility = Visibility.Visible;
            ConfirmButton.IsEnabled = true;
            CancelButton.IsEnabled = true;
        }

        private async void ConfirmButton_Click(object sender, RoutedEventArgs e)
        {
            ConfirmButton.IsEnabled = false;
            CancelButton.IsEnabled = false;
            ActionButtonsPanel.Visibility = Visibility.Collapsed;
            ProgressContainer.Visibility = Visibility.Visible;
            StatusText.Text = "Uninstalling...";
            DetailText.Text = "Removing Ralph Meet from this PC.";
            DetailText.Visibility = Visibility.Visible;

            try
            {
                await InstallerLogic.RunUninstallationAsync();
                StatusText.Text = "Ralph Meet was removed.";
                DetailText.Text = "Your Ralph Meet data was left intact, and you can reinstall any time with the latest setup.";
                await Task.Delay(1200);
                Application.Current.Shutdown();
            }
            catch (Exception ex)
            {
                InstallerLogger.Error("Interactive uninstallation failed.", ex);
                StatusText.Text = "Uninstall failed";
                DetailText.Text = InstallerLogger.AppendLogPath(ex.Message);
                ActionButtonsPanel.Visibility = Visibility.Visible;
                ProgressContainer.Visibility = Visibility.Collapsed;
                ConfirmButton.IsEnabled = true;
                CancelButton.IsEnabled = true;
            }
        }

        private void CancelButton_Click(object sender, RoutedEventArgs e)
        {
            Application.Current.Shutdown();
        }

        private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try
            {
                this.DragMove();
            }
            catch { /* Ignore drag errors */ }
        }
    }
}
