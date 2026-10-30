/**
 * Unit 5: viewport units and breakpoints (design-system.md 3.1, 3.4).
 *
 *  1. vh -> dvh in arbitrary values, h-screen / min-h-screen / max-h-screen ->
 *     *-dvh, w-screen -> w-full.
 *  2. sm: -> md: (and max-sm: -> max-md:). Moving the phone/desktop split from
 *     640 to 768 keeps every >= 768 layout exactly as it was; only 640-767
 *     changes (it now gets the phone layout). Two cases are handled so the
 *     result stays correct:
 *       - a line that already has an md: utility in the same property family:
 *         the sm: one is dropped (md: won at >= 768 before, still does);
 *       - an sm: utility identical to the un-prefixed one on the line: dropped.
 *  Not touched (done by hand, listed): HomePageClient (marketing),
 *  VoiceDebugScreen (dev tool), the container-query components (VoiceGrid,
 *  ParticipantCard, StreamLoadingIndicator), auth layout files, xl:/2xl:.
 */
import { run } from "./_lib.mjs";

const SKIP_SM = [
  /^src\/components\/HomePageClient\.tsx$/,
  /^src\/components\/voice\/VoiceDebugScreen\.tsx$/,
  /^src\/components\/voice\/VoiceGrid\.tsx$/,
  /^src\/components\/voice\/ParticipantCard\.tsx$/,
  /^src\/components\/voice\/StreamLoadingIndicator\.tsx$/,
  /^src\/components\/auth\//,
];

const VH = /(?<![A-Za-z])(\d+(?:\.\d+)?)vh\b/g;
const SCREEN = /(?<![\w-])(h|min-h|max-h)-screen(?![\w-])/g;
const W_SCREEN = /(?<![\w-])w-screen(?![\w-])/g;

const Q = String.raw`[^\s"'\x60]`;
const SM_TOKEN = new RegExp(String.raw`(?<![\w@-])((?:max-)?)sm:(${Q}+)`, "g");
const DISPLAY = new Set([
  "block",
  "inline",
  "inline-block",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "hidden",
  "contents",
  "table",
]);

/** Rough property family so an sm: value can be matched with an md: value. */
function family(util) {
  const u = util
    .replace(/^!/, "")
    .replace(/^-/, "")
    .replace(/\/\d+$/, "");
  if (DISPLAY.has(u)) return "display";
  if (/^text-(ui-|display|xs$|sm$|base$|lg$|xl$|\d)/.test(u))
    return "text-size";
  if (
    /^text-(left|center|right|justify|start|end|balance|pretty|nowrap|wrap|ellipsis|clip)$/.test(
      u,
    )
  )
    return "text-align";
  if (
    /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(
      u,
    )
  )
    return "font-weight";
  if (/^flex-(row|col)(-reverse)?$/.test(u)) return "flex-dir";
  if (/^flex-(wrap|nowrap)/.test(u)) return "flex-wrap";
  if (/^(flex-(1|auto|none|initial)|grow|shrink)/.test(u)) return "flex-size";
  if (/^(items|justify|self|content|place)-/.test(u))
    return u.replace(/-[^-]+$/, "");
  if (/^(max-|min-)?[wh]-/.test(u) || /^size-/.test(u))
    return u.replace(/-(\[.*\]|[^-]+)$/, "");
  if (/^rounded/.test(u))
    return u.replace(/-(xs|sm|md|lg|xl|2xl|3xl|full|none|\[.*\])$/, "");
  if (
    /^(border|shadow|ring|opacity|gap|space|p[xytblrse]?|m[xytblrse]?|grid-cols|grid-rows|col-span|row-span|order|leading|tracking|top|bottom|left|right|inset)(-|$)/.test(
      u,
    )
  )
    return u.replace(/-(\[.*\]|[^-]+)$/, "") || u;
  return u.replace(/-(\[.*\]|[^-]+)$/, "");
}

run(
  "05-viewport-breakpoints",
  (line, ctx) => {
    let out = line
      .replace(VH, (m, n) => {
        ctx.hit("vh -> dvh");
        return `${n}dvh`;
      })
      .replace(SCREEN, (m, p) => {
        ctx.hit("h-screen -> h-dvh");
        return `${p}-dvh`;
      })
      .replace(W_SCREEN, () => {
        ctx.hit("w-screen -> w-full");
        return "w-full";
      });

    if (SKIP_SM.some((re) => re.test(ctx.file))) {
      for (const m of out.matchAll(SM_TOKEN))
        ctx.skip("sm:", `${m[0]} (by hand / allowlisted)`);
      return out;
    }

    if (/(?<![\w@-])(?:max-)?sm:/.test(out)) {
      const bare = new Set();
      const mdFamilies = new Set();
      for (const m of out.matchAll(/(?<![\w@:-])([^\s"'`:]+)(?=[\s"'`]|$)/g))
        bare.add(m[1]);
      for (const m of out.matchAll(/(?<![\w@-])md:([^\s"'`:]+)/g))
        mdFamilies.add(family(m[1]));
      out = out.replace(
        new RegExp(String.raw`[ ]?${SM_TOKEN.source}`, "g"),
        (full, max, util) => {
          const lead = full.startsWith(" ") ? " " : "";
          if (!max && bare.has(util)) {
            ctx.hit("sm: dropped (same as base)");
            return "";
          }
          if (!max && mdFamilies.has(family(util))) {
            ctx.hit("sm: dropped (md: already sets it)");
            return "";
          }
          ctx.hit(max ? "max-sm: -> max-md:" : "sm: -> md:");
          return `${lead}${max}md:${util}`;
        },
      );
    }
    return out;
  },
  {},
);
