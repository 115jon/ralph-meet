using System;
using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;

namespace Installer.Ui
{
    internal enum ThemeKind
    {
        Dark,
        Light,
        Contrast,
    }

    /// <summary>
    /// The app's Talk Tree tokens (src/styles/tokens.css), as WPF brushes. Layer-1 values are
    /// copied from the dark and light blocks; the tints, lines and guide are derived the same
    /// way tokens.css derives them (ink-1 at a percentage over transparent). High contrast maps
    /// every role onto the system colours instead.
    /// </summary>
    internal static class Theme
    {
        private static bool _applied;

        public static ThemeKind Current { get; private set; }

        /// <summary>Applies the system's theme to the application once, before the first window.</summary>
        public static void EnsureApplied()
        {
            if (!_applied)
            {
                Apply(Application.Current.Resources, FromSystem());
            }
        }

        /// <summary>Windows' app mode (Settings > Personalisation > Colours); dark when unknown.</summary>
        public static ThemeKind FromSystem()
        {
            if (SystemParameters.HighContrast)
            {
                return ThemeKind.Contrast;
            }

            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    if (key?.GetValue("AppsUseLightTheme") is int light && light == 1)
                    {
                        return ThemeKind.Light;
                    }
                }
            }
            catch (Exception)
            {
            }

            return ThemeKind.Dark;
        }

        public static void Apply(ResourceDictionary resources, ThemeKind kind)
        {
            Current = kind;
            _applied = true;
            switch (kind)
            {
                case ThemeKind.Light:
                    ApplyPalette(resources, Light);
                    break;
                case ThemeKind.Contrast:
                    ApplyContrast(resources);
                    break;
                default:
                    ApplyPalette(resources, Dark);
                    break;
            }
        }

        private sealed class Palette
        {
            public string Ply0, Ply2, Ink1, Ink2, Ink3, PrimaryFill, OnPrimary, Accent, Talk, DangerFill, OnDanger, DangerInk;
            public double LineMix, LineStrongMix, GuideMix, AccentTintMix;
            public string SilkFont;
        }

        private static readonly Palette Dark = new Palette
        {
            Ply0 = "#000000",
            Ply2 = "#141417",
            Ink1 = "#f2f2f3",
            Ink2 = "#b4b4ba",
            Ink3 = "#8b8b92",
            PrimaryFill = "#f2f2f3",
            OnPrimary = "#000000",
            Accent = "#a5adff",
            Talk = "#3ddc84",
            DangerFill = "#d4343a",
            OnDanger = "#ffffff",
            DangerInk = "#ff6b6b",
            LineMix = 0.08,
            LineStrongMix = 0.14,
            GuideMix = 0.12,
            AccentTintMix = 0.16,
            // Condensed silkscreen on dark grounds (wdth 90, 500, 0.08em).
            SilkFont = "RM Martian Silk",
        };

        private static readonly Palette Light = new Palette
        {
            Ply0 = "#f4f4f5",
            Ply2 = "#ffffff",
            Ink1 = "#0b0b0d",
            Ink2 = "#4a4a52",
            Ink3 = "#6b6b73",
            PrimaryFill = "#0b0b0d",
            OnPrimary = "#ffffff",
            Accent = "#4a54d4",
            Talk = "#1a9a52",
            DangerFill = "#c8282e",
            OnDanger = "#ffffff",
            DangerInk = "#c4262b",
            LineMix = 0.09,
            LineStrongMix = 0.16,
            GuideMix = 0.18,
            AccentTintMix = 0.12,
            // Light grounds widen it (wdth 100, 600, 0.10em): the condensed cut was hard to read.
            SilkFont = "RM Martian Silk Wide",
        };

        private static void ApplyPalette(ResourceDictionary r, Palette p)
        {
            Color ink1 = Parse(p.Ink1);
            Color accent = Parse(p.Accent);
            Color talk = Parse(p.Talk);
            Color danger = Parse(p.DangerInk);

            r["Ply0"] = Solid(Parse(p.Ply0));
            r["Ply2"] = Solid(Parse(p.Ply2));
            r["Ink1"] = Solid(ink1);
            r["Ink2"] = Solid(Parse(p.Ink2));
            r["Ink3"] = Solid(Parse(p.Ink3));
            r["PrimaryFill"] = Solid(Parse(p.PrimaryFill));
            r["OnPrimary"] = Solid(Parse(p.OnPrimary));
            r["AccentInk"] = Solid(accent);
            r["AccentTint"] = Solid(accent, p.AccentTintMix);
            r["Talk"] = Solid(talk);
            r["TalkHalo"] = Solid(talk, 0.22);
            r["DangerFill"] = Solid(Parse(p.DangerFill));
            r["OnDanger"] = Solid(Parse(p.OnDanger));
            r["DangerInk"] = Solid(danger);
            r["DangerHalo"] = Solid(danger, 0.22);
            r["Tint1"] = Solid(ink1, 0.06);
            r["Tint2"] = Solid(ink1, 0.10);
            r["Tint3"] = Solid(ink1, 0.16);
            r["Line"] = Solid(ink1, p.LineMix);
            r["LineStrong"] = Solid(ink1, p.LineStrongMix);
            r["Guide"] = Solid(ink1, p.GuideMix);
            r["Disabled"] = Solid(ink1, 0.10);
            r["SilkFont"] = Font(p.SilkFont);
            r["ShowDither"] = Visibility.Visible;
        }

        private static void ApplyContrast(ResourceDictionary r)
        {
            SolidColorBrush window = Solid(SystemColors.WindowColor);
            SolidColorBrush text = Solid(SystemColors.WindowTextColor);
            SolidColorBrush highlight = Solid(SystemColors.HighlightColor);
            SolidColorBrush highlightText = Solid(SystemColors.HighlightTextColor);
            SolidColorBrush clear = Solid(Colors.Transparent);

            r["Ply0"] = window;
            r["Ply2"] = window;
            r["Ink1"] = text;
            r["Ink2"] = text;
            r["Ink3"] = text;
            r["PrimaryFill"] = highlight;
            r["OnPrimary"] = highlightText;
            r["AccentInk"] = highlight;
            r["AccentTint"] = clear;
            r["Talk"] = text;
            r["TalkHalo"] = clear;
            r["DangerFill"] = highlight;
            r["OnDanger"] = highlightText;
            r["DangerInk"] = text;
            r["DangerHalo"] = clear;
            r["Tint1"] = clear;
            r["Tint2"] = clear;
            r["Tint3"] = clear;
            r["Line"] = text;
            r["LineStrong"] = text;
            r["Guide"] = text;
            r["Disabled"] = Solid(SystemColors.GrayTextColor);
            r["SilkFont"] = Font("RM Martian Silk Wide");
            // Dither is decoration: under forced colours only the text remains (DESIGN.md).
            r["ShowDither"] = Visibility.Collapsed;
        }

        private static FontFamily Font(string family)
        {
            return new FontFamily(new Uri("pack://application:,,,/"), "./Assets/Fonts/#" + family);
        }

        private static Color Parse(string hex)
        {
            return (Color)ColorConverter.ConvertFromString(hex);
        }

        private static SolidColorBrush Solid(Color color, double alpha = 1)
        {
            SolidColorBrush brush = new SolidColorBrush(Color.FromArgb((byte)Math.Round(color.A * alpha), color.R, color.G, color.B));
            brush.Freeze();
            return brush;
        }
    }
}
