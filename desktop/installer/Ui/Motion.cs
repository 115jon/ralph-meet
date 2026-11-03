using System;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace Installer.Ui
{
    /// <summary>
    /// Instrument motion from DESIGN.md: opacity and transforms only, ease-out, 100 to 250ms,
    /// nothing looping at rest. Off when Windows' "Animation effects" setting is off
    /// (SystemParameters.ClientAreaAnimation), which is Windows' reduced-motion switch.
    /// </summary>
    internal static class Motion
    {
        private static bool? _override;

        public static bool Enabled => _override ?? SystemParameters.ClientAreaAnimation;

        /// <summary>For captures: render every state at rest.</summary>
        public static void Disable()
        {
            _override = false;
        }

        public static readonly IEasingFunction EaseOut = Freeze(new CubicEase { EasingMode = EasingMode.EaseOut });

        public static readonly IEasingFunction EaseInOut = Freeze(new CubicEase { EasingMode = EasingMode.EaseInOut });

        /// <summary>Moves a property to a value: animated when motion is on, set at once otherwise.</summary>
        public static void To(Animatable target, DependencyProperty property, double value, int milliseconds, IEasingFunction easing = null)
        {
            if (!Enabled)
            {
                target.BeginAnimation(property, null);
                target.SetValue(property, value);
                return;
            }

            DoubleAnimation animation = new DoubleAnimation(value, TimeSpan.FromMilliseconds(milliseconds))
            {
                EasingFunction = easing ?? EaseOut,
            };
            animation.Freeze();
            target.BeginAnimation(property, animation, HandoffBehavior.SnapshotAndReplace);
        }

        public static void To(UIElement target, DependencyProperty property, double value, int milliseconds, IEasingFunction easing = null)
        {
            if (!Enabled)
            {
                target.BeginAnimation(property, null);
                target.SetValue(property, value);
                return;
            }

            DoubleAnimation animation = new DoubleAnimation(value, TimeSpan.FromMilliseconds(milliseconds))
            {
                EasingFunction = easing ?? EaseOut,
            };
            animation.Freeze();
            target.BeginAnimation(property, animation, HandoffBehavior.SnapshotAndReplace);
        }

        /// <summary>A screen arriving: fade in and settle 4px, 200ms. Skipped without motion.</summary>
        public static void Enter(UIElement element, TranslateTransform settle)
        {
            if (!Enabled)
            {
                element.BeginAnimation(UIElement.OpacityProperty, null);
                element.Opacity = 1;
                settle.BeginAnimation(TranslateTransform.YProperty, null);
                settle.Y = 0;
                return;
            }

            DoubleAnimation fade = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(200)) { EasingFunction = EaseOut };
            DoubleAnimation rise = new DoubleAnimation(4, 0, TimeSpan.FromMilliseconds(200)) { EasingFunction = EaseOut };
            fade.Freeze();
            rise.Freeze();
            element.BeginAnimation(UIElement.OpacityProperty, fade);
            settle.BeginAnimation(TranslateTransform.YProperty, rise);
        }

        private static IEasingFunction Freeze(EasingFunctionBase easing)
        {
            easing.Freeze();
            return easing;
        }
    }
}

namespace Installer.Ui
{
    /// <summary>XAML's handle on <see cref="Motion.Enabled"/> (read once per trigger evaluation).</summary>
    internal sealed class MotionFlags
    {
        public static MotionFlags Instance { get; } = new MotionFlags();

        public bool Enabled => Motion.Enabled;
    }
}
