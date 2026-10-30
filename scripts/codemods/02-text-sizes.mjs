/**
 * Unit 2: text sizes -> text-ui-*, font-bold on titles -> font-semibold.
 * Mapping follows design-system.md 4.1:
 *   text-xs 12 -> ui-xs   text-sm 14 -> ui-sm (13)   text-base 16 -> ui-md
 *   text-lg 18 -> ui-lg   text-xl 20 -> ui-xl (22)   text-2xl/3xl -> ui-2xl (28)
 *   text-4xl -> display (36)   text-5xl and up -> display-lg (44)
 *   text-[Npx]: <=11 ui-2xs, 12 xs, 13-14 sm, 15 base, 16-17 md, 18-19 lg,
 *               20-22 xl, 24-32 2xl. sizes under 9px are left.
 * Variant prefixes (sm:, dark:, [&_svg]:) are kept. Line-height utilities
 * (text-sm/6) are left alone.
 */
import { run } from "./_lib.mjs";

const NAMED = {
  xs: "xs",
  sm: "sm",
  base: "md",
  lg: "lg",
  xl: "xl",
  "2xl": "2xl",
  "3xl": "2xl",
  // Display steps (36 / 44): marketing and 404-style hero text only.
  "4xl": "display",
  "5xl": "display-lg",
  "6xl": "display-lg",
  "7xl": "display-lg",
};
function px(n) {
  if (n >= 9 && n <= 11) return "2xs";
  if (n === 12) return "xs";
  if (n === 13 || n === 14) return "sm";
  if (n === 15) return "base";
  if (n === 16 || n === 17) return "md";
  if (n === 18 || n === 19) return "lg";
  if (n >= 20 && n <= 22) return "xl";
  if (n >= 23 && n <= 32) return "2xl";
  return null;
}

const NAMED_RE =
  /(?<![\w/[-])text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)(?![\w/-])/g;
const ARB_RE = /(?<![\w/[-])text-\[(\d+(?:\.\d+)?)(px|rem)\](?![\w/-])/g;
const BOLD_TEST = /(?<![\w-])font-bold(?![\w-])/;
const BOLD_RE = /(?<![\w-])font-bold(?![\w-])/g;

run("02-text-sizes", (line, ctx) => {
  let out = line.replace(NAMED_RE, (m, k) => {
    ctx.hit("named -> text-ui-*");
    const step = NAMED[k];
    return step.startsWith("display") ? `text-${step}` : `text-ui-${step}`;
  });
  out = out.replace(ARB_RE, (m, n, unit) => {
    const v = unit === "rem" ? Number(n) * 16 : Number(n);
    const step = px(v);
    if (!step) {
      ctx.skip("text-size", `${m} has no step`);
      return m;
    }
    ctx.hit("arbitrary -> text-ui-*");
    return `text-ui-${step}`;
  });
  // font-bold -> font-semibold on titles: a sized text line that is not an
  // uppercase eyebrow, a 2xs badge, or unsized.
  if (
    BOLD_TEST.test(out) &&
    /text-ui-(?:xs|sm|base|md|lg|xl|2xl)|<h[1-4]/.test(out) &&
    !/uppercase|text-ui-2xs|badge/.test(out)
  ) {
    out = out.replace(BOLD_RE, () => {
      ctx.hit("font-bold -> font-semibold");
      return "font-semibold";
    });
  }
  return out;
});
