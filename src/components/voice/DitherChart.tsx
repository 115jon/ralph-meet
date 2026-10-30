/**
 * Dithered stat charts for the voice stats (approved in
 * `/ui-fixtures?surface=dither-mockups`, "Voice debug — dithered charts"):
 *
 *   - `DitherSmallMultiples`: one bar tile per metric (variant 1). The
 *     details popover's Connection tab.
 *   - `DitherTimeline`: one shared timeline with a lane per metric, packet
 *     loss as a density strip (variant 2). The full debug screen.
 *
 * Fills are 4×4 ordered-dither patterns in `--accent-ink`; a 2px solid cap
 * carries each value. Cost: the charts are plain SVG paths (three per lane,
 * whatever the sample count), rebuilt only when a new stats snapshot lands
 * (2 s) or the box resizes. Nothing animates between samples.
 *
 * Accessibility: the marks are aria-hidden. The figure has a title and a
 * written summary, every value a chart shows is also text (current, min,
 * avg, max, guide, labelled loss peaks), and the samples are a real table
 * behind a disclosure. Density never carries meaning alone: loss buckets
 * have a text legend, and under forced colours the fills go solid
 * CanvasText and the loss strip encodes its bucket in bar height.
 */

import { Icon } from "@/components/ui/icon";
import { LedLabel, type LedState } from "@/components/ui/led";
import { Num } from "@/components/ui/num";
import { cn } from "@/lib/utils";
import {
  axisCeiling,
  chartSummary,
  formatAge,
  formatValue,
  LOSS_LEVELS,
  levelOf,
  pickPeaks,
  sampleIntervalS,
  summarizeMetric,
  windowS,
  type ChartMetric,
  type ChartSample,
  type DensityLevel,
  type MetricSummary,
} from "./dither-chart-model";
import {
  memo,
  useCallback,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// ── Geometry ────────────────────────────────────────────────────────────────

const CELL = 2;
const snap = (v: number) => Math.round(v / CELL) * CELL;

/**
 * Slot `i` of `n` samples in a window of `capacity` slots, right-aligned so
 * the latest sample always sits at the right edge and the chart fills in
 * from the right as history builds. Integer pixel edges.
 */
function slotX(width: number, capacity: number, n: number, i: number) {
  const slot = width / capacity;
  const j = capacity - n + i;
  return { x0: Math.round(j * slot), x1: Math.round((j + 1) * slot) };
}

/** Centre of sample `i` as a percentage of the chart width. */
function slotCentrePct(capacity: number, n: number, i: number): number {
  return ((capacity - n + i + 0.5) / capacity) * 100;
}

const rectPath = (x: number, y: number, w: number, h: number) =>
  w > 0 && h > 0 ? `M${x} ${y}h${w}v${h}h${-w}Z` : "";

/** Width of the element, tracked with a ResizeObserver (0 before mount). */
function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    // Fires only when the box resizes; setState bails on an equal width.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// ── Fills ───────────────────────────────────────────────────────────────────

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * An ordered-dither fill: `level` of 16 cells lit in accent ink. Patterns
 * are in user space, so bars and steps snap to the same cell grid.
 */
function DitherPattern({
  id,
  level,
  cell = CELL,
}: {
  id: string;
  level: number;
  cell?: number;
}) {
  return (
    <pattern
      id={id}
      width={cell * 4}
      height={cell * 4}
      patternUnits="userSpaceOnUse"
    >
      <g className="fill-(--accent-ink)">
        {BAYER4.flatMap((row, y) =>
          row.map((m, x) =>
            m < level ? (
              <rect
                key={`${x}-${y}`}
                x={x * cell}
                y={y * cell}
                width={cell}
                height={cell}
              />
            ) : null,
          ),
        )}
      </g>
    </pattern>
  );
}

/** Solid accent; CanvasText under forced colours. */
const INK = "fill-(--accent-ink) forced-colors:fill-[CanvasText]";
/** A pattern fill (set `--dither`); solid CanvasText under forced colours. */
const DITHER = "fill-(--dither) forced-colors:fill-[CanvasText]";
const GUIDE = "stroke-(--line-strong) forced-colors:stroke-[GrayText]";
const BASELINE = "stroke-(--line-strong) forced-colors:stroke-[CanvasText]";

const ditherFill = (id: string) =>
  ({ "--dither": `url(#${id})` }) as CSSProperties;

/** A sized, aria-hidden SVG host; draws once the box has a width. */
function ChartSvg({
  height,
  children,
}: {
  height: number;
  children: (width: number) => ReactNode;
}) {
  const [ref, width] = useWidth();
  return (
    <div ref={ref} className="w-full min-w-0" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
          shapeRendering="crispEdges"
          aria-hidden="true"
          focusable="false"
        >
          {children(width)}
        </svg>
      ) : null}
    </div>
  );
}

