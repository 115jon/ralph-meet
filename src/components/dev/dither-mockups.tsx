/**
 * `/ui-fixtures?surface=dither-mockups&theme=<id>`: three art directions for
 * bringing accent dither back to the landing and access pages, plus two
 * dithered charts for the voice debug stats. Mockups only; no production
 * page imports it. The charts were promoted to
 * `@/components/voice/DitherChart`, which this page now renders.
 *
 * Accessibility contract for every dither on this page:
 *   - decorative only: DitherField hosts and chart marks are aria-hidden,
 *     and every number a chart shows is also real text
 *   - never behind body copy; the only text drawn *in* dither is a display
 *     word whose two inks each clear 4.5:1 on the ground (checked at
 *     runtime, solid accent otherwise, CanvasText under forced colours)
 *   - still: no field sets `animate`, so nothing ticks and reduced motion
 *     has nothing to stop; no flashing
 */

import { CTA_OUTLINE, CTA_PRIMARY, CTA_SECONDARY } from "@/components/home/ui";
import { Shot } from "@/components/home/Shot";
import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DitherField } from "@/components/ui/DitherField";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Led } from "@/components/ui/led";
import { Num } from "@/components/ui/num";
import {
  isLightGround,
  mixHex,
  relativeLuminance,
  resolveCssColor,
} from "@/lib/auth-art";
import { horizonPainter, rulePainter } from "@/lib/dither-painters";
import { cn } from "@/lib/utils";
import {
  DitherSmallMultiples,
  DitherTimeline,
  type TimelineLane,
} from "@/components/voice/DitherChart";
import {
  CONNECTION_METRICS,
  type ChartMetric,
  type ChartSample,
  type ConnectionMetricKey,
} from "@/components/voice/dither-chart-model";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// Greyscale sources live in production code (`@/lib/dither-painters`); the
// landing page's hero horizon and section rule use the same painters.

// ── Theme colours and the dithered display word ──────────────────────────────

interface Ground {
  accent: string;
  ground: string;
}

/** `--accent-ink` and `--ply-0` as hex, following the theme class on <html>. */
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

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Classic recursive Bayer matrix, values 0..n²-1. */
function bayer(n: number): number[][] {
  if (n === 1) return [[0]];
  const half = bayer(n / 2);
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => {
      const q = half[y % (n / 2)]![x % (n / 2)]! * 4;
      const quadrant = y < n / 2 ? (x < n / 2 ? 0 : 2) : x < n / 2 ? 3 : 1;
      return q + quadrant;
    }),
  );
}

const BAYER8 = bayer(8);
const TEXTURE_W = 192;
const TEXTURE_H = 64;

