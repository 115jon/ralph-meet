/**
 * Contrast contract (talk-tree-spec §1g). Parses the layer-1 theme inputs in
 * src/styles/tokens.css and checks every required pair for all six themes,
 * so a colourway can never ship an unreadable ink or a muted mic that looks
 * like a live camera. Tints are composited over ply-2, the surface they sit
 * on in practice.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const THEMES = [
  "dark",
  "light",
  "miku-dark",
  "miku-light",
  "spiderman-dark",
  "spiderman-light",
] as const;
type Theme = (typeof THEMES)[number];

const css = readFileSync(resolve(__dirname, "../tokens.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Layer-1 declarations per selector (flat blocks only). */
function parseBlocks(source: string): Map<string, Record<string, string>> {
  const blocks = new Map<string, Record<string, string>>();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(re)) {
    const selectors = match[1].split(",").map((s) => s.trim());
    const decls: Record<string, string> = {};
    for (const decl of match[2].split(";")) {
      const m = decl.match(/^\s*(--t-[\w-]+)\s*:\s*([^;]+?)\s*$/);
      if (m) decls[m[1]] = m[2];
    }
    if (Object.keys(decls).length === 0) continue;
    for (const selector of selectors) {
      blocks.set(selector, { ...(blocks.get(selector) ?? {}), ...decls });
    }
  }
  return blocks;
}

const blocks = parseBlocks(css);

function themeInputs(theme: Theme): Record<string, string> {
  const base = blocks.get(":root") ?? {};
  const own = theme === "dark" ? blocks.get(".dark") : blocks.get(`.${theme}`);
  if (!own) throw new Error(`tokens.css has no .${theme} block`);
  return { ...base, ...own };
}

type RGB = [number, number, number];

function hex(value: string): RGB {
  const h = value.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a #rrggbb: ${value}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
}

const lin = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

function luminance([r, g, b]: RGB) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** color-mix(in srgb, fg p%, transparent) painted over bg. */
function over(fg: RGB, pct: string, bg: RGB): RGB {
  const p = parseFloat(pct) / 100;
  return fg.map((v, i) => v * p + bg[i] * (1 - p)) as RGB;
}

function lab([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r, g, b].map(lin);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000. */
function deltaE(c1: RGB, c2: RGB): number {
  const [L1, a1, b1] = lab(c1);
  const [L2, a2, b2] = lab(c2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    const v = Math.atan2(b, a) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dL = L2 - L1;
  const dC = C2p - C1p;
  let dh = h2p - h1p;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hb = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hb += hb < 360 ? 360 : -360;
    hb /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hb - 30) * rad) +
    0.24 * Math.cos(2 * hb * rad) +
    0.32 * Math.cos((3 * hb + 6) * rad) -
    0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT =
    -2 *
    Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) *
    Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
  return Math.sqrt(
    (dL / SL) ** 2 +
      (dC / SC) ** 2 +
      (dH / SH) ** 2 +
      RT * (dC / SC) * (dH / SH),
  );
}

