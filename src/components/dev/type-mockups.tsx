/**
 * `/ui-fixtures?surface=type-mockups&theme=<id>`: the shipped typography and
 * art direction (Poster: Bricolage Grotesque 800 + Martian Mono, condensed)
 * on the landing page, the public access frame (sign-in) and the voice debug
 * stats. The A (Archivo + JetBrains Mono) and B (Fraunces over Geist) variants
 * were dropped when this direction was chosen, along with their fonts.
 * Mockup only; no production page imports this file.
 *
 * Accessibility contract (same as dither-mockups): every dither is
 * decorative, aria-hidden, still (nothing animates, so reduced motion has
 * nothing to stop), never behind running text, hidden under forced colours.
 * The only text drawn in dither is a display word whose two inks each clear
 * 4.5:1 on the ground (checked at runtime; solid accent otherwise).
 */

import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/martian-mono/wdth.css";

import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { Shot } from "@/components/home/Shot";
import { DitherField } from "@/components/ui/DitherField";
import { Icon } from "@/components/ui/icon";
import { Led } from "@/components/ui/led";
import { useDitherGeometry } from "@/components/ui/use-dither-geometry";
import { DitherSmallMultiples } from "@/components/voice/DitherChart";
import {
  CONNECTION_METRICS,
  formatValue,
  summarizeMetric,
  type ChartSample,
  type ConnectionMetricKey,
} from "@/components/voice/dither-chart-model";
import {
  isLightGround,
  mixHex,
  relativeLuminance,
  resolveCssColor,
} from "@/lib/auth-art";
import { horizonPainter, rulePainter } from "@/lib/dither-painters";
import { cn } from "@/lib/utils";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// ── Directions ───────────────────────────────────────────────────────────────

type VariantId = "c";

interface Direction {
  id: VariantId;
  name: string;
  concept: string;
  fonts: string;
  /** Font stacks the variant installs on its wrapper (Tailwind reads them). */
  vars: CSSProperties;
}

