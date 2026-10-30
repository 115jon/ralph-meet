#!/usr/bin/env node
/**
 * Static design-system checker for Ralph Meet (docs/design-system.md).
 *
 *   node scripts/audit-design-system.mjs            # per-file counts + totals
 *   node scripts/audit-design-system.mjs --list     # every finding with file:line
 *   node scripts/audit-design-system.mjs --rule=bare-hover --list
 *   node scripts/audit-design-system.mjs --json     # machine-readable
 *   node scripts/audit-design-system.mjs --top=40   # rows in the per-file table
 *   node scripts/audit-design-system.mjs src/components/chat   # narrow the scan
 *
 * No dependencies. Scans src/**\/*.tsx (plus *.ts for the JS-only rules), skips
 * tests. Exceptions live in scripts/audit-design-system.allow.json, or inline:
 * put `ds-allow:<rule>` (or `ds-allow:*`) in a comment on the same line.
 *
 * Exit code is always 0: this is a report, not a gate (yet).
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const scanDirs = args.filter((a) => !a.startsWith("--"));
const ONLY_RULE = opt("rule", null);
const TOP = Number(opt("top", 30));
const LIST = flag("list");
const JSON_OUT = flag("json");

/* ------------------------------------------------------------------ */
/* Scales (mirror docs/design-system.md)                                */
/* ------------------------------------------------------------------ */

/** Allowed z-index layers. Anything else is off the ladder. */
const Z_LAYERS = new Set([0, 10, 20, 30, 50, 60, 70, 80, 100]);

/** Tailwind default text sizes that bypass the `text-ui-*` scale. */
const TW_TEXT = "(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)";

/** Tailwind palette hues: never used directly; colour comes from rm tokens. */
const PALETTE =
  "(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)";

/** Spacing / sizing utility prefixes that take a length. */
const SPACE_PREFIX =
  "(?:-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left|start|end|w|h|size|min-w|min-h|max-w|max-h|basis|translate-x|translate-y|scroll-m[xy]?|scroll-p[xy]?))";

/* ------------------------------------------------------------------ */
/* Rules                                                                */
/* ------------------------------------------------------------------ */

/**
 * Each rule: id, severity (high|medium|low), what it means, which files it
 * applies to, and a `find(line)` returning matched snippets (strings).
 */
