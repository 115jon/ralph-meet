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
    /// DitherGlyph motif="mark" (ui/yap-bark): Yappy, the Yap mark, printed in accent ink through a
    /// 32-cell diagonal ramp. While Pending the jaw barks: it steps closed, half, open, half twice,
    /// then rests shut, on the web bark's timeline (motion.css rm-bark), and two short ticks show
    /// beside the open mouth. At rest, or with Windows' animation effects off, it is the icon's
    /// still pose (jaw open, no ticks).
    /// </summary>
    internal sealed class DitherMark : FrameworkElement
    {
        private const int Cells = 32;

        private enum Jaw
        {
            Closed,
            Half,
            Open,
        }

        // The lower jaw per frame, in grid units (yap-bark.tsx JAW).
        private static readonly Rect[] JawRects =
        {
            new Rect(17, 19, 13, 4),
            new Rect(17, 20, 12, 4),
            new Rect(17, 22, 11, 4),
        };

        // Two 45-degree ticks off the snout and the jaw tip (yap-bark.tsx TICK_CELLS).
        private static readonly Point[] TickCells =
        {
            new Point(29, 10), new Point(30, 9), new Point(31, 8),
            new Point(29, 28), new Point(30, 29), new Point(31, 30),
        };

        // "yap yap", then a rest: 1.4s, as the rm-bark keyframes step.
        private static readonly (Jaw Jaw, int Ms)[] Timeline =
        {
            (Jaw.Closed, 420), (Jaw.Half, 84), (Jaw.Open, 224), (Jaw.Half, 84),
            (Jaw.Closed, 84), (Jaw.Half, 84), (Jaw.Open, 224), (Jaw.Half, 84), (Jaw.Closed, 112),
        };

        private static DrawingBrush _ramp;
        private static Geometry _ticks;

        private readonly System.Windows.Threading.DispatcherTimer _timer;
        private int _frame = -1;

        public static readonly DependencyProperty PendingProperty = DependencyProperty.Register(
            nameof(Pending), typeof(bool), typeof(DitherMark),
            new FrameworkPropertyMetadata(false, FrameworkPropertyMetadataOptions.AffectsRender, OnPendingChanged));

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
            _timer = new System.Windows.Threading.DispatcherTimer();
            _timer.Tick += (_, __) => Step();
            Loaded += (_, __) => UpdateBark();
            Unloaded += (_, __) => StopBark();
            IsVisibleChanged += (_, __) => UpdateBark();
        }

        private static void OnPendingChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        {
            ((DitherMark)d).UpdateBark();
        }

        /// <summary>Barks only while something is pending, on screen, and motion is on.</summary>
        private void UpdateBark()
        {
            if (Pending && IsLoaded && IsVisible && Motion.Enabled)
            {
                if (!_timer.IsEnabled)
                {
                    _frame = -1;
                    Step();
                    _timer.Start();
                }
            }
            else
            {
                StopBark();
            }
        }

        private void StopBark()
        {
            _timer.Stop();
            if (_frame != -1)
            {
                _frame = -1;
                InvalidateVisual();
            }
        }

        private void Step()
        {
            _frame = (_frame + 1) % Timeline.Length;
            _timer.Interval = System.TimeSpan.FromMilliseconds(Timeline[_frame].Ms);
            InvalidateVisual();
        }

        private static DrawingBrush Ramp()
        {
            return Dither.Mask(Cells, Cells, (x, y) =>
            {
                double d = (x + y) / (2.0 * (Cells - 1));
                return Dither.BayerLit(x, y, 0.98 - d * 0.3);
            });
        }

        private static Geometry Ticks()
        {
            GeometryGroup group = new GeometryGroup();
            foreach (Point cell in TickCells)
            {
                group.Children.Add(new RectangleGeometry(new Rect(cell.X, cell.Y, 1, 1)));
            }

            group.Freeze();
            return group;
        }

        protected override void OnRender(DrawingContext dc)
        {
            double size = System.Math.Min(ActualWidth, ActualHeight);
            if (size <= 0 || Ink == null)
            {
                return;
            }

            Geometry head = TryFindResource("LogoHeadGeometry") as Geometry;
            Geometry black = TryFindResource("LogoBlackGeometry") as Geometry;
            if (head == null)
            {
                return;
            }

            Jaw jaw = _frame < 0 ? Jaw.Open : Timeline[_frame].Jaw;
            bool ticks = _frame >= 0 && jaw == Jaw.Open;

            DrawingBrush mask = (_ramp ?? (_ramp = Ramp())).CloneCurrentValue();
            mask.Viewport = new Rect(0, 0, size, size);
            mask.ViewportUnits = BrushMappingMode.Absolute;
            mask.Freeze();

            double scale = size / Cells;
            double offsetX = (ActualWidth - size) / 2;
            double offsetY = (ActualHeight - size) / 2;

            dc.PushTransform(new MatrixTransform(scale, 0, 0, scale, offsetX, offsetY));
            if (ticks)
            {
                dc.DrawGeometry(Ink, null, _ticks ?? (_ticks = Ticks()));
            }

            dc.Pop();

            dc.PushOpacityMask(mask);
            dc.PushTransform(new MatrixTransform(scale, 0, 0, scale, offsetX, offsetY));
            dc.DrawGeometry(Ink, null, head);
            dc.DrawRectangle(Ink, null, JawRects[(int)jaw]);
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
