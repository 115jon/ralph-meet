/**
 * Data model for the dithered stat charts (`DitherChart.tsx`): metric and
 * sample shapes, per-metric summaries, axis ceilings and the text a figure
 * reads out. Pure, so it is unit-tested apart from the SVG.
 */

export interface ChartMetric<K extends string = string> {
  key: K;
  label: string;
  unit: string;
  /** The smallest axis ceiling; the axis grows past it to fit the data. */
  max: number;
  /** A reference level, drawn as a dashed line and labelled in text. */
  guide?: number;
  digits?: number;
}

/** One sample: epoch ms plus a value per metric key. */
export type ChartSample<K extends string = string> = { t: number } & Record<
  K,
  number
>;

export interface MetricSummary {
  now: number;
  min: number;
  max: number;
  avg: number;
  /** Seconds before the latest sample at which the max was seen (≤ 0). */
  peakAt: number;
}

export function summarizeMetric<K extends string>(
  samples: readonly ChartSample<K>[],
  key: K,
): MetricSummary {
  if (samples.length === 0) {
    return { now: 0, min: 0, max: 0, avg: 0, peakAt: 0 };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let peak = 0;
  samples.forEach((s, i) => {
    const v = s[key];
    sum += v;
    if (v < min) min = v;
    if (v > max) {
      max = v;
      peak = i;
    }
  });
  const last = samples[samples.length - 1]!;
  return {
    now: last[key],
    min,
    max,
    avg: sum / samples.length,
    peakAt: Math.round((samples[peak]!.t - last.t) / 1000),
  };
}

/** The next 1 / 2 / 2.5 / 5 × 10ⁿ at or above `v`. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5]) {
    if (m * step >= v - 1e-9) return m * step;
  }
  return 10 * step;
}

/** Axis ceiling: the metric's floor, or the data's max with headroom. */
export function axisCeiling(
  metric: ChartMetric,
  summary: MetricSummary,
): number {
  return Math.max(metric.max, niceCeil(summary.max * 1.1));
}

/** Typical gap between samples in whole seconds (the median; 2 s default). */
export function sampleIntervalS(samples: readonly { t: number }[]): number {
  if (samples.length < 2) return 2;
  const gaps = samples
    .slice(1)
    .map((s, i) => s.t - samples[i]!.t)
    .sort((a, b) => a - b);
  return Math.max(1, Math.round(gaps[gaps.length >> 1]! / 1000));
}

/** Seconds the samples span, counting the latest one's interval. */
export function windowS(samples: readonly { t: number }[]): number {
  if (samples.length === 0) return 0;
  const span = (samples[samples.length - 1]!.t - samples[0]!.t) / 1000;
  return Math.round(span + sampleIntervalS(samples));
}

export function formatValue(value: number, digits = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** "now", or "−34 s" for a sample 34 s before the latest. */
export function formatAge(seconds: number): string {
  return seconds >= 0 ? "now" : `−${Math.abs(seconds)} s`;
}

/** The screen-reader summary: span, cadence, then each metric. */
export function chartSummary<K extends string>(
  metrics: readonly ChartMetric<K>[],
  samples: readonly ChartSample<K>[],
): string {
  if (samples.length === 0) return "No samples yet.";
  const parts = metrics.map((m) => {
    const s = summarizeMetric(samples, m.key);
    const peak = s.peakAt === 0 ? "now" : `${Math.abs(s.peakAt)} seconds ago`;
    return `${m.label} now ${formatValue(s.now, m.digits)} ${m.unit}, average ${formatValue(s.avg, m.digits)}, peak ${formatValue(s.max, m.digits)} ${peak}`;
  });
  return `Last ${windowS(samples)} seconds, one sample every ${sampleIntervalS(samples)} seconds. ${parts.join(". ")}.`;
}

// ── Density buckets ─────────────────────────────────────────────────────────

export interface DensityLevel {
  /** Upper bound (exclusive) of the bucket, in the metric's unit. */
  below: number;
  /** Lit cells of 16. */
  level: number;
  label: string;
}

/** Loss buckets for the density strip; each also has a text label. */
export const LOSS_LEVELS: readonly DensityLevel[] = [
  { below: 0.05, level: 0, label: "none" },
  { below: 1, level: 4, label: "under 1%" },
  { below: 3, level: 8, label: "1–3%" },
  { below: Infinity, level: 16, label: "3% and up" },
];

export const levelOf = (
  levels: readonly DensityLevel[],
  v: number,
): DensityLevel =>
  levels.find((l) => v < l.below) ?? levels[levels.length - 1]!;

/** Up to three highest local peaks at or above `floor`, spaced apart. */
export function pickPeaks<K extends string>(
  samples: readonly ChartSample<K>[],
  key: K,
  floor: number,
  capacity: number,
): { v: number; i: number }[] {
  const spacing = Math.max(4, Math.round(capacity / 8));
  const candidates = samples
    .map((s, i) => ({ v: s[key], i }))
    .filter(
      ({ v, i }) =>
        v >= floor &&
        v >= (samples[i - 1]?.[key] ?? 0) &&
        v > (samples[i + 1]?.[key] ?? 0),
    )
    .sort((a, b) => b.v - a.v);
  const chosen: { v: number; i: number }[] = [];
  for (const c of candidates) {
    if (chosen.length === 3) break;
    if (chosen.every((p) => Math.abs(p.i - c.i) >= spacing)) chosen.push(c);
  }
  return chosen;
}

// ── Connection metrics ──────────────────────────────────────────────────────

export type ConnectionMetricKey = "bitrate" | "loss" | "jitter" | "rtt";

/**
 * The uplink metrics with floors and guides. Guides follow the quality
 * glyph's warn thresholds (`classifyVoiceQuality`: 2% loss, 150 ms).
 */
export const CONNECTION_METRICS: readonly ChartMetric<ConnectionMetricKey>[] = [
  { key: "bitrate", label: "Bitrate", unit: "kbps", max: 80 },
  {
    key: "loss",
    label: "Packet loss",
    unit: "%",
    max: 4,
    guide: 2,
    digits: 1,
  },
  { key: "jitter", label: "Jitter", unit: "ms", max: 40, guide: 30 },
  { key: "rtt", label: "Round trip", unit: "ms", max: 200, guide: 150 },
];
