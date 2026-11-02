using System.Windows;
using System.Windows.Media;

namespace Installer.Ui
{
    /// <summary>
    /// Still Bayer dither, as the app's ui/dither and ui/dither-glyph print it: lit cells are
    /// one geometry used as an opacity mask over a role colour, so a theme change costs nothing
    /// and nothing ever moves.
    /// </summary>
    internal static class Dither
    {
        private static readonly int[,] Bayer4 =
        {
            { 0, 8, 2, 10 },
            { 12, 4, 14, 6 },
            { 3, 11, 1, 9 },
            { 15, 7, 13, 5 },
        };

        private static readonly int[,] Bayer8 =
        {
            { 0, 32, 8, 40, 2, 34, 10, 42 },
            { 48, 16, 56, 24, 50, 18, 58, 26 },
            { 12, 44, 4, 36, 14, 46, 6, 38 },
            { 60, 28, 52, 20, 62, 30, 54, 22 },
            { 3, 35, 11, 43, 1, 33, 9, 41 },
            { 51, 19, 59, 27, 49, 17, 57, 25 },
            { 15, 47, 7, 39, 13, 45, 5, 37 },
            { 63, 31, 55, 23, 61, 29, 53, 21 },
        };

        public delegate bool Lit(int x, int y);

        /// <summary>bayerLit() in ui/dither.tsx.</summary>
        public static bool BayerLit(int x, int y, double coverage)
        {
            return coverage * 64 > Bayer8[y % 8, x % 8] + 0.5;
        }

        /// <summary>A flat coverage on the 4x4 tile, as DitherDots prints a key's cap.</summary>
        public static bool TileLit(int x, int y, double coverage)
        {
            return (int)System.Math.Round(coverage * 16) > Bayer4[y % 4, x % 4];
        }

        /// <summary>A cols x rows cell mask stretched over whatever it masks.</summary>
        public static DrawingBrush Mask(int cols, int rows, Lit lit)
        {
            StreamGeometry cells = new StreamGeometry { FillRule = FillRule.Nonzero };
            using (StreamGeometryContext ctx = cells.Open())
            {
                for (int y = 0; y < rows; y++)
                {
                    for (int x = 0; x < cols; x++)
                    {
                        if (!lit(x, y))
                        {
                            continue;
                        }

                        ctx.BeginFigure(new Point(x, y), true, true);
                        ctx.PolyLineTo(new[] { new Point(x + 1, y), new Point(x + 1, y + 1), new Point(x, y + 1) }, false, false);
                    }
                }
            }

            cells.Freeze();
            DrawingBrush brush = new DrawingBrush(new GeometryDrawing(Brushes.Black, null, cells))
            {
                Viewbox = new Rect(0, 0, cols, rows),
                ViewboxUnits = BrushMappingMode.Absolute,
                Stretch = Stretch.Fill,
            };
            brush.Freeze();
            return brush;
        }
    }

    /// <summary>
    /// DitherGlyph motif="mark": the Ralph Meet mark printed in accent ink through a 32-cell
    /// diagonal ramp. Pending prints about 70 percent of the light, as the cold-load mark is
    /// before its last step; that is the whole loading signal.
    /// </summary>
    internal sealed class DitherMark : FrameworkElement
    {
        private const int Cells = 32;
        private const double PendingScale = 0.7;

        // The splash-logo.svg viewBox: the mark is fitted ("contain") into the square.
        private static readonly Rect LogoBox = new Rect(560, 605, 916, 963);

        private static DrawingBrush _whole;
        private static DrawingBrush _pending;

        public static readonly DependencyProperty PendingProperty = DependencyProperty.Register(
            nameof(Pending), typeof(bool), typeof(DitherMark),
            new FrameworkPropertyMetadata(false, FrameworkPropertyMetadataOptions.AffectsRender));

        public static readonly DependencyProperty InkProperty = DependencyProperty.Register(
            nameof(Ink), typeof(Brush), typeof(DitherMark),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));

