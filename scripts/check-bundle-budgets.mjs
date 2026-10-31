#!/usr/bin/env node
/**
 * Bundle budgets for the client build (`pnpm run perf:budgets`).
 *
 * Gzips the chunks that decide how much a visitor downloads before the first
 * paint and fails when one grows past its budget. Cloudflare serves brotli,
 * a little smaller than the gzip measured here, so the budgets leave room.
 * Budgets sit just above what the build measures today; a change that grows
 * one says why in its commit and raises the number here and in
 * docs/performance.md.
 *
 *   node scripts/check-bundle-budgets.mjs            check ./dist/client
 *   node scripts/check-bundle-budgets.mjs --report   print sizes, never fail
 *   node scripts/check-bundle-budgets.mjs --dist <dir>
 *
 * What it measures:
 *   entry     main-*.js, the chunks it imports (statically or with import()),
 *             and so everything every page downloads before React runs
 *   css       the stylesheet; render-blocking, so it gates the first paint
 *   groups    the chunk list the build writes to prefetch-manifest.json for
 *             each place a visitor can go next (entry included)
 *   chunks    single chunks found by file-name prefix
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const KB = 1024;

/** Gzip KB, each just above what the build measures. */
const BUDGETS = {
  // main + the shared client chunk + React DOM (55)
  entry: 225,
  css: 42,
  groups: {
    "sign-in": 170,
    room: 170,
    "room-voice": 535,
    chat: 690,
  },
  chunks: {
    "RoomVoiceView-": 7,
    "chat-store-": 26,
    "toast-": 12,
    "ChatPageClient-": 142,
    "InlineEmojiText-": 86,
    "voice-standby-": 77,
    "GifProviderBranding-": 96,
    "LinkEmbed-": 47,
    "WarpRushActivityStage-": 145,
  },
};

const args = process.argv.slice(2);
const report = args.includes("--report");
const distArg = args.indexOf("--dist");
const dist = resolve(distArg >= 0 ? args[distArg + 1] : "dist/client");
const assetsDir = join(dist, "assets");

if (!existsSync(assetsDir)) {
  console.error(`No build at ${assetsDir}. Run \`pnpm run build\` first.`);
  process.exit(2);
}

const files = readdirSync(assetsDir);
const sizeCache = new Map();
function gzipKB(file) {
  if (!sizeCache.has(file)) {
    const bytes = readFileSync(join(assetsDir, file));
    sizeCache.set(file, gzipSync(bytes, { level: 9 }).length / KB);
  }
  return sizeCache.get(file);
}
const sumKB = (list) => list.reduce((sum, file) => sum + gzipKB(file), 0);

/** Static imports of a chunk: `from"./x.js"` and a bare `import"./x.js"`. */
function staticImportsOf(file) {
  const text = readFileSync(join(assetsDir, file), "utf8");
  const found = new Set();
  for (const match of text.matchAll(
    /(?:from|import)\s*["']\.\/([^"']+\.js)["']/g,
  )) {
    found.add(match[1]);
  }
  return [...found];
}

/** Chunks a file loads with import("./x.js"). */
function dynamicImportsOf(file) {
  const text = readFileSync(join(assetsDir, file), "utf8");
  const found = new Set();
  for (const match of text.matchAll(
    /import\(\s*["']\.\/([^"']+\.js)["']\s*\)/g,
  )) {
    found.add(match[1]);
  }
  return [...found];
}

/** A chunk and everything it imports statically. */
function staticClosure(roots) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !files.includes(file)) return;
    seen.add(file);
    for (const next of staticImportsOf(file)) visit(next);
  };
  for (const root of roots) visit(root);
  return [...seen];
}

const rows = [];
const add = (name, actual, budget) => rows.push({ name, actual, budget });

// Entry: main-*.js and everything it pulls in.
const main = files.find((f) => /^main-.*\.js$/.test(f));
if (main) {
  // main imports the router and React DOM with import() right away, so those
  // count as entry too; the lazy route chunks they list do not.
  const entry = staticClosure([main, ...dynamicImportsOf(main)]);
  add("entry (main + imports)", sumKB(entry), BUDGETS.entry);
} else {
  rows.push({ name: "entry (main + imports)", missing: true });
}

// CSS.
const css = files.filter((f) => f.endsWith(".css"));
add("css", sumKB(css), BUDGETS.css);

// Prefetch groups (each includes the entry chunks).
const manifestPath = join(dist, "prefetch-manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const [group, budget] of Object.entries(BUDGETS.groups)) {
    const chunks = (manifest[group] ?? []).map((url) =>
      url.replace(/^\/assets\//, ""),
    );
    if (chunks.length === 0)
      rows.push({ name: `group ${group}`, missing: true });
    else add(`group ${group}`, sumKB(chunks), budget);
  }
} else {
  for (const group of Object.keys(BUDGETS.groups)) {
    rows.push({ name: `group ${group}`, missing: true });
  }
}

// Single chunks by prefix.
for (const [prefix, budget] of Object.entries(BUDGETS.chunks)) {
  const matches = files.filter(
    (f) => f.startsWith(prefix) && f.endsWith(".js"),
  );
  if (matches.length === 0) rows.push({ name: prefix, missing: true });
  else add(`${prefix}*.js`, sumKB(matches), budget);
}

const width = Math.max(...rows.map((r) => r.name.length));
let failed = 0;
console.log(`Bundle budgets (gzip KB) for ${dist}\n`);
for (const row of rows) {
  if (row.missing) {
    console.log(`${row.name.padEnd(width)}  not found`);
    failed++;
    continue;
  }
  const over = row.actual > row.budget;
  if (over) failed++;
  console.log(
    `${row.name.padEnd(width)}  ${row.actual.toFixed(1).padStart(7)} / ${String(
      row.budget,
    ).padStart(4)}  ${over ? "OVER" : "ok"}`,
  );
}

if (failed > 0 && !report) {
  console.error(
    `\n${failed} budget${failed === 1 ? "" : "s"} failed. Raise the number in scripts/check-bundle-budgets.mjs only with a reason in the commit.`,
  );
  process.exit(1);
}
