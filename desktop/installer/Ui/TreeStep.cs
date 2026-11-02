using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;

namespace Installer.Ui
{
    internal enum StepState
    {
        Pending,
        Active,
        Done,
        Failed,
    }

    /// <summary>
    /// One leaf of the steps tree (TreeLeaf in the app): an upper trunk, an 8px tick to the
    /// node, a lower trunk to the next sibling unless it is last, and an LED for the node. The
    /// leaf you are on lights its trunk and tick in accent ink, and so do the trunks of the
    /// leaves before it, up to the branch root; a finished step lights its LED talk green.
    /// </summary>
    internal sealed class TreeStep : Control
    {
        public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
            nameof(Label), typeof(string), typeof(TreeStep), new PropertyMetadata(string.Empty, OnAccessibleChanged));

        public static readonly DependencyProperty StateProperty = DependencyProperty.Register(
            nameof(State), typeof(StepState), typeof(TreeStep), new PropertyMetadata(StepState.Pending, OnAccessibleChanged));

        public static readonly DependencyProperty IsLastProperty = DependencyProperty.Register(
            nameof(IsLast), typeof(bool), typeof(TreeStep), new PropertyMetadata(false));

        /// <summary>The path to the current leaf runs through this leaf's whole trunk.</summary>
        public static readonly DependencyProperty PathThroughProperty = DependencyProperty.Register(
            nameof(PathThrough), typeof(bool), typeof(TreeStep), new PropertyMetadata(false));

        public string Label
        {
            get => (string)GetValue(LabelProperty);
            set => SetValue(LabelProperty, value);
        }

        public StepState State
        {
            get => (StepState)GetValue(StateProperty);
            set => SetValue(StateProperty, value);
        }

        public bool IsLast
        {
            get => (bool)GetValue(IsLastProperty);
            set => SetValue(IsLastProperty, value);
        }

        public bool PathThrough
        {
            get => (bool)GetValue(PathThroughProperty);
            set => SetValue(PathThroughProperty, value);
        }

        static TreeStep()
        {
            FocusableProperty.OverrideMetadata(typeof(TreeStep), new FrameworkPropertyMetadata(false));
        }

        private static void OnAccessibleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        {
            TreeStep step = (TreeStep)d;
            string state;
            switch (step.State)
            {
                case StepState.Active:
                    state = "in progress";
                    break;
                case StepState.Done:
                    state = "done";
                    break;
                case StepState.Failed:
                    state = "failed";
                    break;
                default:
                    state = "not started";
                    break;
            }

            AutomationProperties.SetName(step, step.Label + ", " + state);
        }
    }
}