// ── Samples table ───────────────────────────────────────────────────────────

/**
 * The samples as a real table behind a disclosure. Rows render only while
 * it is open, so a closed table costs nothing per snapshot.
 */
function SampleTable<K extends string>({
  metrics,
  samples,
  className,
}: {
  metrics: readonly ChartMetric<K>[];
  samples: readonly ChartSample<K>[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const last = samples[samples.length - 1];
  return (
    <details
      className={cn("group", className)}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="silkscreen inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[2px] text-ink-2 select-none pointer-fine:hover:text-ink-1">
        <Icon
          name="chevronRight"
          size="xs"
          className="transition-transform duration-(--dur-1) group-open:rotate-90"
        />
        Samples as a table
      </summary>
      {open && last ? (
        <div
          role="region"
          aria-label="Samples"
          tabIndex={0}
          className="mt-2 max-h-56 overflow-auto rounded-[2px] border border-line"
        >
          <table className="w-full text-left">
            <caption className="sr-only">
              Connection samples, oldest first
            </caption>
            <thead className="sticky top-0 bg-ply-3 text-ink-3">
              <tr>
                <th scope="col" className="silkscreen px-3 py-1.5">
                  Time
                </th>
                {metrics.map((m) => (
                  <th
                    key={m.key}
                    scope="col"
                    className="silkscreen px-3 py-1.5 text-right whitespace-nowrap"
                  >
                    {m.label} ({m.unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-num-xs text-ink-2">
              {samples.map((s) => (
                <tr key={s.t} className="border-t border-line">
                  <th scope="row" className="px-3 py-1 font-medium">
                    {formatAge(Math.round((s.t - last.t) / 1000))}
                  </th>
                  {metrics.map((m) => (
                    <td key={m.key} className="px-3 py-1 text-right">
                      {formatValue(s[m.key], m.digits)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  );
}

// ── Variant 1: small multiples ──────────────────────────────────────────────

function BarTile<K extends string>({
  metric,
  samples,
  capacity,
  height,
  compact,
}: {
  metric: ChartMetric<K>;
  samples: readonly ChartSample<K>[];
  capacity: number;
  height: number;
  compact: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const s = useMemo(
    () => summarizeMetric(samples, metric.key),
    [samples, metric.key],
  );
  const ceiling = axisCeiling(metric, s);
  const y = (v: number) =>
    height - snap((Math.min(v, ceiling) / ceiling) * height);

  const draw = (width: number) => {
    // Every bar is the same even width (whole dither cells) and starts on
    // the cell grid, so the fill reads the same in each; the gaps absorb the
    // rounding (a pixel either way) and the window spans the full width.
    const n = samples.length;
    const slot = width / capacity;
    const w =
      slot >= 3 ? Math.max(CELL, Math.floor((slot - 1) / CELL) * CELL) : 1;
    let body = "";
    let cap = "";
    let latest = "";
    samples.forEach((sample, i) => {
      const x0 =
        slot >= 3
          ? snap((capacity - n + i) * slot)
          : slotX(width, capacity, n, i).x0;
      const top = Math.min(y(sample[metric.key]), height - 2);
      if (i === n - 1) latest = rectPath(x0, top, w, height - top);
      else body += rectPath(x0, top, w, height - top);
      cap += rectPath(x0, top, w, 2);
    });
    return (
      <>
        <defs>
          <DitherPattern id={`${uid}-fill`} level={7} />
        </defs>
        {metric.guide !== undefined && metric.guide < ceiling ? (
          <line
            x1={0}
            x2={width}
            y1={y(metric.guide) + 0.5}
            y2={y(metric.guide) + 0.5}
            strokeDasharray="2 4"
            className={GUIDE}
          />
        ) : null}
        <path d={body} className={DITHER} style={ditherFill(`${uid}-fill`)} />
        <path d={latest} className={INK} />
        <path d={cap} className={INK} />
        <line
          x1={0}
          x2={width}
          y1={height - 0.5}
          y2={height - 0.5}
          className={BASELINE}
        />
      </>
    );
  };

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2",
        compact ? "px-2.5 py-3" : "p-4",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="silkscreen truncate text-ink-3">{metric.label}</span>
        <span className="flex shrink-0 items-baseline gap-1 whitespace-nowrap text-ink-1">
          <span
            className={cn(
              "font-silk font-semibold tabular-nums [font-stretch:90%]",
              compact ? "text-[16px] leading-5" : "text-[20px] leading-6",
            )}
          >
            {formatValue(s.now, metric.digits)}
          </span>
          <span className="silkscreen text-ink-3">{metric.unit}</span>
        </span>
      </div>
      <ChartSvg height={height}>{draw}</ChartSvg>
      {/* Compact tiles set the readouts on a 2-column grid so every tile
          wraps the same way; wide ones keep them on one line. */}
      <div
        className={cn(
          "silkscreen gap-x-1 gap-y-0.5 text-ink-3 *:whitespace-nowrap",
          compact
            ? "grid grid-cols-2 [&>*:nth-child(even)]:text-right"
            : "flex justify-between",
        )}
      >
        <span>
          min{" "}
          <Num className="text-ink-2">{formatValue(s.min, metric.digits)}</Num>
        </span>
        <span>
          avg{" "}
          <Num className="text-ink-2">{formatValue(s.avg, metric.digits)}</Num>
        </span>
        <span>
          max{" "}
          <Num className="text-ink-2">{formatValue(s.max, metric.digits)}</Num>
        </span>
        {metric.guide !== undefined ? (
          <span>
            guide <Num className="text-ink-2">{metric.guide}</Num>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export interface DitherSmallMultiplesProps<K extends string> {
  title: string;
  /**
   * Leads the caption's right side, before "last N s". Pass a stable
   * (module-level) object so the memoised chart skips unrelated renders.
   */
  status?: { led: LedState; label: string };
  metrics: readonly ChartMetric<K>[];
  samples: readonly ChartSample<K>[];
  /** Slots in the window; older samples are dropped. */
  capacity?: number;
  /** Tighter tiles and shorter bars, for a popover. */
  compact?: boolean;
  className?: string;
}

function DitherSmallMultiplesImpl<K extends string>({
  title,
  status,
  metrics,
  samples: all,
  capacity = 48,
  compact = false,
  className,
}: DitherSmallMultiplesProps<K>) {
  const titleId = useId();
  const descId = useId();
  const samples = useMemo(() => all.slice(-capacity), [all, capacity]);
  const summary = useMemo(
    () => chartSummary(metrics, samples),
    [metrics, samples],
  );
  return (
    <figure
      aria-labelledby={titleId}
      aria-describedby={descId}
      className={cn("min-w-0 border-t-2 border-ink-1 pt-3", className)}
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span
          id={titleId}
          className={cn(
            "font-display font-bold tracking-[-0.01em] text-ink-1 [font-optical-sizing:auto]",
            compact ? "text-[17px] leading-6" : "text-[20px] leading-6",
          )}
        >
          {title}
        </span>
        <span className="inline-flex min-w-0 items-center gap-3">
          {status ? (
            <LedLabel state={status.led}>{status.label}</LedLabel>
          ) : null}
          <span className="silkscreen whitespace-nowrap text-ink-3">
            last <Num>{windowS(samples)}</Num> s
          </span>
        </span>
      </figcaption>
      <p id={descId} className="sr-only">
        {summary}
      </p>
      {samples.length === 0 ? (
        <p className="py-6 text-center text-ui-xs text-ink-3">
          Collecting samples…
        </p>
      ) : (
        <>
          <div className="mt-1 grid grid-cols-2 *:border-line [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(odd)]:border-r [&>*:nth-child(odd)]:pl-0 [&>*:nth-child(even)]:pr-0">
            {metrics.map((m) => (
              <BarTile
                key={m.key}
                metric={m}
                samples={samples}
                capacity={capacity}
                height={compact ? 40 : 64}
                compact={compact}
              />
            ))}
          </div>
          <SampleTable
            metrics={metrics}
            samples={samples}
            className={compact ? "pt-1" : "pt-2"}
          />
        </>
      )}
    </figure>
  );
}

/** Chart variant 1: a bar tile per metric, in a card. */
export const DitherSmallMultiples = memo(
  DitherSmallMultiplesImpl,
) as typeof DitherSmallMultiplesImpl;

// ── Variant 2: timeline lanes ───────────────────────────────────────────────

export interface TimelineLane<K extends string> {
  metric: ChartMetric<K>;
  /** `area` (default): stepped area. `density`: a strip of bucket fills. */
  kind?: "area" | "density";
  /** Area height in px (density strips are 16). */
  height?: number;
  /** Density buckets; loss buckets by default. */
  levels?: readonly DensityLevel[];
}

/**
 * A stepped area with a dense band under its edge and a sparse body, so the
 * value reads from the solid top line.
 */
function AreaLane<K extends string>({
  metric,
  samples,
  capacity,
  height,
  ceiling,
}: {
  metric: ChartMetric<K>;
  samples: readonly ChartSample<K>[];
  capacity: number;
  height: number;
  ceiling: number;
}) {
  const uid = useId().replace(/:/g, "");
  const y = (v: number) =>
    height - Math.max(2, snap((Math.min(v, ceiling) / ceiling) * (height - 4)));
  const draw = (width: number) => {
    const n = samples.length;
    let body = "";
    let edge = "";
    let cap = "";
    samples.forEach((sample, i) => {
      const { x0, x1 } = slotX(width, capacity, n, i);
      const top = y(sample[metric.key]);
      body += rectPath(x0, top, x1 - x0, height - top);
      edge += rectPath(x0, top, x1 - x0, Math.min(8, height - top));
      cap += rectPath(x0, top, x1 - x0, 2);
    });
    return (
      <>
        <defs>
          <DitherPattern id={`${uid}-body`} level={3} />
          <DitherPattern id={`${uid}-edge`} level={10} />
        </defs>
        {metric.guide !== undefined && metric.guide < ceiling ? (
          <line
            x1={0}
            x2={width}
            y1={y(metric.guide) + 0.5}
            y2={y(metric.guide) + 0.5}
            strokeDasharray="2 4"
            className={GUIDE}
          />
        ) : null}
        <path d={body} className={DITHER} style={ditherFill(`${uid}-body`)} />
        <path d={edge} className={DITHER} style={ditherFill(`${uid}-edge`)} />
        <path d={cap} className={INK} />
        <line
          x1={0}
          x2={width}
          y1={height - 0.5}
          y2={height - 0.5}
          className="stroke-(--line) forced-colors:stroke-[CanvasText]"
        />
      </>
    );
  };
  return <ChartSvg height={height}>{draw}</ChartSvg>;
}

const STRIP_H = 16;

/**
 * A metric as a density strip, peaks labelled in text. Under forced colours
 * the bucket is drawn as bar height instead, since density would flatten to
 * one solid colour.
 */
function DensityLane<K extends string>({
  metric,
  samples,
  capacity,
  levels,
}: {
  metric: ChartMetric<K>;
  samples: readonly ChartSample<K>[];
  capacity: number;
  levels: readonly DensityLevel[];
}) {
  const uid = useId().replace(/:/g, "");
  const n = samples.length;
  const peaks = useMemo(
    () => pickPeaks(samples, metric.key, levels[1]?.below ?? 0, capacity),
    [samples, metric.key, levels, capacity],
  );
  const draw = (width: number) => {
    const byLevel = new Map<number, string>();
    let solid = "";
    samples.forEach((sample, i) => {
      const l = levelOf(levels, sample[metric.key]);
      if (l.level === 0) return;
      const { x0, x1 } = slotX(width, capacity, n, i);
      byLevel.set(
        l.level,
        (byLevel.get(l.level) ?? "") + rectPath(x0, 0, x1 - x0, STRIP_H),
      );
      const h = snap((l.level / 16) * STRIP_H);
      solid += rectPath(x0, STRIP_H - h, Math.max(1, x1 - x0 - 1), h);
    });
    return (
      <>
        <defs>
          {levels
            .filter((l) => l.level > 0)
            .map((l) => (
              <DitherPattern
                key={l.level}
                id={`${uid}-${l.level}`}
                level={l.level}
              />
            ))}
        </defs>
        <rect
          width={width}
          height={STRIP_H}
          className="fill-(--tint-1) forced-colors:fill-[Canvas]"
        />
        <g className="forced-colors:hidden">
          {Array.from(byLevel, ([level, d]) => (
            <path
              key={level}
              d={d}
              className="fill-(--dither)"
              style={ditherFill(`${uid}-${level}`)}
            />
          ))}
        </g>
        <path
          d={solid}
          className="hidden forced-colors:inline forced-colors:fill-[CanvasText]"
        />
      </>
    );
  };
  return (
    <div className="relative pt-5">
      {/* The peaks are in the summary and the table; these are for sight. */}
      <div aria-hidden="true">
        {peaks.map(({ v, i }) => {
          const pct = slotCentrePct(capacity, n, i);
          return (
            <Num
              key={samples[i]!.t}
              className={cn(
                "silkscreen absolute top-0 whitespace-nowrap text-ink-2",
                pct < 8
                  ? "translate-x-0"
                  : pct > 92
                    ? "-translate-x-full"
                    : "-translate-x-1/2",
              )}
              style={{ left: `${pct}%` }}
            >
              {formatValue(v, metric.digits)}
              {metric.unit}
            </Num>
          );
        })}
      </div>
      <ChartSvg height={STRIP_H}>{draw}</ChartSvg>
    </div>
  );
}

function LaneSwatch({ level }: { level: number }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 12 12"
      className="size-3 shrink-0"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <DitherPattern id={uid} level={level} cell={1.5} />
      </defs>
      <rect
        width={12}
        height={12}
        className="fill-(--tint-2) forced-colors:fill-[Canvas] forced-colors:stroke-[CanvasText]"
      />
      <rect
        width={12}
        height={12}
        className="fill-(--dither) forced-colors:hidden"
        style={ditherFill(uid)}
      />
      {/* Forced colours: the bucket as height, matching the strip. */}
      <rect
        y={12 - (level / 16) * 12}
        width={12}
        height={(level / 16) * 12}
        className="hidden forced-colors:inline forced-colors:fill-[CanvasText]"
      />
    </svg>
  );
}

/**
 * Lane rows are a container-query grid: label and value over the chart in
 * a narrow figure, label | chart | value in a wide one.
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 @lg:grid-cols-[112px_minmax(0,1fr)_96px] @lg:items-end @lg:gap-x-5";

function LaneRow<K extends string>({
  metric,
  summary,
  children,
}: {
  metric: ChartMetric<K>;
  summary: MetricSummary;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(ROW_GRID, "border-t border-line py-3.5 first:border-t-0")}
    >
      <div className="flex min-w-0 flex-col gap-0.5 @lg:pb-0.5">
        <span className="silkscreen text-ink-1">{metric.label}</span>
        <span className="silkscreen text-ink-3">
          {metric.guide !== undefined ? (
            <>
              guide <Num>{formatValue(metric.guide, metric.digits)}</Num>{" "}
              {metric.unit}
            </>
          ) : (
            metric.unit
          )}
        </span>
      </div>
      <div className="col-span-2 min-w-0 @lg:col-span-1 @lg:col-start-2 @lg:row-start-1">
        {children}
      </div>
      <div className="col-start-2 row-start-1 flex flex-col items-end gap-0.5 @lg:col-start-3 @lg:pb-0.5">
        <span className="flex items-baseline gap-1 whitespace-nowrap text-ink-1">
          <span className="font-silk text-[16px] leading-5 font-semibold tabular-nums [font-stretch:90%]">
            {formatValue(summary.now, metric.digits)}
          </span>
          <span className="silkscreen text-ink-3">{metric.unit}</span>
        </span>
        <span className="silkscreen whitespace-nowrap text-ink-3">
          peak{" "}
          <Num className="text-ink-2">
            {formatValue(summary.max, metric.digits)}
          </Num>
        </span>
      </div>
    </div>
  );
}

/** Ages under the shared timeline at the oldest, middle and latest sample. */
function TimeAxis({
  samples,
  capacity,
}: {
  samples: readonly { t: number }[];
  capacity: number;
}) {
  const n = samples.length;
  const last = samples[n - 1]!;
  const marks = n >= 6 ? [0, n >> 1] : n >= 3 ? [0] : [];
  return (
    <div className={cn(ROW_GRID, "pt-1")} aria-hidden="true">
      <div className="silkscreen relative col-span-2 h-4 text-ink-3 @lg:col-span-1 @lg:col-start-2">
        {marks.map((i) => {
          const pct = slotCentrePct(capacity, n, i);
          return (
            <span
              key={i}
              className={cn(
                "absolute top-0 whitespace-nowrap",
                pct < 8 ? "translate-x-0" : "-translate-x-1/2",
              )}
              style={{ left: `${pct}%` }}
            >
              {formatAge(Math.round((samples[i]!.t - last.t) / 1000))}
            </span>
          );
        })}
        <span className="absolute top-0 right-0">now</span>
      </div>
    </div>
  );
}

export interface DitherTimelineProps<K extends string> {
  title: string;
  /** Leads the caption's right side, before "one sample every N s". */
  meta?: ReactNode;
  lanes: readonly TimelineLane<K>[];
  samples: readonly ChartSample<K>[];
  /** Slots in the window; older samples are dropped. */
  capacity?: number;
  className?: string;
}

function DitherTimelineImpl<K extends string>({
  title,
  meta,
  lanes,
  samples: all,
  capacity = 60,
  className,
}: DitherTimelineProps<K>) {
  const titleId = useId();
  const descId = useId();
  const samples = useMemo(() => all.slice(-capacity), [all, capacity]);
  const metrics = useMemo(() => lanes.map((l) => l.metric), [lanes]);
  const summaries = useMemo(
    () => metrics.map((m) => summarizeMetric(samples, m.key)),
    [metrics, samples],
  );
  const summary = useMemo(
    () => chartSummary(metrics, samples),
    [metrics, samples],
  );
  const density = lanes.find((l) => l.kind === "density");
  return (
    <figure
      aria-labelledby={titleId}
      aria-describedby={descId}
      className={cn(
        "@container min-w-0 border-t-2 border-ink-1 pt-3",
        className,
      )}
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span
          id={titleId}
          className="font-display text-[20px] leading-6 font-bold tracking-[-0.01em] text-ink-1 [font-optical-sizing:auto]"
        >
          {title}
        </span>
        <span className="silkscreen text-ink-3">
          {meta ? <>{meta} · </> : null}
          one sample every <Num>{sampleIntervalS(samples)}</Num> s
        </span>
      </figcaption>
      <p id={descId} className="sr-only">
        {summary}
      </p>
      {samples.length === 0 ? (
        <p className="py-6 text-center text-ui-xs text-ink-3">
          Collecting samples…
        </p>
      ) : (
        <>
          <div className="mt-2">
            {lanes.map((lane, i) => (
              <LaneRow
                key={lane.metric.key}
                metric={lane.metric}
                summary={summaries[i]!}
              >
                {lane.kind === "density" ? (
                  <DensityLane
                    metric={lane.metric}
                    samples={samples}
                    capacity={capacity}
                    levels={lane.levels ?? LOSS_LEVELS}
                  />
                ) : (
                  <AreaLane
                    metric={lane.metric}
                    samples={samples}
                    capacity={capacity}
                    height={lane.height ?? 48}
                    ceiling={axisCeiling(lane.metric, summaries[i]!)}
                  />
                )}
              </LaneRow>
            ))}
          </div>
          <TimeAxis samples={samples} capacity={capacity} />
          {density ? (
            <div className="silkscreen mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-3">
              <span>{density.metric.label}</span>
              {(density.levels ?? LOSS_LEVELS).map((l) => (
                <span
                  key={l.level}
                  className="inline-flex items-center gap-1.5"
                >
                  <LaneSwatch level={l.level} />
                  {l.label}
                </span>
              ))}
            </div>
          ) : null}
          <SampleTable metrics={metrics} samples={samples} className="mt-2" />
        </>
      )}
    </figure>
  );
}

/** Chart variant 2: one shared timeline, a lane per metric. */
export const DitherTimeline = memo(
  DitherTimelineImpl,
) as typeof DitherTimelineImpl;

// ── Readout row ─────────────────────────────────────────────────────────────

/**
 * The poster readouts under a 2px ink rule: per metric a silkscreen label,
 * the current value in Martian 32 with a silkscreen unit, and its peak.
 * Two up in a narrow box, four up from 36rem (a container query, so it
 * follows the column, not the viewport). Plain text, so no figure.
 */
function DitherReadoutsImpl<K extends string>({
  metrics,
  samples,
  className,
}: {
  metrics: readonly ChartMetric<K>[];
  samples: readonly ChartSample<K>[];
  className?: string;
}) {
  const summaries = useMemo(
    () => metrics.map((m) => summarizeMetric(samples, m.key)),
    [metrics, samples],
  );
  return (
    <div className={cn("@container", className)}>
      <dl className="grid grid-cols-2 gap-x-6 border-t-2 border-ink-1 @xl:grid-cols-4">
        {metrics.map((m, i) => (
          <div key={m.key} className="min-w-0 pt-4 pb-5">
            <dt className="silkscreen truncate text-ink-3">{m.label}</dt>
            <dd className="mt-2 flex items-baseline gap-1.5">
              <span className="font-silk text-[32px] leading-8 font-semibold text-ink-1 tabular-nums [font-stretch:90%]">
                {formatValue(summaries[i]!.now, m.digits)}
              </span>
              <span className="silkscreen text-ink-3">{m.unit}</span>
            </dd>
            <dd className="silkscreen mt-1 text-ink-3">
              peak <Num>{formatValue(summaries[i]!.max, m.digits)}</Num>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Poster readouts: label, Martian 32 value and peak per metric. */
export const DitherReadouts = memo(
  DitherReadoutsImpl,
) as typeof DitherReadoutsImpl;
