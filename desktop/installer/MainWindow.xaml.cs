using System;
using System.ComponentModel;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media.Animation;

namespace Installer
{
    public partial class MainWindow : Window
    {
        public MainWindow()
        {
            InitializeComponent();
            this.Loaded += MainWindow_Loaded;
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            // Start animations
            if (this.Resources["BreatheAnimation"] is Storyboard breatheStoryboard)
            {
                breatheStoryboard.Begin();
            }

            if (this.Resources["LoadingAnimation"] is Storyboard loadingStoryboard)
            {
                loadingStoryboard.Begin();
            }

            // Start the background installation process
            await Task.Run(() => RunInstallation());

            // Installation complete
            StatusText.Text = "LAUNCHING...";
            await Task.Delay(1000); // Give users a second to see it's done

            // TODO: Launch the installed RalphMeet.exe

            Application.Current.Shutdown();
        }

        private async Task RunInstallation()
        {
            // Update UI from background thread
            Dispatcher.Invoke(() => StatusText.Text = "EXTRACTING FILES...");

            await InstallerLogic.RunInstallationAsync();
        }
    }
}
