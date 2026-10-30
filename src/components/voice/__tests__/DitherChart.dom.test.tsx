// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DitherSmallMultiples, DitherTimeline } from "../DitherChart";
import {
  CONNECTION_METRICS,
  axisCeiling,
  chartSummary,
  formatAge,
  niceCeil,
  pickPeaks,
  sampleIntervalS,
  summarizeMetric,
  type ChartSample,
  type ConnectionMetricKey,
} from "../dither-chart-model";

const SAMPLES: ChartSample<ConnectionMetricKey>[] = [
  { t: 0, bitrate: 60, loss: 0, jitter: 5, rtt: 40 },
  { t: 2000, bitrate: 30, loss: 3.4, jitter: 22, rtt: 160 },
  { t: 4000, bitrate: 58, loss: 0.2, jitter: 6, rtt: 44 },
];

describe("dither chart model", () => {
  it("summarises a metric with the peak's age", () => {
    expect(summarizeMetric(SAMPLES, "rtt")).toEqual({
      now: 44,
      min: 40,
      max: 160,
      avg: 81.33333333333333,
      peakAt: -2,
    });
  });

  it("rounds axis ceilings up to nice steps above the metric floor", () => {
    expect(niceCeil(0.3)).toBeCloseTo(0.5);
    expect(niceCeil(176)).toBe(200);
    expect(niceCeil(2_100)).toBe(2_500);
    const rtt = CONNECTION_METRICS.find((m) => m.key === "rtt")!;
    expect(axisCeiling(rtt, summarizeMetric(SAMPLES, "rtt"))).toBe(200);
    expect(
      axisCeiling(rtt, { ...summarizeMetric(SAMPLES, "rtt"), max: 400 }),
    ).toBe(500);
  });

  it("reads the cadence and writes a summary for screen readers", () => {
    expect(sampleIntervalS(SAMPLES)).toBe(2);
    expect(formatAge(0)).toBe("now");
    expect(formatAge(-34)).toBe("−34 s");
    const text = chartSummary(CONNECTION_METRICS, SAMPLES);
    expect(text).toContain("Last 6 seconds, one sample every 2 seconds.");
    expect(text).toContain(
      "Round trip now 44 ms, average 81, peak 160 2 seconds ago",
    );
    expect(text).toContain("Packet loss now 0.2 %");
  });

  it("labels at most three spaced peaks above the floor", () => {
    const loss = [0, 2, 0, 0, 0, 0, 4, 0, 1.5, 0, 0, 0, 0, 3, 0].map(
      (v, i) => ({ t: i * 2000, loss: v }),
    );
    expect(pickPeaks(loss, "loss", 1, 32)).toEqual([
      { v: 4, i: 6 },
      { v: 3, i: 13 },
      { v: 2, i: 1 },
    ]);
  });
});

describe("DitherSmallMultiples / DitherTimeline", () => {
  beforeEach(() => {
    // jsdom has no layout: give chart hosts a width so the SVG draws.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 240,
      height: 64,
    } as DOMRect);
  });
  afterEach(() => vi.restoreAllMocks());

  it("is a titled figure with a summary, text values and hidden marks", () => {
    render(
      <DitherSmallMultiples
        title="Connection"
        status={{ led: "talk", label: "Stable" }}
        metrics={CONNECTION_METRICS}
        samples={SAMPLES}
        capacity={24}
        compact
      />,
    );
    const figure = screen.getByRole("figure", { name: "Connection" });
    expect(figure).toHaveAccessibleDescription(/Last 6 seconds/);
    expect(within(figure).getByText("Stable", { exact: false })).toBeVisible();
    // Current values and the guide are text, not just bar heights.
    expect(within(figure).getByText("44")).toBeInTheDocument();
    expect(within(figure).getByText("150")).toBeInTheDocument();
    const svgs = figure.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(4);
    svgs.forEach((svg) => expect(svg).toHaveAttribute("aria-hidden", "true"));
  });

  it("renders the sample table only once the disclosure opens", () => {
    render(
      <DitherSmallMultiples
        title="Connection"
        metrics={CONNECTION_METRICS}
        samples={SAMPLES}
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const details = screen.getByText("Samples as a table").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const table = screen.getByRole("table", {
      name: "Connection samples, oldest first",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(SAMPLES.length + 1);
    expect(within(table).getByRole("rowheader", { name: "now" })).toBeVisible();
  });

  it("draws lanes and a labelled loss legend on the timeline", () => {
    const [bitrate, loss] = CONNECTION_METRICS;
    render(
      <DitherTimeline
        title="Audio uplink"
        meta="opus"
        lanes={[{ metric: bitrate! }, { metric: loss!, kind: "density" }]}
        samples={SAMPLES}
      />,
    );
    const figure = screen.getByRole("figure", { name: "Audio uplink" });
    expect(within(figure).getByText("3% and up")).toBeInTheDocument();
    expect(within(figure).getByText("under 1%")).toBeInTheDocument();
    // The loss peak is labelled in text above the strip.
    expect(within(figure).getByText("3.4%")).toBeInTheDocument();
  });

  it("says it is collecting before the first sample", () => {
    render(
      <DitherTimeline
        title="Audio uplink"
        lanes={[{ metric: CONNECTION_METRICS[0]! }]}
        samples={[]}
      />,
    );
    expect(screen.getByText("Collecting samples…")).toBeInTheDocument();
  });
});