describe("theme tokens parse", () => {
  it.each(THEMES)("%s declares every contract input", (theme) => {
    const t = themeInputs(theme);
    for (const key of [
      "--t-ply-0",
      "--t-ply-1",
      "--t-ply-2",
      "--t-ply-3",
      "--t-ply-4",
      "--t-ink-1",
      "--t-ink-2",
      "--t-ink-3",
      "--t-primary-fill",
      "--t-on-primary",
      "--t-accent-ink",
      "--t-talk",
      "--t-live",
      "--t-live-ink",
      "--t-danger-fill",
      "--t-on-danger",
      "--t-danger-ink",
      "--t-badge",
      "--t-on-badge",
      "--t-warning-ink",
      "--t-success-ink",
    ]) {
      expect(t[key], `${theme} ${key}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe.each(THEMES)("contrast contract: %s", (theme) => {
  const t = themeInputs(theme);
  const c = (key: string) => hex(t[key]);
  const plies = [0, 1, 2, 3].map((i) => c(`--t-ply-${i}`));
  const ply2 = c("--t-ply-2");

  it("plies are distinct and ordered (lift is monotonic)", () => {
    const lums = [0, 1, 2].map((i) => luminance(c(`--t-ply-${i}`)));
    if (t["--t-scheme"] === "dark") {
      // dark: each ply is lighter than the one below it
      expect(lums[1]).toBeGreaterThan(lums[0]);
      expect(lums[2]).toBeGreaterThan(lums[1]);
      expect(luminance(c("--t-ply-3"))).toBeGreaterThan(lums[2]);
    } else {
      // light: each ply is whiter (or equal for float, which adds a line)
      expect(lums[1]).toBeGreaterThan(lums[0]);
      expect(lums[2]).toBeGreaterThanOrEqual(lums[1]);
    }
  });

  it.each([1, 2, 3])("ink-%i is >= 4.5:1 on ply-0..3", (step) => {
    plies.forEach((ply, i) => {
      expect(
        contrast(c(`--t-ink-${step}`), ply),
        `ink-${step} on ply-${i}`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("accent-ink, danger-ink, warning-ink and success-ink are >= 4.5:1 on ply-0..3", () => {
    for (const key of [
      "--t-accent-ink",
      "--t-danger-ink",
      "--t-warning-ink",
      "--t-success-ink",
    ]) {
      plies.forEach((ply, i) => {
        expect(
          contrast(c(key), ply),
          `${key} on ply-${i}`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  });

  it("solid fills carry >= 4.5:1 ink", () => {
    expect(
      contrast(c("--t-on-primary"), c("--t-primary-fill")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(c("--t-on-danger"), c("--t-danger-fill")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c("--t-on-badge"), c("--t-badge"))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("on-talk is >= 4.5:1 on every LED fill it inks (talk, idle, live)", () => {
    // Accept-call buttons and Wordle tiles put on-talk text on these fills.
    for (const key of ["--t-talk", "--t-idle", "--t-live"]) {
      expect(
        contrast(c("--t-on-talk"), c(key)),
        `on-talk on ${key}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("talk is >= 3:1 on ply-2 (a 2px ring)", () => {
    expect(contrast(c("--t-talk"), ply2)).toBeGreaterThanOrEqual(3);
  });

  it("tinted chips keep their ink readable", () => {
    const liveTint = over(c("--t-live"), t["--t-live-tint-mix"], ply2);
    expect(
      contrast(c("--t-live-ink"), liveTint),
      "live-ink on live-tint",
    ).toBeGreaterThanOrEqual(4.5);
    const accentTint = over(
      c("--t-accent-ink"),
      t["--t-accent-tint-mix"],
      ply2,
    );
    expect(
      contrast(c("--t-accent-ink"), accentTint),
      "accent-ink on accent-tint",
    ).toBeGreaterThanOrEqual(4.5);
    const dangerTint = over(
      c("--t-danger-ink"),
      t["--t-danger-tint-mix"],
      ply2,
    );
    expect(
      contrast(c("--t-danger-ink"), dangerTint),
      "danger-ink on danger-tint",
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("the input edge is >= 3:1 on ply-2", () => {
    const edge = over(c("--t-ink-1"), t["--t-line-field-mix"], ply2);
    expect(contrast(edge, ply2)).toBeGreaterThanOrEqual(3);
  });

  // Component kit (DESIGN.md, Components): the recipes that lean on ink
  // rather than a hue for their boundary or state.
  it("2px ink rules and rails (segmented, rule cards, menu top) are >= 3:1 on ply-0..3", () => {
    plies.forEach((ply, i) => {
      expect(
        contrast(c("--t-ink-1"), ply),
        `ink-1 rule on ply-${i}`,
      ).toBeGreaterThanOrEqual(3);
    });
  });

  it("the LED switch thumb reads on its track in both states", () => {
    // Off: ink-2 thumb on the tint-3 track (ink-1 at 16%) over ply-0..3.
    plies.forEach((ply, i) => {
      const track = over(c("--t-ink-1"), "16%", ply);
      expect(
        contrast(c("--t-ink-2"), track),
        `off thumb on ply-${i}`,
      ).toBeGreaterThanOrEqual(3);
    });
    // On: on-primary thumb on the primary-fill track.
    expect(
      contrast(c("--t-on-primary"), c("--t-primary-fill")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("the fader cap (ink-1) is >= 3:1 on its tint-3 track", () => {
    plies.forEach((ply, i) => {
      const track = over(c("--t-ink-1"), "16%", ply);
      expect(
        contrast(c("--t-ink-1"), track),
        `cap on ply-${i}`,
      ).toBeGreaterThanOrEqual(3);
    });
  });

  it("inverted surfaces (tooltip, call toast) keep their ink readable", () => {
    const ink = c("--t-ink-1");
    const ground = c("--t-ply-0");
    expect(contrast(ground, ink), "ply-0 on ink-1").toBeGreaterThanOrEqual(4.5);
    // The call toast's body runs ply-0 at 80% over the ink-1 fill.
    expect(
      contrast(over(ground, "80%", ink), ink),
      "body on ink-1",
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("silkscreen in ink-3 holds 4.5:1 on a 2px plate legend backing (ply-0..3)", () => {
    plies.forEach((ply, i) => {
      expect(
        contrast(c("--t-ink-3"), ply),
        `ink-3 on ply-${i}`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("accent and danger are told apart (ΔE2000 >= 20)", () => {
    expect(
      deltaE(c("--t-accent-ink"), c("--t-danger-ink")),
    ).toBeGreaterThanOrEqual(20);
  });

  it("a live camera and a muted mic never share a hue (ΔE2000 >= 20)", () => {
    // --muted-state aliases --danger-ink (tokens.css layer 2)
    expect(deltaE(c("--t-live"), c("--t-danger-ink"))).toBeGreaterThanOrEqual(
      20,
    );
    expect(
      deltaE(c("--t-live-ink"), c("--t-danger-ink")),
    ).toBeGreaterThanOrEqual(20);
  });
});

describe("fixed LED hues", () => {
  it("talk, live, danger and idle keep one hue in every theme", () => {
    const hueOf = (h: string) => {
      const [, a, b] = lab(hex(h));
      return (Math.atan2(b, a) * 180) / Math.PI;
    };
    for (const key of ["--t-talk", "--t-live", "--t-danger-ink", "--t-idle"]) {
      const hues = THEMES.map((theme) => hueOf(themeInputs(theme)[key]));
      const spread = Math.max(...hues) - Math.min(...hues);
      expect(spread, key).toBeLessThan(25);
    }
  });
});