const GEIST = `"Geist Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
const GEIST_MONO = `"Geist Mono Variable", "Cascadia Mono", Consolas, ui-monospace, monospace`;
const BRICOLAGE = `"Bricolage Grotesque Variable", ${GEIST}`;
const MARTIAN = `"Martian Mono Variable", ${GEIST_MONO}`;

const DIRECTIONS: Record<VariantId, Direction> = {
  c: {
    id: "c",
    name: "C — Poster",
    concept:
      "A gig poster printed on the panel. A heavy, characterful grotesk at enormous scale, the last word set in dithered accent; a condensed mono prints the small type. Thick dithered rules, edge-to-edge type, oversized numerals.",
    fonts:
      "Bricolage Grotesque Variable (opsz + wght 200–800, latin 77 kB) · Martian Mono Variable (wdth 75–112, latin 38 kB)",
    vars: {
      "--font-display": BRICOLAGE,
      "--font-ui": BRICOLAGE,
      "--font-sans": BRICOLAGE,
      "--font-mono": MARTIAN,
      fontFamily: BRICOLAGE,
    } as CSSProperties,
  },
};

// ── Shared content ───────────────────────────────────────────────────────────

const LEAD_IN = "Voice, chat and video for your people";
const LEDE =
  "Start a room, send the link, they’re in. Voice, chat and screen share that stay up all evening.";

const FACTS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Led state="talk" size={8} />,
    title: "A light when someone talks",
    body: "The same green light on their row in the tree and on their tile.",
  },
  {
    icon: <Icon name="micOff" size="sm" className="text-danger-ink" />,
    title: "Mic and headphones at a glance",
    body: "Muted and deafened show on every row, so nobody talks into the void.",
  },
  {
    icon: <Icon name="clock" size="sm" className="text-ink-2" />,
    title: "Who’s in, and for how long",
    body: "Each voice channel carries its head count and call clock.",
  },
];

const SPECS: [string, string][] = [
  ["Platform", "Windows, web, phone"],
  ["Audio", "Opus, noise suppression"],
  ["Host", "None. The room stays open"],
  ["Idle", "0 frames per second"],
];

const TREE_ALT =
  "The channel tree in a busy call: the Lounge voice channel shows nine people and a 25 minute call clock, each on their own branch with mute and deafen icons, and Linus lit green as talking";
const PHONE_VOICE_ALT =
  "Ralph Meet on a phone in the Lounge voice channel, with the people in the call and the call controls along the bottom";
const CHAT_ALT =
  "A Ralph Meet text channel planning a trivia night: messages with reactions, a pinned reply, a shared file and the composer";

// ── Mock data for the stats slice ────────────────────────────────────────────

const SAMPLE_COUNT = 48;
const SAMPLES: ChartSample<ConnectionMetricKey>[] = Array.from(
  { length: SAMPLE_COUNT },
  (_, i) => {
    const wobble = (k: number) => Math.sin(i * k + k * 3.1);
    const rough = Math.exp(-((i - 31) ** 2) / 3);
    return {
      t: i * 2000,
      bitrate: Math.round(58 + 3 * wobble(0.7) + 2 * wobble(1.9) - 24 * rough),
      loss:
        Math.round(
          (3.4 * rough + (i === 12 ? 0.6 : 0) + (i === 40 ? 0.3 : 0)) * 10,
        ) / 10,
      jitter: Math.round(6 + 1.5 * wobble(1.3) + 15 * rough),
      rtt: Math.round(44 + 3 * wobble(0.9) + 2 * wobble(2.3) + 52 * rough),
    };
  },
);

const STABLE = { led: "talk", label: "Stable" } as const;

/** Current value per metric, for the readout rows. */
function useReadouts() {
  return useMemo(
    () =>
      CONNECTION_METRICS.map((m) => ({
        metric: m,
        summary: summarizeMetric(SAMPLES, m.key),
      })),
    [],
  );
}

// ── Dither helpers ───────────────────────────────────────────────────────────

/** A still accent field in the host's own aspect, keyed on its size. */
function Field({
  paint,
  cell = 5,
  contrast,
  intensity,
  className,
}: {
  paint?: "horizon" | "rule" | "auth";
  cell?: number;
  contrast?: number;
  intensity?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const geometry = useDitherGeometry(ref);
  const painter = useMemo(() => {
    if (!geometry) return undefined;
    if (paint === "horizon") return horizonPainter(geometry.aspect, 0.62);
    if (paint === "rule") return rulePainter;
    return undefined;
  }, [geometry, paint]);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        "pointer-events-none relative overflow-hidden forced-colors:hidden",
        className,
      )}
    >
      {geometry ? (
        <DitherField
          key={`${geometry.width}:${geometry.aspect}`}
          paint={painter}
          cell={cell}
          contrast={contrast}
          intensity={intensity}
          style={{ background: "transparent" }}
        />
      ) : null}
    </div>
  );
}

interface Ground {
  accent: string;
  ground: string;
}

function useGround(): Ground | null {
  const [colors, setColors] = useState<Ground | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const style = getComputedStyle(root);
      const accent = resolveCssColor(
        style.getPropertyValue("--accent-ink").trim(),
      );
      const ground = resolveCssColor(style.getPropertyValue("--ply-0").trim());
      if (!accent || !ground) return;
      setColors((prev) =>
        prev?.accent === accent && prev.ground === ground
          ? prev
          : { accent, ground },
      );
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];
const TEX_W = 192;
const TEX_H = 64;

function paintTexture(a: string, b: string): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  for (let y = 0; y < TEX_H; y++) {
    for (let x = 0; x < TEX_W; x++) {
      const u = x / TEX_W;
      const v = y / TEX_H;
      const core = Math.exp(-((u - 0.3) ** 2 * 9 + (v - 0.35) ** 2 * 6));
      const field = 0.1 + 0.5 * (1 - u) * (1 - v * 0.6) + 0.45 * core;
      const threshold = (BAYER8[y % 8]![x % 8]! + 0.5) / 64;
      ctx.fillStyle = field > threshold ? b : a;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toDataURL("image/png");
}

/**
 * Two-ink accent dither clipped to text. Both inks must clear 4.5:1 on the
 * ground or the word stays solid accent; CanvasText under forced colours.
 */
function DitherWord({
  children,
  cell = 3,
  className,
}: {
  children: ReactNode;
  cell?: number;
  className?: string;
}) {
  const colors = useGround();
  const url = useMemo(() => {
    if (!colors) return null;
    const { accent, ground } = colors;
    const deep = isLightGround(ground)
      ? mixHex(accent, "#000000", 0.42)
      : mixHex(accent, "#ffffff", 0.62);
    if (
      contrastRatio(accent, ground) < 4.5 ||
      contrastRatio(deep, ground) < 4.5
    )
      return null;
    return paintTexture(accent, deep);
  }, [colors]);
  const style: CSSProperties | undefined = url
    ? {
        backgroundImage: `url(${url})`,
        backgroundSize: `${TEX_W * cell}px ${TEX_H * cell}px`,
        backgroundRepeat: "repeat",
        imageRendering: "pixelated",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }
    : undefined;
  return (
    <span
      style={style}
      className={cn(
        "text-accent-ink forced-colors:bg-none! forced-colors:text-[CanvasText]!",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── Shared chrome ────────────────────────────────────────────────────────────

function Lockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <ThemeAwareSplashLogo className="size-7 object-contain select-none" />
      <span className="text-ui-row font-semibold text-ink-1">Ralph Meet</span>
    </span>
  );
}

function Window({
  name,
  alt,
  width = 1440,
  height = 900,
  className,
  radius = "rounded-lg",
}: {
  name: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  radius?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden border border-line-strong bg-ply-0 shadow-modal",
        radius,
        className,
      )}
    >
      <Shot name={name} alt={alt} width={width} height={height} />
    </div>
  );
}

const PRESS =
  "transition-[transform,background-color] duration-100 ease-out active:scale-[0.97] outline-none";

// ═════════════════════════════════════════════════════════════════════════════
// Variant C — Poster
// ═════════════════════════════════════════════════════════════════════════════

/** Bricolage at 800, optical size on. */
const C_DISPLAY =
  "font-display text-ink-1 [font-weight:800] [font-optical-sizing:auto] [font-kerning:normal]";
/** Condensed mono silkscreen: 11px 500, 0.06em, uppercase. */
const C_LABEL =
  "font-mono text-[11px] leading-[14px] font-medium tracking-[0.06em] uppercase [font-stretch:80%]";

function CButton({
  primary,
  children,
}: {
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        PRESS,
        "inline-flex h-12 items-center justify-center gap-2 rounded-sm px-6 text-[16px] leading-none font-semibold",
        primary ? "bg-primary-fill text-on-primary" : "bg-tint-2 text-ink-1",
      )}
    >
      {children}
    </button>
  );
}

function CHeader() {
  return (
    <div className="flex h-16 items-center justify-between px-5 md:px-10">
      <Lockup />
      <span
        className={cn(C_LABEL, "hidden items-center gap-8 text-ink-2 md:flex")}
      >
        <span>Product</span>
        <span>Download</span>
        <span>Changelog</span>
      </span>
      <span className={cn(C_LABEL, "text-ink-1")}>Sign in</span>
    </div>
  );
}

function HeroC() {
  return (
    <section className="relative overflow-hidden bg-ply-0">
      <CHeader />
      <div className="px-5 pt-10 md:px-10 md:pt-16">
        <h1
          className={cn(
            C_DISPLAY,
            "text-[length:clamp(3.5rem,1rem+14vw,11rem)] leading-[0.86] tracking-[-0.045em] text-balance",
          )}
        >
          The room is
          <br />
          always <DitherWord cell={3}>open.</DitherWord>
        </h1>
        <Field
          paint="rule"
          cell={3}
          contrast={1.1}
          className="mt-8 h-3 md:mt-12 md:h-5"
        />
        <div className="mt-8 grid gap-8 md:grid-cols-12 md:gap-6">
          <p className="max-w-[32ch] text-[18px] leading-7 text-pretty text-ink-2 md:col-span-5 md:text-[20px] md:leading-8">
            {LEDE}
          </p>
          <div className="flex flex-wrap gap-3 md:col-span-4">
            <CButton primary>
              Start a room
              <Icon name="arrowRight" size="sm" />
            </CButton>
            <CButton>Download for Windows</CButton>
          </div>
          <ul
            className={cn(
              C_LABEL,
              "flex flex-col gap-2 text-ink-3 md:col-span-3 md:items-end md:text-right",
            )}
          >
            <li>{LEAD_IN}</li>
            {SPECS.slice(0, 3).map(([k, v]) => (
              <li key={k}>
                <span className="text-ink-2">{k}</span> · {v}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="relative mt-12 md:mt-20">
        <Field
          paint="horizon"
          cell={6}
          contrast={1.25}
          className="absolute inset-x-0 top-[30%] bottom-0"
        />
        <div className="relative px-5 md:px-10">
          <Window
            name="chat"
            alt={CHAT_ALT}
            className="hidden md:block md:rounded-b-none md:border-b-0"
          />
          <Window
            name="phone-voice"
            alt={PHONE_VOICE_ALT}
            width={390}
            height={844}
            radius="rounded-[28px]"
            className="mx-auto w-full max-w-[280px] md:hidden"
          />
        </div>
        <div className="h-14 md:hidden" />
      </div>
    </section>
  );
}

function ProductC() {
  return (
    <section className="border-t border-line bg-ply-0 px-5 py-16 md:px-10 md:py-24">
      <div className="grid gap-10 md:grid-cols-12 md:gap-8">
        <div className="md:col-span-7">
          <p
            aria-hidden="true"
            className={cn(
              C_DISPLAY,
              "text-[length:clamp(5rem,3rem+9vw,10rem)] leading-[0.8] tracking-[-0.05em]",
            )}
          >
            <DitherWord cell={3}>01</DitherWord>
          </p>
          <p className={cn(C_LABEL, "mt-6 text-ink-3")}>Voice channels</p>
          <h2
            className={cn(
              C_DISPLAY,
              "mt-3 max-w-[12ch] text-[length:clamp(2.5rem,1.6rem+4.4vw,4.75rem)] leading-[0.92] tracking-[-0.04em] text-balance",
            )}
          >
            Voice that stays open.
          </h2>
          <p className="mt-6 max-w-[40ch] text-[18px] leading-7 text-pretty text-ink-2">
            Leave a channel running. Friends see you&rsquo;re there and drop in,
            with no invite, no lobby and no waiting for a host. The tree shows
            who&rsquo;s in the call and who&rsquo;s talking.
          </p>
          <ul className="mt-10 grid gap-x-8 sm:grid-cols-3">
            {FACTS.map((f, i) => (
              <li key={f.title} className="border-t-2 border-ink-1 pt-4 pb-6">
                <p
                  className={cn(C_LABEL, "flex items-center gap-3 text-ink-3")}
                >
                  <span className="text-ink-1">0{i + 1}</span>
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 items-center"
                  >
                    {f.icon}
                  </span>
                </p>
                <p className="mt-4 text-[18px] leading-6 font-semibold text-ink-1">
                  {f.title}
                </p>
                <p className="mt-2 text-[14px] leading-5 text-pretty text-ink-2">
                  {f.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <figure className="md:col-span-4 md:col-start-9">
          <Window
            name="tree"
            alt={TREE_ALT}
            width={648}
            height={1176}
            className="mx-auto w-full max-w-[300px] md:max-w-none"
          />
        </figure>
      </div>
    </section>
  );
}

function CField({
  label,
  id,
  placeholder,
  type = "text",
}: {
  label: string;
  id: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={cn(C_LABEL, "text-ink-2")}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        className="h-12 w-full rounded-sm border border-line-field bg-ply-2 px-4 text-[16px] text-ink-1 outline-none placeholder:text-ink-3 focus-visible:border-accent-ink focus-visible:ring-1 focus-visible:ring-accent-ink"
      />
    </div>
  );
}

function AccessC() {
  return (
    <div className="flex min-h-[720px] flex-col bg-ply-0 lg:flex-row-reverse">
      <div className="relative h-16 shrink-0 border-b border-line bg-ply-1 lg:hidden">
        <Field cell={4} intensity={0.6} className="absolute inset-0" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-6 pt-5">
          <Lockup />
          <span className={cn(C_LABEL, "text-ink-3")}>Access</span>
        </header>
        <main className="flex flex-1 justify-center px-6 pt-10 pb-12 md:pt-[clamp(32px,9vh,88px)]">
          <div className="w-full max-w-[440px]">
            <p className={cn(C_LABEL, "text-ink-3")}>Sign in</p>
            <h1
              className={cn(
                C_DISPLAY,
                "mt-4 text-[length:clamp(2.75rem,2.2rem+2.6vw,4.25rem)] leading-[0.9] tracking-[-0.04em] text-balance",
              )}
            >
              Welcome back to the room.
            </h1>
            <Field paint="rule" cell={2} contrast={1.1} className="mt-6 h-2" />
            <p className="mt-6 max-w-[38ch] text-[17px] leading-6 text-pretty text-ink-2">
              One account for the app, the web and your phone.
            </p>
            <form
              className="mt-8 flex flex-col gap-5"
              onSubmit={(e) => e.preventDefault()}
            >
              <CField
                label="Email"
                id="c-email"
                type="email"
                placeholder="you@example.com"
              />
              <button
                type="submit"
                className={cn(
                  PRESS,
                  "inline-flex h-12 w-full items-center justify-center rounded-sm bg-primary-fill text-[16px] font-semibold text-on-primary",
                )}
              >
                Continue
              </button>
            </form>
            <button
              type="button"
              className={cn(
                PRESS,
                "mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-tint-2 text-[16px] font-semibold text-ink-1",
              )}
            >
              <Icon name="globe" size="sm" />
              Continue with Google
            </button>
            <p className={cn(C_LABEL, "mt-8 text-ink-3")}>
              New here?{" "}
              <span className="text-accent-ink underline decoration-line-strong underline-offset-4">
                Make an account
              </span>
            </p>
          </div>
        </main>
      </div>
      <aside
        aria-hidden="true"
        className="relative hidden w-[36%] max-w-[600px] shrink-0 border-r border-line bg-ply-1 lg:block forced-colors:hidden"
      >
        <Field cell={7} intensity={0.6} className="absolute inset-0" />
      </aside>
    </div>
  );
}

function StatsC() {
  const readouts = useReadouts();
  return (
    <div className="bg-ply-1 p-4 md:p-10">
      <div className="mx-auto max-w-[880px]">
        <div className="flex items-end justify-between gap-4">
          <h2
            className={cn(
              C_DISPLAY,
              "text-[40px] leading-[36px] tracking-[-0.04em] md:text-[56px] md:leading-[48px]",
            )}
          >
            Connection
          </h2>
          <p className={cn(C_LABEL, "flex items-center gap-2 pb-1 text-ink-2")}>
            <Led state="talk" />
            Stable
          </p>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 border-t-2 border-ink-1 md:grid-cols-4">
          {readouts.map(({ metric, summary }) => (
            <div key={metric.key} className="pt-4 pb-5">
              <dt className={cn(C_LABEL, "text-ink-3")}>{metric.label}</dt>
              <dd className="mt-2 flex items-baseline gap-1.5 font-mono tabular-nums">
                <span className="text-[32px] leading-[32px] font-semibold text-ink-1 [font-stretch:90%]">
                  {formatValue(summary.now, metric.digits)}
                </span>
                <span className={cn(C_LABEL, "text-ink-3")}>{metric.unit}</span>
              </dd>
              <dd className={cn(C_LABEL, "mt-1 text-ink-3")}>
                peak {formatValue(summary.max, metric.digits)}
              </dd>
            </div>
          ))}
        </dl>
        <DitherSmallMultiples
          title="Uplink"
          status={STABLE}
          metrics={CONNECTION_METRICS}
          samples={SAMPLES}
          capacity={SAMPLE_COUNT}
          className="mt-2"
        />
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const PARTS: Record<
  VariantId,
  {
    hero: () => ReactNode;
    product: () => ReactNode;
    access: () => ReactNode;
    stats: () => ReactNode;
  }
> = {
  c: { hero: HeroC, product: ProductC, access: AccessC, stats: StatsC },
};

function Caption({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn("px-4 py-2 text-[12px] leading-4 text-ink-3", className)}
      style={{ fontFamily: GEIST }}
    >
      {children}
    </p>
  );
}

function VariantPage({ dir }: { dir: Direction }) {
  const P = PARTS[dir.id];
  return (
    <section
      data-variant={dir.id}
      className="flex flex-col text-ink-1"
      style={dir.vars}
    >
      <header
        className="border-b border-line bg-ply-1 px-4 py-4 md:px-8"
        style={{ fontFamily: GEIST }}
      >
        <p className="text-[12px] leading-4 text-ink-3">Type mockup</p>
        <h2 className="mt-1 text-[16px] leading-6 font-semibold text-ink-1">
          {dir.name}
        </h2>
        <p className="mt-1 max-w-[80ch] text-[13px] leading-[18px] text-pretty text-ink-2">
          {dir.concept}
        </p>
        <p className="mt-1 text-[12px] leading-4 text-ink-3">{dir.fonts}</p>
      </header>

      <div data-shot="landing" className="border-b border-line">
        <Caption>Landing · hero and the voice section</Caption>
        <P.hero />
        <P.product />
      </div>
      <div data-shot="access" className="border-b border-line">
        <Caption>
          Access · sign-in on the public frame (Kova card as a static stand-in)
        </Caption>
        <P.access />
      </div>
      <div data-shot="stats">
        <Caption>Voice debug · a slice of the stats panel</Caption>
        <P.stats />
      </div>
    </section>
  );
}

export function TypeMockupsFixture() {
  return (
    <div
      data-testid="type-mockups"
      className="h-full overflow-y-auto bg-ply-0 text-ink-1"
    >
      <VariantPage dir={DIRECTIONS.c} />
    </div>
  );
}