        public static readonly DependencyProperty GroundProperty = DependencyProperty.Register(
            nameof(Ground), typeof(Brush), typeof(DitherMark),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));

        public bool Pending
        {
            get => (bool)GetValue(PendingProperty);
            set => SetValue(PendingProperty, value);
        }

        public Brush Ink
        {
            get => (Brush)GetValue(InkProperty);
            set => SetValue(InkProperty, value);
        }

        /// <summary>The ground the mark sits on; it paints the mark's cut-outs.</summary>
        public Brush Ground
        {
            get => (Brush)GetValue(GroundProperty);
            set => SetValue(GroundProperty, value);
        }

        public DitherMark()
        {
            Focusable = false;
            IsHitTestVisible = false;
            SnapsToDevicePixels = true;
        }

        private static DrawingBrush Ramp(bool pending)
        {
            double scale = pending ? PendingScale : 1;
            return Dither.Mask(Cells, Cells, (x, y) =>
            {
                double d = (x + y) / (2.0 * (Cells - 1));
                return Dither.BayerLit(x, y, (0.98 - d * 0.5) * scale);
            });
        }

        protected override void OnRender(DrawingContext dc)
        {
            double size = System.Math.Min(ActualWidth, ActualHeight);
            if (size <= 0 || Ink == null)
            {
                return;
            }

            Geometry white = TryFindResource("LogoWhiteGeometry") as Geometry;
            Geometry black = TryFindResource("LogoBlackGeometry") as Geometry;
            if (white == null)
            {
                return;
            }

            DrawingBrush ramp = Pending ? (_pending ?? (_pending = Ramp(true))) : (_whole ?? (_whole = Ramp(false)));
            DrawingBrush mask = ramp.CloneCurrentValue();
            mask.Viewport = new Rect(0, 0, size, size);
            mask.ViewportUnits = BrushMappingMode.Absolute;
            mask.Freeze();

            double scale = size / System.Math.Max(LogoBox.Width, LogoBox.Height);
            double offsetX = (size - LogoBox.Width * scale) / 2 - LogoBox.X * scale;
            double offsetY = (size - LogoBox.Height * scale) / 2 - LogoBox.Y * scale;

            dc.PushOpacityMask(mask);
            dc.PushTransform(new MatrixTransform(scale, 0, 0, scale, offsetX, offsetY));
            dc.DrawGeometry(Ink, null, white);
            if (black != null && Ground != null)
            {
                dc.DrawGeometry(Ground, null, black);
            }

            dc.Pop();
            dc.Pop();
        }
    }

    /// <summary>DitherDots: a still patch of dots, here the notched primary key's trailing cap.</summary>
    internal sealed class DitherDots : FrameworkElement
    {
        private static DrawingBrush _cap;

        public static readonly DependencyProperty InkProperty = DependencyProperty.Register(
            nameof(Ink), typeof(Brush), typeof(DitherDots),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));

        public Brush Ink
        {
            get => (Brush)GetValue(InkProperty);
            set => SetValue(InkProperty, value);
        }

        public DitherDots()
        {
            Focusable = false;
            IsHitTestVisible = false;
            SnapsToDevicePixels = true;
        }

        protected override void OnRender(DrawingContext dc)
        {
            // 2px cells at 0.45 coverage, as KeyCap draws it (w-3 h-6: 6 x 12 cells).
            int cols = (int)System.Math.Round(ActualWidth / 2);
            int rows = (int)System.Math.Round(ActualHeight / 2);
            if (cols <= 0 || rows <= 0 || Ink == null)
            {
                return;
            }

            if (_cap == null)
            {
                _cap = Dither.Mask(6, 12, (x, y) => Dither.TileLit(x, y, 0.45));
            }

            DrawingBrush mask = _cap.CloneCurrentValue();
            mask.Viewport = new Rect(0, 0, ActualWidth, ActualHeight);
            mask.ViewportUnits = BrushMappingMode.Absolute;
            mask.Freeze();
            dc.PushOpacityMask(mask);
            dc.DrawRectangle(Ink, null, new Rect(0, 0, ActualWidth, ActualHeight));
            dc.Pop();
        }
    }
}