/** Ordered dither of a diagonal ramp with a soft lit core, as a PNG. */
function paintTexture(a: string, b: string): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_W;
  canvas.height = TEXTURE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  for (let y = 0; y < TEXTURE_H; y++) {
    for (let x = 0; x < TEXTURE_W; x++) {
      const u = x / TEXTURE_W;
      const v = y / TEXTURE_H;
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
 * Two-ink ordered dither for a display word: the accent and a brighter (dark
 * themes) or deeper (light themes) accent, laid on a diagonal ramp with a
 * soft lit core. Both inks must clear 4.5:1 on the ground or the word stays
 * solid accent, so the texture can never cost legibility.
 */
function useInkTexture(cell = 3): CSSProperties | undefined {
  const colors = useGround();
  // Built during render: `colors` is only set client-side, after mount.
  const url = useMemo(() => {
    if (!colors) return null;
    const { accent, ground } = colors;
    const deep = isLightGround(ground)
      ? mixHex(accent, "#000000", 0.42)
      : mixHex(accent, "#ffffff", 0.62);
    if (contrast(accent, ground) < 4.5 || contrast(deep, ground) < 4.5) {
      return null;
    }
    return paintTexture(accent, deep);
  }, [colors]);

  if (!url) return undefined;
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${TEXTURE_W * cell}px ${TEXTURE_H * cell}px`,
    backgroundRepeat: "repeat",
    imageRendering: "pixelated",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  };
}

/**
 * A word set in dithered accent. Plain text in the DOM (it reads and copies
 * as text); solid accent until the texture is ready or if it fails the
 * contrast check; CanvasText under forced colours.
 */
function DitherWord({
  children,
  cell,
}: {
  children: ReactNode;
  cell?: number;
}) {
  const texture = useInkTexture(cell);
  return (
    <span
      style={texture}
      className="text-accent-ink forced-colors:bg-none! forced-colors:text-[CanvasText]!"
    >
      {children}
    </span>
  );
}

// ── Shared mock chrome ───────────────────────────────────────────────────────

function MockHeader({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative z-20 flex h-16 shrink-0 items-center gap-8 px-10",
        className,
      )}
    >
      <span className="inline-flex items-center gap-3">
        <ThemeAwareSplashLogo className="size-7 object-contain select-none" />
        <span className="text-ui-row font-semibold text-ink-1">Ralph Meet</span>
      </span>
      <span className="flex items-center gap-6 text-ui-sm text-ink-2">
        <span>Product</span>
        <span>Download</span>
        <span>Changelog</span>
      </span>
      <span className={cn(CTA_OUTLINE, "ml-auto")}>Sign in</span>
    </div>
  );
}

/** A product screenshot in a window frame, cropped to `height`. */
function Window({
  name,
  alt,
  width = 1440,
  height = 900,
  crop,
  className,
}: {
  name: string;
  alt: string;
  width?: number;
  height?: number;
  /** Visible height in px; the shot is cropped from the top. */
  crop?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-line-strong bg-ply-0 shadow-modal",
        className,
      )}
      style={crop ? { height: crop } : undefined}
    >
      <Shot name={name} alt={alt} width={width} height={height} />
    </div>
  );
}

function HeroActions({ secondary }: { secondary: string }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" className={CTA_PRIMARY}>
        Start a room
        <Icon name="arrowRight" size="sm" />
      </button>
      <button type="button" className={CTA_SECONDARY}>
        {secondary}
      </button>
    </div>
  );
}

// ── Variant A: horizon band ──────────────────────────────────────────────────

const A_BAND_H = 480;
const A_FRAME_W = 1376;

/**
 * Centred editorial hero. The dither is a horizon that rises behind the
 * screenshot only; the copy sits on plain canvas above it.
 */
function HeroA() {
  const horizon = useMemo(() => horizonPainter(A_BAND_H / A_FRAME_W, 0.6), []);
  return (
    <div className="relative flex h-[900px] flex-col overflow-hidden bg-ply-0">
      <MockHeader />
      <div className="relative z-10 flex flex-col items-center px-10 pt-20 text-center">
        <p className="inline-flex items-center gap-2 text-ui-sm font-medium text-ink-2">
          <Led state="talk" />
          Voice, chat and video for your people
        </p>
        <h1 className="mt-6 max-w-[12ch] font-display text-[length:clamp(56px,3rem+4vw,104px)] leading-[0.94] font-semibold tracking-[-0.045em] text-balance text-ink-1 [font-kerning:normal] [font-optical-sizing:auto]">
          The room is always open.
        </h1>
        <p className="mt-7 max-w-[38ch] text-ui-lg leading-7 text-pretty text-ink-2">
          Start a room, send the link, they&rsquo;re in. Voice, chat and screen
          share that stay up all evening.
        </p>
        <div className="mt-9">
          <HeroActions secondary="Join with a code" />
        </div>
      </div>

      <div className="relative mt-16 flex-1">
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ height: A_BAND_H }}
        >
          <DitherField paint={horizon} cell={5} contrast={1.2} />
        </div>
        <Window
          name="voice"
          alt="A Ralph Meet voice channel with four people on tiles and the call controls below"
          className="relative z-10 mx-auto w-[960px]"
          crop={520}
        />
      </div>
    </div>
  );
}

/** Invite card: a short horizon over the head of the card, tile on the line. */
function CardA() {
  const horizon = useMemo(() => horizonPainter(120 / 400, 0.86), []);
  return (
    <div className="w-[400px] overflow-hidden rounded-xl border border-line bg-ply-0 shadow-modal">
      <div className="relative h-[120px] border-b border-line">
        <DitherField paint={horizon} cell={4} contrast={1.1} />
      </div>
      <div className="px-8 pt-0 pb-8">
        <div className="relative z-10 -mt-7 flex size-14 items-center justify-center rounded-lg border border-line-strong bg-ply-2 text-ui-xl font-semibold text-ink-1">
          R
        </div>
        <p className="mt-6 text-ui-sm text-ink-3">Ada invited you to join</p>
        <h2 className="mt-1 text-display font-semibold tracking-[-0.03em] text-balance text-ink-1">
          Ralph HQ
        </h2>
        <p className="mt-3 flex items-center gap-3 text-ui-sm text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <Led state="talk" />
            <Num size="sm">4</Num> in voice
          </span>
          <span aria-hidden="true" className="text-ink-off">
            ·
          </span>
          <span>
            <Num size="sm">128</Num> members
          </span>
        </p>
        <div className="mt-8 flex flex-col gap-2">
          <Button size="lg">Accept invite</Button>
          <Button size="lg" variant="ghost">
            Not now
          </Button>
        </div>
        <p className="mt-6 text-ui-xs text-ink-3">
          Signed in as Jon.{" "}
          <span className="text-accent-ink underline decoration-line-strong underline-offset-4">
            Switch account
          </span>
        </p>
      </div>
    </div>
  );
}

// ── Variant B: edge panel ────────────────────────────────────────────────────

const B_FEATURES: { icon: IconName; label: string }[] = [
  { icon: "voiceChannel", label: "Voice channels that stay open" },
  { icon: "screenShare", label: "Screen share in HD, room carries on" },
  { icon: "chat", label: "Chat that keeps the thread" },
];

/**
 * Left-set product hero. The dither is the sign-in art's field confined to
 * a full-height panel on the right edge; the screenshot straddles its seam.
 * Copy never crosses the seam.
 */
function HeroB() {
  return (
    <div className="relative flex h-[860px] flex-col overflow-hidden bg-ply-0">
      <div
        className="absolute inset-y-0 right-0 border-l border-line"
        style={{ width: "44%" }}
      >
        <DitherField cell={6} intensity={0.6} />
      </div>
      <MockHeader className="pr-[calc(44%+40px)]" />
      <div className="relative z-10 flex flex-1 items-center px-20">
        <div className="w-[520px]">
          <p className="text-ui-sm font-medium text-ink-3">
            For Windows, the web and your phone
          </p>
          <h1 className="mt-5 max-w-[10ch] font-display text-[length:clamp(48px,2rem+3.4vw,80px)] leading-[1] font-semibold tracking-[-0.038em] text-balance text-ink-1 [font-optical-sizing:auto]">
            Talk like you&rsquo;re in the same room.
          </h1>
          <p className="mt-6 max-w-[36ch] text-[17px] leading-7 text-pretty text-ink-2">
            One live tree of who&rsquo;s in the call and who&rsquo;s talking.
            Drop in, drop out, nobody waits for a host.
          </p>
          <div className="mt-8">
            <HeroActions secondary="Download for Windows" />
          </div>
          <ul className="mt-12 flex flex-col border-t border-line">
            {B_FEATURES.map((f) => (
              <li
                key={f.label}
                className="flex h-11 items-center gap-3 border-b border-line text-ui-row font-medium text-ink-2"
              >
                <Icon name={f.icon} size="sm" className="text-ink-3" />
                {f.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Window
        name="chat"
        alt="A Ralph Meet text channel with messages, a link preview, an attached file and the composer"
        className="absolute top-[150px] left-[calc(56%-140px)] z-10 w-[960px]"
        crop={600}
      />
    </div>
  );
}

/** Sign-up card: the form on the ground, the field in a strip on its edge. */
function CardB() {
  return (
    <div className="grid w-[760px] grid-cols-[1fr_260px] overflow-hidden rounded-xl border border-line bg-ply-0 shadow-modal">
      <div className="px-10 py-10">
        <h2 className="text-display font-semibold tracking-[-0.03em] text-balance text-ink-1">
          Make an account
        </h2>
        <p className="mt-2 max-w-[36ch] text-ui-base text-pretty text-ink-2">
          One account for the app, the web and your phone.
        </p>
        <form
          className="mt-8 flex flex-col gap-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <Field label="Display name" id="b-name" placeholder="Jon" />
          <Field
            label="Email"
            id="b-email"
            type="email"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            id="b-password"
            type="password"
            hint="At least 10 characters."
          />
          <Button size="lg" className="mt-4" type="submit">
            Create account
          </Button>
        </form>
        <p className="mt-6 text-ui-sm text-ink-2">
          Already have an account?{" "}
          <span className="text-accent-ink underline decoration-line-strong underline-offset-4">
            Sign in
          </span>
        </p>
      </div>
      <div className="relative border-l border-line">
        <DitherField cell={5} intensity={0.6} seed={4} />
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  hint,
  ...props
}: {
  label: string;
  id: string;
  hint?: string;
} & React.ComponentProps<"input">) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ui-sm font-medium text-ink-1">
        {label}
      </label>
      <Input id={id} inputSize="lg" aria-describedby={hintId} {...props} />
      {hint ? (
        <p id={hintId} className="text-ui-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ── Variant C: dithered type and rule ────────────────────────────────────────

/**
 * Typographic poster. The dither lives in one display word and in a single
 * rule under the headline; there is no field behind anything.
 */
function HeroC() {
  return (
    <div className="relative flex h-[1040px] flex-col overflow-hidden bg-ply-0">
      <MockHeader />
      <div className="px-16 pt-20">
        <h1 className="font-display text-[length:clamp(72px,2rem+7vw,148px)] leading-[0.88] font-semibold tracking-[-0.055em] text-ink-1 [font-kerning:normal] [font-optical-sizing:auto]">
          The room is
          <br />
          always <DitherWord cell={3}>open.</DitherWord>
        </h1>
        <div className="relative mt-12 h-3 overflow-hidden">
          <DitherField paint={rulePainter} cell={3} contrast={1.1} />
        </div>
        <div className="mt-8 grid grid-cols-[1fr_auto] items-start gap-16">
          <p className="max-w-[34ch] text-ui-lg leading-7 text-pretty text-ink-2">
            Voice, chat and video for the people you talk to every day. Start a
            room, send the link, they&rsquo;re in.
          </p>
          <HeroActions secondary="Join with a code" />
        </div>
      </div>
      <div className="absolute top-[640px] left-16 flex gap-12">
        {C_PHONES.map((phone) => (
          <Window
            key={phone.name}
            name={phone.name}
            alt={phone.alt}
            width={390}
            height={844}
            className="w-[300px] rounded-[28px]"
          />
        ))}
      </div>
    </div>
  );
}

/** Phone captures: the poster stays left-set, so the shots run off the foot. */
const C_PHONES = [
  {
    name: "phone-voice",
    alt: "Ralph Meet on a phone in a voice channel, with the people in the call",
  },
  {
    name: "phone-chat",
    alt: "Ralph Meet on a phone in the general channel, with messages, a link preview and an attached file",
  },
  {
    name: "phone-home",
    alt: "Ralph Meet's phone home screen with servers and direct messages",
  },
];

const C_HERE = ["Ada Lovelace", "Grace Hopper", "Linus"];

/** Room join card: a dithered rule on the lip, the room name in dither ink. */
function CardC() {
  return (
    <div className="w-[440px] overflow-hidden rounded-xl border border-line bg-ply-0 shadow-modal">
      <div className="relative h-2">
        <DitherField paint={rulePainter} cell={2} contrast={1.1} />
      </div>
      <div className="px-8 pt-8 pb-8">
        <p className="text-ui-sm text-ink-3">
          Room <Num size="sm">FRI-7Q2K</Num>
        </p>
        <h2 className="mt-2 text-[44px] leading-[44px] font-semibold tracking-[-0.04em] text-balance text-ink-1">
          Join <DitherWord cell={2}>Friday night</DitherWord>
        </h2>
        <div className="mt-5 flex items-center gap-3">
          <span className="flex -space-x-1.5">
            {C_HERE.map((name) => (
              <Avatar key={name} name={name} size={24} ring="ply-0" />
            ))}
          </span>
          <p className="text-ui-sm text-ink-2">Ada, Grace and Linus are here</p>
        </div>
        <form
          className="mt-8 flex flex-col gap-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <Field
            label="Your name"
            id="c-name"
            placeholder="How the room sees you"
          />
          <Button size="lg" type="submit">
            Join room
          </Button>
        </form>
        <p className="mt-5 text-ui-xs text-ink-3">
          No account needed. Your mic stays off until you turn it on.
        </p>
      </div>
    </div>
  );
}

// ── Voice debug charts ───────────────────────────────────────────────────────
//
// The charts themselves ship (`@/components/voice/DitherChart`); this page
// feeds them a deterministic mock so the two variants can be compared.

const SAMPLE_COUNT = 48;
const SAMPLE_INTERVAL_MS = 2000;

/** Deterministic mock: a steady call with one rough patch at about −34 s. */
const SAMPLES: ChartSample<ConnectionMetricKey>[] = Array.from(
  { length: SAMPLE_COUNT },
  (_, i) => {
    const wobble = (k: number) => Math.sin(i * k + k * 3.1);
    const rough = Math.exp(-((i - 31) ** 2) / 3);
    return {
      t: i * SAMPLE_INTERVAL_MS,
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

const [M_BITRATE, M_LOSS, M_JITTER, M_RTT] = CONNECTION_METRICS as [
  ChartMetric<ConnectionMetricKey>,
  ChartMetric<ConnectionMetricKey>,
  ChartMetric<ConnectionMetricKey>,
  ChartMetric<ConnectionMetricKey>,
];

const STABLE = { led: "talk", label: "Stable" } as const;

const TIMELINE_LANES: TimelineLane<ConnectionMetricKey>[] = [
  { metric: M_BITRATE, height: 72 },
  { metric: M_RTT, height: 48 },
  { metric: M_JITTER, height: 40 },
  { metric: M_LOSS, kind: "density" },
];

// ── Page ─────────────────────────────────────────────────────────────────────

interface Spec {
  role: string;
  value: string;
}

function Variant({
  label,
  direction,
  specs,
  children,
}: {
  label: string;
  direction: string;
  specs: Spec[];
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6 border-t border-line pt-10">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-10">
        <div>
          <h2 className="text-ui-xl font-semibold text-balance text-ink-1">
            {label}
          </h2>
          <p className="mt-2 max-w-[60ch] text-ui-row text-pretty text-ink-2">
            {direction}
          </p>
        </div>
        <dl className="grid grid-cols-[112px_1fr] content-start gap-x-4 gap-y-1.5 text-ui-xs">
          {specs.map((s) => (
            <div key={s.role} className="contents">
              <dt className="text-ink-3">{s.role}</dt>
              <dd className="text-ink-2">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {children}
    </section>
  );
}

function Stage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("overflow-hidden rounded-xl border border-line", className)}
    >
      {children}
    </div>
  );
}

function CardStage({ children }: { children: ReactNode }) {
  return (
    <Stage className="flex min-h-[640px] items-center justify-center bg-ply-1 p-12">
      {children}
    </Stage>
  );
}

export function DitherMockupsFixture() {
  return (
    <div
      data-testid="dither-mockups"
      className="h-full overflow-y-auto bg-ply-0 text-ink-1"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-12 px-8 py-10">
        <header>
          <h1 className="text-ui-2xl font-semibold text-ink-1">
            Dither mockups
          </h1>
          <p className="mt-2 max-w-[72ch] text-ui-row text-pretty text-ink-2">
            Accent dither and display type for the landing and access pages, and
            dithered fills for the voice debug charts. Every field is still,
            decorative and kept off running text.
          </p>
        </header>

        <Variant
          label="Variant A — Horizon band"
          direction="Centred and editorial. A dithered horizon rises behind the screenshot only, so the product reads as lit from below; the copy sits on plain canvas above the light. The invite card carries a short horizon over its head with the server tile set on the line."
          specs={[
            {
              role: "Display",
              value:
                "Geist 600, 56–104px fluid, leading 0.94, tracking −0.045em, balanced, 12ch",
            },
            {
              role: "Lead-in",
              value: "13px 500 sentence case in ink-2, a lit talk LED",
            },
            { role: "Lead", value: "18/28 in ink-2, pretty wrap, 38ch" },
            {
              role: "Dither",
              value:
                "horizon painter, full ramp, 5px cells, dark sky so nothing lights above the shot",
            },
          ]}
        >
          <Stage>
            <HeroA />
          </Stage>
          <CardStage>
            <CardA />
          </CardStage>
        </Variant>

        <Variant
          label="Variant B — Edge panel"
          direction="Left-set and product-forward. The sign-in field returns as a full-height panel on the right edge; the chat screenshot straddles its seam and the copy never crosses it. The sign-up card uses the same field as a strip on its trailing edge."
          specs={[
            {
              role: "Display",
              value:
                "Geist 600, 48–80px fluid, leading 1.0, tracking −0.038em, balanced, 10ch",
            },
            { role: "Lead-in", value: "13px 500 sentence case in ink-3" },
            { role: "Lead", value: "17/28 in ink-2, pretty wrap, 36ch" },
            {
              role: "List",
              value: "44px rows on seams, 14px 500, ink-3 Bold glyphs",
            },
            {
              role: "Dither",
              value: "auth field, full ramp, 6px cells, panel only",
            },
          ]}
        >
          <Stage>
            <HeroB />
          </Stage>
          <CardStage>
            <CardB />
          </CardStage>
        </Variant>

        <Variant
          label="Variant C — Dithered type and rule"
          direction="Typographic poster. No field behind anything: one display word is set in two-ink accent dither and a single dithered rule divides the headline from the lead. The join card repeats it at small scale: a dithered lip and the room name in dither ink."
          specs={[
            {
              role: "Display",
              value:
                "Geist 600, 72–148px fluid, leading 0.88, tracking −0.055em, set in two lines",
            },
            {
              role: "Dither word",
              value:
                "two accent inks, each 4.5:1 or better on the ground (runtime check), 3px cells",
            },
            { role: "Lead", value: "18/28 in ink-2, pretty wrap, 34ch" },
            {
              role: "Rule",
              value: "12px strip, run-out painter, 3px cells (2px on the card)",
            },
          ]}
        >
          <Stage>
            <HeroC />
          </Stage>
          <CardStage>
            <CardC />
          </CardStage>
        </Variant>

        <Variant
          label="Voice debug — dithered charts"
          direction="Accent dither as chart fill. Every value is also text (current, min, average, max, guide) and the samples are a real table; the figure has a title and a written summary. Variant 1 is four small multiples of bars with a solid cap; variant 2 is one timeline with a lane per metric and loss as a heat strip."
          specs={[
            { role: "Fill", value: "4×4 Bayer patterns in --accent-ink" },
            {
              role: "Marks",
              value: "2px solid accent cap carries the value (3:1 or better)",
            },
            { role: "Readouts", value: "Geist Mono 500 tabular, 16–18px" },
            { role: "Labels", value: "13px 500 ink-1/ink-2, captions ink-3" },
          ]}
        >
          <Stage className="flex flex-wrap items-start justify-center gap-10 bg-ply-1 p-12">
            <div className="flex flex-col gap-3">
              <p className="text-ui-sm font-medium text-ink-2">
                Chart variant 1 — Small multiples
              </p>
              <DitherSmallMultiples
                title="Connection"
                status={STABLE}
                metrics={CONNECTION_METRICS}
                samples={SAMPLES}
                capacity={SAMPLE_COUNT}
                className="w-[600px]"
              />
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-ui-sm font-medium text-ink-2">
                Chart variant 2 — Timeline lanes
              </p>
              <DitherTimeline
                title="Audio uplink"
                meta="Opus"
                lanes={TIMELINE_LANES}
                samples={SAMPLES}
                capacity={SAMPLE_COUNT}
                className="w-[760px]"
              />
            </div>
          </Stage>
        </Variant>
      </div>
    </div>
  );
}
