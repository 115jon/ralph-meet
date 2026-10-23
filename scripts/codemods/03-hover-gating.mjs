/**
 * Unit 3: hover gating (design-system.md 9.3).
 *
 *  1. Delete hover that moves or resizes: hover:scale-*, hover:-translate-*,
 *     hover:rotate-*, group-hover:animate-wiggle. The resting half of a
 *     hover-reveal slide (translate-y-1 + group-hover:translate-y-0) goes too.
 *  2. Keep controls reachable on touch. A control hidden with `opacity-0`
 *     (and `pointer-events-none` when it has group-hover:pointer-events-auto)
 *     is hidden only under `pointer-fine:`, so touch users still see it. Pure
 *     decorations (a hover card: pointer-events-none, no pointer-events-auto)
 *     and full-cover overlays (inset-0) stay hover-only, as does MessageItem
 *     (long-press action sheet).
 *  3. Gate every bare hover:/group-hover:/peer-hover: behind `pointer-fine:`
 *     (inserted directly before the hover variant, after any other variants).
 *     `[@media(pointer:fine)]:hover:` collapses to `pointer-fine:hover:`.
 */
import { run } from "./_lib.mjs";

const Q = String.raw`[^\s"'\x60]`;
const HOVER = String.raw`(?:(?:group|peer)-hover|hover)(?:\/[\w-]+)?`;
// A full token: optional variant chain, hover variant, then the utility.
const MOVES = new RegExp(
  String.raw`(?<![\w-])(?:[\w-]+:|\[[^\]\s]+\]:)*${HOVER}:(?:-?scale-(?!100(?![\d.]))${Q}+|animate-wiggle|-?translate-[xy]-(?!0(?![\d.]))${Q}+|-?rotate-${Q}+)`,
  "g",
);
const SLIDE_ON_HOVER = new RegExp(
  String.raw`(?<![\w-])(?:[\w-]+:)*${HOVER}:translate-y-0(?![\w.-])`,
  "g",
);
const SLIDE_REST =
  /(?<![\w-])(?:[\w-]+:)*-?translate-y-(?:0\.5|1|2)(?![\w.-])/g;
const REVEAL_ON =
  /(?<![\w-])(?:[\w-]+:)*(?:group|peer)-hover(?:\/[\w-]+)?:opacity-100/;
const POINTER_AUTO =
  /(?<![\w-])(?:[\w-]+:)*(?:group|peer)-hover(?:\/[\w-]+)?:pointer-events-auto/;
const HAS_FINE = (chain) => /pointer-fine:/.test(chain);

const BARE = new RegExp(
  String.raw`(?<![\w(-])((?:group|peer)-hover|hover)((?:\/[\w-]+)?:)(?=[\w[!-])`,
  "g",
);

run("03-hover-gating", (line, ctx) => {
  let out = line;

  // 1a. hover that moves / resizes
  if (MOVES.test(out)) {
    MOVES.lastIndex = 0;
    out = out.replace(new RegExp(String.raw`[ ]?${MOVES.source}`, "g"), () => {
      ctx.hit("deleted hover scale/translate/rotate/wiggle");
      return "";
    });
  }
  MOVES.lastIndex = 0;

  // 1b. hover-reveal slide: drop both halves
  SLIDE_ON_HOVER.lastIndex = 0;
  if (SLIDE_ON_HOVER.test(out)) {
    SLIDE_ON_HOVER.lastIndex = 0;
    out = out.replace(
      new RegExp(String.raw`[ ]?${SLIDE_ON_HOVER.source}`, "g"),
      () => {
        ctx.hit("deleted hover slide-in (hover half)");
        return "";
      },
    );
    out = out.replace(
      new RegExp(String.raw`[ ]?${SLIDE_REST.source}`, "g"),
      () => {
        ctx.hit("deleted hover slide-in (resting half)");
        return "";
      },
    );
  }

  // 2. keep hover-revealed controls reachable on touch
  if (REVEAL_ON.test(out)) {
    const decoration =
      /(?<![\w-])pointer-events-none(?![\w-])/.test(out) &&
      !POINTER_AUTO.test(out);
    // Overlays that cover a whole image and the message hover bar (which has a
    // long-press action sheet on touch) must stay hover-only: always showing
    // them on touch would darken avatars or clutter every message.
    const overlay =
      /(?<![w-])inset-0(?![w-])/.test(out) ||
      ctx.file.endsWith("/MessageItem.tsx");
    if (overlay) {
      ctx.skip(
        "hover-reveal",
        "overlay / message bar kept hover-only; check touch path",
      );
    } else if (!decoration) {
      out = out.replace(
        /(?<![\w-])((?:[\w-]+:)*)opacity-0(?![\w.-])/g,
        (m, chain) => {
          if (HAS_FINE(chain)) return m;
          ctx.hit("touch: opacity-0 -> pointer-fine:opacity-0");
          return `${chain}pointer-fine:opacity-0`;
        },
      );
      if (POINTER_AUTO.test(out)) {
        out = out.replace(
          /(?<![\w-])((?:[\w-]+:)*)pointer-events-none(?![\w-])/g,
          (m, chain) => {
            if (HAS_FINE(chain)) return m;
            ctx.hit(
              "touch: pointer-events-none -> pointer-fine:pointer-events-none",
            );
            return `${chain}pointer-fine:pointer-events-none`;
          },
        );
      }
    } else {
      ctx.skip("hover-reveal", "decoration kept hover-only");
    }
  }

  // 3a. [@media(pointer:fine)]:hover: -> pointer-fine:hover:
  out = out.replace(
    /\[@media\((?:pointer:fine|hover:hover)\)(?:_and_\((?:pointer:fine|hover:hover)\))?\]:(?:pointer-fine:)?((?:group-|peer-)?hover)/g,
    (m, h) => {
      ctx.hit("collapsed [@media(pointer:fine)] to pointer-fine:");
      return `pointer-fine:${h}`;
    },
  );

  // 3b. bare hover -> pointer-fine:hover
  out = out.replace(BARE, (m, hv, rest, off, str) => {
    if (str.slice(Math.max(0, off - 13), off) === "pointer-fine:") return m;
    ctx.hit("gated hover");
    return `pointer-fine:${hv}${rest}`;
  });

  return out;
});
