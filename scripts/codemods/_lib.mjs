/**
 * Shared plumbing for the design-system codemods.
 *
 * Every codemod: walks src/**\/*.tsx, skips the user's WIP files and tests,
 * applies `transform(text, file)` line by line, prints a per-rule summary,
 * writes only without --dry. Re-runnable: a second run changes nothing.
 *
 *   node scripts/codemods/<name>.mjs [--dry] [--verbose]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

/** The user's in-progress files (design-audit.md section 6). Never edited here. */
export const WIP = [
  /^src\/components\/chat\/UserPanel\.tsx$/,
  /^src\/components\/chat\/ChatPageClient\.tsx$/,
  /^src\/components\/chat\/useChatPageLogic\.ts$/,
  /^src\/components\/chat\/DMCallRegion\.tsx$/,
  /^src\/hooks\/useVoiceChannel\.ts$/,
  /^src\/lib\/voice\//,
  /^realtime\//,
  /^src\/components\/chat\/SharedMessagePage\.tsx$/,
];

/** Auth layout waits on a product decision; codemods that touch layout skip it. */
export const AUTH_LAYOUT = [
  /^src\/components\/auth\/AuthSplitLayout\.tsx$/,
  /^src\/components\/auth\/auth-card-appearance\.ts$/,
];

export const args = process.argv.slice(2);
export const DRY = args.includes("--dry");
export const VERBOSE = args.includes("--verbose");

export function* walk(dir, exts = /\.tsx$/) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__" || name === ".git")
        continue;
      yield* walk(p, exts);
    } else if (
      exts.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !/\.d\.ts$/.test(name) &&
      !/\.generated\./.test(name)
    ) {
      yield p;
    }
  }
}

export const rel = (file) => relative(ROOT, file).split(sep).join("/");

/**
 * Run `lineFn(line, ctx)` over every line of every non-WIP source file.
 * `lineFn` returns the new line; it may call `ctx.hit(rule)` to count a
 * change and `ctx.skip(rule, note)` to record something it left alone.
 */
export function run(name, lineFn, { extraSkip = [], exts } = {}) {
  const counts = {};
  const skipped = [];
  const touched = new Set();
  for (const file of walk(resolve(ROOT, "src"), exts)) {
    const r = rel(file);
    if ([...WIP, ...extraSkip].some((re) => re.test(r))) continue;
    const text = readFileSync(file, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    let changed = false;
    const out = lines.map((line, i) => {
      const ctx = {
        file: r,
        lineNo: i + 1,
        lines,
        hit: (rule, n = 1) => {
          counts[rule] = (counts[rule] ?? 0) + n;
        },
        skip: (rule, note) => skipped.push(`${r}:${i + 1} [${rule}] ${note}`),
      };
      const next = lineFn(line, ctx);
      if (next !== line) changed = true;
      return next;
    });
    if (changed) {
      touched.add(r);
      if (!DRY) writeFileSync(file, out.join(eol));
    }
  }
  console.log(`${name}${DRY ? " (dry run)" : ""}: ${touched.size} files`);
  for (const [k, v] of Object.entries(counts).sort())
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  if (skipped.length) {
    console.log(`  left alone (${skipped.length}):`);
    for (const s of skipped) console.log(`    ${s}`);
  }
  return { counts, skipped, touched };
}
