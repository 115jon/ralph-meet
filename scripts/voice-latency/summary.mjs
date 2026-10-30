// Percentiles and the stdout table for bench.mjs. Pure, no I/O.

/** Join stages in waterfall order (ms after the Join click). */
export const STAGES = [
  "ticket",
  "roomSocket",
  "mediaReady",
  "roomReady",
  "voiceSocket",
  "voiceReady",
  "sfuSession",
  "iceConnected",
  "pcConnected",
  "getUserMedia",
  "pushOffer",
  "trackAnnounced",
  "uiJoined",
  "uiConnected",
  "outboundRtp",
  "peerFirstPacket",
  "peerHears",
  "selfHears",
];

/** Nearest-rank percentile of a numeric list (null when empty). */
export function percentile(values, p) {
  const sorted = values
    .filter((v) => typeof v === "number")
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Groups runs by scenario/profile and reduces each numeric stage to p50/p95. */
export function summarize(results) {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.scenario}/${result.profile}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result.stages);
  }
  const summary = {};
  for (const [key, runs] of groups) {
    const stageNames = [
      ...new Set(runs.flatMap((run) => Object.keys(run))),
    ].filter((name) => runs.some((run) => typeof run[name] === "number"));
    const order = (name) => {
      const index = STAGES.indexOf(name);
      return index === -1 ? STAGES.length : index;
    };
    stageNames.sort((a, b) => order(a) - order(b));
    summary[key] = {
      runs: runs.length,
      timedOut: runs.filter((run) => run.timedOut).length,
      stages: Object.fromEntries(
        stageNames.map((name) => {
          const values = runs.map((run) => run[name]);
          return [
            name,
            {
              p50: percentile(values, 50),
              p95: percentile(values, 95),
              n: values.filter((v) => typeof v === "number").length,
            },
          ];
        }),
      ),
    };
  }
  return summary;
}

export function formatTable(summary) {
  const lines = [];
  for (const [key, group] of Object.entries(summary)) {
    lines.push("");
    lines.push(
      `${key}  (${group.runs} runs${group.timedOut ? `, ${group.timedOut} timed out` : ""})`,
    );
    lines.push(
      `  ${"stage".padEnd(24)}${"p50".padStart(8)}${"p95".padStart(8)}${"n".padStart(5)}`,
    );
    for (const [name, stat] of Object.entries(group.stages)) {
      const fmt = (v) => (v == null ? "-" : String(v));
      lines.push(
        `  ${name.padEnd(24)}${fmt(stat.p50).padStart(8)}${fmt(stat.p95).padStart(8)}${String(stat.n).padStart(5)}`,
      );
    }
  }
  return lines.join("\n");
}