const RULES = [
  {
    id: "off-grid-spacing",
    severity: "medium",
    rule: "Spacing 2.1: arbitrary px lengths must sit on the 4px grid (1px/2px hairlines excepted). Use a scale step.",
    ext: ["tsx"],
    find: (line) =>
      matchAll(
        line,
        new RegExp(
          `(?<![\\w-])${SPACE_PREFIX}-\\[(\\d+(?:\\.\\d+)?)px\\]`,
          "g",
        ),
        (m) => {
          const n = Number(m[1]);
          return n % 4 !== 0 && n !== 1 && n !== 2 ? m[0] : null;
        },
      ),
  },
  {
    id: "arbitrary-text-size",
    severity: "high",
    rule: "Type 4.1: font sizes come from the text-ui-* scale, never text-[Npx] or text-[Nrem].",
    ext: ["tsx"],
    find: (line) =>
      matchAll(line, /(?<![\w-])text-\[(\d+(?:\.\d+)?)(px|rem)\]/g),
  },
  {
    id: "tailwind-text-size",
    severity: "medium",
    rule: "Type 4.1: Tailwind's text-xs/sm/base/lg/xl (12/14/16/18/20) are off the 11/12/13/15/16/18/22/28 ui scale. Use text-ui-*.",
    ext: ["tsx"],
    find: (line) =>
      matchAll(line, new RegExp(`(?<![\\w:/-])text-${TW_TEXT}(?![\\w-])`, "g")),
  },
  {
    id: "arbitrary-radius",
    severity: "medium",
    rule: "Radius 5.1: use rounded-xs/sm/md/lg/xl/2xl (4/6/8/12/16/20) or rounded-full; no rounded-[Npx].",
    ext: ["tsx"],
    find: (line) =>
      matchAll(
        line,
        /(?<![\w-])rounded(?:-[trbles]{1,2})?-\[([^\]]+)\]/g,
        (m) => (m[1] === "inherit" ? null : m[0]),
      ),
  },
  {
    id: "raw-color",
    severity: "high",
    rule: "Colour 7.1: no hex / rgb() / oklch() literals in components; use a semantic token (bg-ply-*, text-ink-*, line, accent-*, status roles); add one if the role is missing.",
    ext: ["tsx"],
    find: (line) => {
      if (!/className|style=|cn\(|clsx\(|`/.test(line)) return [];
      return matchAll(
        line,
        /(?<![\w&])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])|(?<![\w-])(?:rgba?|oklch|oklab|hsla?)\((?!var)[^)]*\)/g,
        (m) => (/^#(fff|000)$/i.test(m[0]) ? null : m[0]),
      );
    },
  },
  {
    id: "palette-color",
    severity: "medium",
    rule: "Colour 7.1: Tailwind palette hues (bg-red-500, text-zinc-400, …) bypass the theme. Use semantic tokens (ply, ink, tint, line, accent, status).",
    ext: ["tsx"],
    find: (line) =>
      matchAll(
        line,
        new RegExp(
          `(?<![\\w-])(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|decoration|shadow|accent|caret|placeholder)-${PALETTE}-\\d{2,3}(?:/\\d{1,3})?(?![\\w-])`,
          "g",
        ),
      ),
  },
  {
    id: "transition-all",
    severity: "high",
    rule: "Motion 10.2: never transition-all; use transition-ui, transition-colors, transition-opacity or transition-transform.",
    ext: ["tsx"],
    find: (line) =>
      matchAll(
        line,
        /(?<![\w-])transition-all(?![\w-])|transition:\s*["']?all\b/g,
      ),
  },
  {
    id: "slow-motion",
    severity: "medium",
    rule: "Motion 10.1: UI motion is <= 300ms (duration-150/200/240/300). Longer durations are for loaders only.",
    ext: ["tsx"],
    find: (line) =>
      matchAll(
        line,
        /(?<![\w-])(?:duration|delay)-(?:\[(\d+)ms\]|(\d+))(?![\w-])/g,
        (m) => {
          const n = Number(m[1] ?? m[2]);
          return n > 300 ? m[0] : null;
        },
      ),
  },
  {
    id: "ease-in",
    severity: "low",
    rule: "Motion 10.1: ease-in makes UI feel late; enters/exits use ease-out (default) or ease-drawer.",
    ext: ["tsx"],
    find: (line) => matchAll(line, /(?<![\w-])ease-in(?![\w-])/g),
  },
  {
    id: "bare-hover",
    severity: "medium",
    rule: "Interaction 9.3: hover styling is gated to fine pointers: pointer-fine:hover:, pointer-fine:group-hover:.",
    ext: ["tsx"],
    find: (line) =>
      matchAll(
        line,
        /(?<![\w-])((?:group|peer)-hover|hover)(?:\/[\w-]+)?:(?=[\w[!-])/g,
        (m) => {
          const before = line.slice(Math.max(0, m.index - 40), m.index);
          // Gated forms: the pointer-fine: variant, or the raw media variant
          // `[@media(hover:hover)_and_(pointer:fine)]:hover:` (whose inner
          // `(hover:` is part of the query, not a variant).
          if (before.endsWith("pointer-fine:")) return null;
          if (before.endsWith("(pointer:fine)]:")) return null;
          if (before.endsWith("[@media(") || before.endsWith("_and_("))
            return null;
          return m[0];
        },
      ),
  },
  {
    id: "lucide-import",
    severity: "high",
    rule: "Icons 8.1: icons go through <Icon name> (Phosphor); no lucide-react imports.",
    ext: ["tsx", "ts"],
    find: (line) => matchAll(line, /from\s+["']lucide-react["']/g),
  },
  {
    id: "vh-height",
    severity: "high",
    rule: "Layout 3.4: heights follow the dynamic viewport (dvh / h-dvh); vh and h-screen/min-h-screen hide under phone toolbars and keyboards; w-screen includes the scrollbar.",
    ext: ["tsx"],
    find: (line) =>
      matchAll(
        line,
        /(?<![\w-])(?:(?:h|min-h|max-h|w)-screen|(?:h|min-h|max-h|top|bottom|inset|inset-y|translate-y)-\[[^\]]*\d(?<![ds])vh[^\]]*\]|(?<![\w.(-])\d+(?<![ds])vh\b)(?![\w-])/g,
      ),
  },
  {
    id: "z-index",
    severity: "medium",
    rule: "Layers 11.1: z-index is one of 0/10/20/30/50/60/70/80/100; no z-[…] and no in-between values.",
    ext: ["tsx"],
    find: (line) =>
      matchAll(line, /(?<![\w-])-?z-(?:\[([^\]]+)\]|(\d+))(?![\w-])/g, (m) => {
        if (m[1] !== undefined) return m[0];
        return Z_LAYERS.has(Number(m[2])) ? null : m[0];
      }),
  },
  {
    id: "off-breakpoint",
    severity: "low",
    rule: "Layout 3.1: only md (768) and lg (1024) exist; sm:/xl:/2xl:/max-sm: variants split phones or add a third layout.",
    ext: ["tsx"],
    find: (line) =>
      matchAll(line, /(?<![\w@:-])(?:max-)?(?:sm|xl|2xl):(?=[\w[!-])/g),
  },
  {
    id: "innerwidth-breakpoint",
    severity: "high",
    rule: "Layout 3.2: breakpoint logic uses useIsMobile()/isMobileViewport() (768), not window.innerWidth comparisons.",
    ext: ["tsx", "ts"],
    find: (line) =>
      matchAll(
        line,
        /window\.innerWidth\s*(?:<=?|>=?)\s*\d+|\d+\s*(?:<=?|>=?)\s*window\.innerWidth|innerWidth\s*<\s*(?:640|768|1024)/g,
      ),
  },
  {
    id: "arbitrary-shadow",
    severity: "low",
    rule: "Elevation 6.1: shadows are the named elevation tokens (shadow-float, shadow-sm/lg/2xl); no hand-rolled shadow-[…] except token-coloured rings (0_0_0_Npx_var(--…)) and inset hairlines (inset_0_±Npx_0_var(--…)).",
    ext: ["tsx"],
    find: (line) =>
      matchAll(line, /(?<![\w-])shadow-\[([^\]]+)\]/g, (m) =>
        // Legacy elevation token, a ring in a token colour, or an inset
        // hairline in a token colour. No literal colours: raw-color covers those.
        /var\(--rm-shadow-[123]\)/.test(m[1]) ||
        /^0_0_0_\d+px_var\(--[\w-]+\)$/.test(m[1]) ||
        /^inset_0_-?\d+px_0_var\(--[\w-]+\)$/.test(m[1])
          ? null
          : m[0],
      ),
  },
  {
    id: "dead-blur",
    severity: "low",
    rule: "Elevation 6.3: styles.css neutralises backdrop-blur/blur globally; these classes are dead and should be removed.",
    ext: ["tsx"],
    find: (line) =>
      matchAll(line, /(?<![\w-])backdrop-blur(?:-[\w[\]]+)?(?![\w-])/g),
  },
  {
    id: "hard-press-scale",
    severity: "low",
    rule: "Interaction 9.2: press feedback is PRESS (scale 0.97); no active:scale-95/90 or whileTap below 0.96.",
    ext: ["tsx"],
    find: (line) =>
      matchAll(
        line,
        /(?<![\w-])active:scale-(\d+)(?![\w-])|whileTap=\{\{\s*scale:\s*(0\.\d+)/g,
        (m) => {
          if (m[1] !== undefined) return Number(m[1]) < 96 ? m[0] : null;
          return Number(m[2]) < 0.96 ? m[0] : null;
        },
      ),
  },
];

function matchAll(line, re, pick = (m) => m[0]) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(line))) {
    const v = pick(m);
    if (v) out.push(v);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Allowlist                                                            */
/* ------------------------------------------------------------------ */

const allowPath = join(ROOT, "scripts", "audit-design-system.allow.json");
const allow = existsSync(allowPath)
  ? JSON.parse(readFileSync(allowPath, "utf8"))
  : { entries: [] };

function globToRegExp(glob) {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");
  return new RegExp(`^${esc}$`);
}
const allowEntries = (allow.entries ?? []).map((e) => ({
  ...e,
  re: globToRegExp(e.file),
  match: e.match ? new RegExp(e.match) : null,
}));

function isAllowed(file, ruleId, snippet, lineText) {
  const inline = lineText.match(/ds-allow:([\w*,-]+)/);
  if (inline) {
    const ids = inline[1].split(",");
    if (ids.includes("*") || ids.includes(ruleId)) return true;
  }
  return allowEntries.some(
    (e) =>
      e.re.test(file) &&
      (e.rule === "*" || e.rule === ruleId) &&
      (!e.match || e.match.test(snippet) || e.match.test(lineText)),
  );
}

/* ------------------------------------------------------------------ */
/* Scan                                                                 */
/* ------------------------------------------------------------------ */

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__" || name === ".git")
        continue;
      yield* walk(p);
    } else if (
      /\.(tsx|ts)$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !/\.d\.ts$/.test(name)
    ) {
      yield p;
    }
  }
}

const roots = (scanDirs.length ? scanDirs : ["src"]).map((d) =>
  resolve(ROOT, d),
);
const findings = [];
const allowed = { count: 0 };
let fileCount = 0;

for (const root of roots) {
  for (const file of walk(root)) {
    fileCount++;
    const rel = relative(ROOT, file).split(sep).join("/");
    const ext = file.endsWith(".tsx") ? "tsx" : "ts";
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (const rule of RULES) {
      if (ONLY_RULE && rule.id !== ONLY_RULE) continue;
      if (!rule.ext.includes(ext)) continue;
      lines.forEach((text, i) => {
        for (const snippet of rule.find(text)) {
          if (isAllowed(rel, rule.id, snippet, text)) {
            allowed.count++;
            continue;
          }
          findings.push({
            file: rel,
            line: i + 1,
            rule: rule.id,
            severity: rule.severity,
            snippet,
          });
        }
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Report                                                               */
/* ------------------------------------------------------------------ */

const byFile = new Map();
const byRule = new Map(RULES.map((r) => [r.id, 0]));
for (const f of findings) {
  byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
  byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
}
const files = [...byFile.entries()].sort(
  (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        scannedFiles: fileCount,
        total: findings.length,
        allowed: allowed.count,
        byRule: Object.fromEntries(byRule),
        byFile: Object.fromEntries(files),
        findings: LIST ? findings : undefined,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log(
  `design-system audit  (${fileCount} files, ${findings.length} findings, ${allowed.count} allowlisted)\n`,
);

console.log("By rule");
for (const rule of RULES) {
  if (ONLY_RULE && rule.id !== ONLY_RULE) continue;
  console.log(
    `  ${rpad(byRule.get(rule.id) ?? 0, 5)}  ${pad(rule.id, 24)} ${rule.severity.padEnd(6)}  ${rule.rule}`,
  );
}

console.log(
  `\nBy file (top ${Math.min(TOP, files.length)} of ${files.length})`,
);
for (const [file, n] of files.slice(0, TOP)) {
  const rules = {};
  for (const f of findings)
    if (f.file === file) rules[f.rule] = (rules[f.rule] ?? 0) + 1;
  const detail = Object.entries(rules)
    .sort((a, b) => b[1] - a[1])
    .map(([r, c]) => `${r}:${c}`)
    .join(" ");
  console.log(`  ${rpad(n, 5)}  ${pad(file, 60)} ${detail}`);
}

if (LIST) {
  console.log("\nFindings");
  for (const f of findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  )) {
    console.log(`  ${f.file}:${f.line}  [${f.rule}]  ${f.snippet}`);
  }
}

console.log(`\nTotal: ${findings.length}`);
