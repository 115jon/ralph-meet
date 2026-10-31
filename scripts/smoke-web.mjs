#!/usr/bin/env node
// Smoke test for a deployed Ralph Meet web Worker (a Preview or production).
//
//   node scripts/smoke-web.mjs <baseUrl> [--label <name>]
//
// No dependencies. Each check retries to ride out deploy propagation:
// SMOKE_ATTEMPTS (default 6) tries, SMOKE_RETRY_DELAY_MS (default 5000) apart,
// SMOKE_TIMEOUT_MS (default 15000) per request. Prints a result table and
// exits 1 if any check fails. When GITHUB_STEP_SUMMARY is set, the table is
// also appended there as Markdown.
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const labelIndex = args.indexOf("--label");
const label = labelIndex === -1 ? undefined : args[labelIndex + 1];
const positional =
  labelIndex === -1
    ? args
    : args.filter(
        (_, index) => index !== labelIndex && index !== labelIndex + 1,
      );
const rawBase = positional[0];
if (!rawBase || !/^https?:\/\//u.test(rawBase)) {
  console.error("usage: node scripts/smoke-web.mjs <baseUrl> [--label <name>]");
  process.exit(2);
}
const base = rawBase.replace(/\/+$/u, "");
const attempts = positiveInt(process.env.SMOKE_ATTEMPTS, 6);
const retryDelayMs = positiveInt(process.env.SMOKE_RETRY_DELAY_MS, 5000);
const timeoutMs = positiveInt(process.env.SMOKE_TIMEOUT_MS, 15000);

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, init = {}) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    ...init,
    headers: { "User-Agent": "ralph-meet-smoke/1", ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    body,
    ms: Math.round(performance.now() - started),
  };
}

const isHtml = (res) => /text\/html/iu.test(res.type);
const appShell = (res) =>
  isHtml(res) &&
  /<title>[^<]*Ralph Meet/iu.test(res.body) &&
  /\/assets\/[\w.-]+\.js/u.test(res.body);

let assetPath;

/**
 * Each check returns { ok, detail, ms }. `detail` explains a failure or adds
 * context to a pass.
 */
const checks = [
  {
    name: "GET /api/healthz",
    expect: "200 JSON ok:true",
    async run() {
      const res = await request("/api/healthz");
      let json;
      try {
        json = JSON.parse(res.body);
      } catch {
        json = undefined;
      }
      const ok = res.status === 200 && json?.ok === true;
      return {
        ok,
        ms: res.ms,
        detail: ok
          ? `${res.status} version ${json.version ?? "?"}`
          : `${res.status} ${res.type} ${res.body.slice(0, 80)}`,
      };
    },
  },
  {
    name: "GET /",
    expect: "200 HTML app shell",
    async run() {
      const res = await request("/", { headers: { Accept: "text/html" } });
      const ok = res.status === 200 && appShell(res);
      if (ok) {
        assetPath = /(?:src|href)="(\/assets\/[\w.-]+\.js)"/u.exec(
          res.body,
        )?.[1];
      }
      return {
        ok,
        ms: res.ms,
        detail: `${res.status} ${res.type}${ok ? "" : " (no app shell)"}`,
      };
    },
  },
  ...["/sign-in", "/activate"].map((path) => ({
    name: `GET ${path}`,
    expect: "200 HTML app shell",
    async run() {
      const res = await request(path, { headers: { Accept: "text/html" } });
      const ok = res.status === 200 && appShell(res);
      return {
        ok,
        ms: res.ms,
        detail: `${res.status} ${res.type}${ok ? "" : " (no app shell)"}`,
      };
    },
  })),
  {
    name: "GET hashed JS asset",
    expect: "200 JavaScript",
    async run() {
      if (!assetPath) {
        return { ok: false, ms: 0, detail: "no /assets/*.js found in GET /" };
      }
      const res = await request(assetPath);
      const ok =
        res.status === 200 && /javascript/iu.test(res.type) && res.body.length;
      return {
        ok: Boolean(ok),
        ms: res.ms,
        detail: `${assetPath} ${res.status} ${res.type}`,
      };
    },
  },
  {
    name: "GET /api/users/me (no auth)",
    expect: "401",
    async run() {
      const res = await request("/api/users/me", {
        headers: { Accept: "application/json" },
      });
      return { ok: res.status === 401, ms: res.ms, detail: `${res.status}` };
    },
  },
  {
    // Unauthenticated read that queries D1: a 5xx means a missing binding or
    // an unmigrated database.
    name: "GET /api/invites/<unknown>",
    expect: "404 JSON (D1 query)",
    async run() {
      const res = await request("/api/invites/smoke-nonexistent-0000", {
        headers: { Accept: "application/json" },
      });
      const ok = res.status === 404 && /json/iu.test(res.type);
      return { ok, ms: res.ms, detail: `${res.status} ${res.type}` };
    },
  },
  {
    name: "GET /api/gateway (no upgrade)",
    expect: "4xx, not 5xx",
    async run() {
      const res = await request("/api/gateway");
      return {
        ok: res.status >= 400 && res.status < 500,
        ms: res.ms,
        detail: `${res.status} ${res.body.slice(0, 60).trim()}`,
      };
    },
  },
];

const results = [];
for (const check of checks) {
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      result = await check.run();
    } catch (error) {
      result = {
        ok: false,
        ms: 0,
        detail:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      };
    }
    result.attempts = attempt;
    if (result.ok) break;
    if (attempt < attempts) await sleep(retryDelayMs);
  }
  results.push({ ...check, ...result });
}

const host = new URL(base).host;
const failed = results.filter((result) => !result.ok);
const rows = results.map((result) => [
  result.ok ? "PASS" : "FAIL",
  result.name,
  result.expect,
  result.detail.replace(/\s+/gu, " "),
  `${result.ms} ms`,
  String(result.attempts),
]);
const header = ["", "check", "expected", "got", "time", "tries"];
const widths = header.map((cell, column) =>
  Math.max(cell.length, ...rows.map((row) => row[column].length)),
);
const line = (cells) =>
  cells.map((cell, column) => cell.padEnd(widths[column])).join("  ");

console.log(`Smoke test${label ? ` (${label})` : ""}: ${host}`);
console.log(line(header));
console.log(line(widths.map((width) => "-".repeat(width))));
for (const row of rows) console.log(line(row));
console.log(
  failed.length === 0
    ? `All ${results.length} checks passed.`
    : `${failed.length} of ${results.length} checks failed.`,
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const escape = (cell) => cell.replaceAll("|", "\\|");
  const markdown = [
    `### Smoke test${label ? `: ${label}` : ""} (${host})`,
    "",
    `| ${header.map(escape).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
    "",
  ].join("\n");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

process.exit(failed.length === 0 ? 0 : 1);
