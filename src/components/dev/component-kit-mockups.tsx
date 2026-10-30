/**
 * `/ui-fixtures?surface=component-kit&theme=<id>&part=kit|chat|settings|dialog`
 *
 * Component kit mockup for direction C (Poster): Bricolage Grotesque for
 * display and headings, Martian Mono as the panel's silkscreen, Geist for
 * running text. Each primitive is shown in two or three options (C1 / C2 /
 * C3) with idle, hover, focus, active and disabled states, then the picks
 * are composed into three real screens (chat, settings, a dialog over the
 * app). Mockup only: nothing in src/components/ui imports this file.
 *
 * Accessibility contract: every dither is aria-hidden, still (no rAF, no
 * loop, nothing to pause), never under running text and hidden under forced
 * colours. A dithered glyph needs both inks at 4.5:1 on the ground or it
 * falls back to solid accent. Text never goes below 11px; the silkscreen is
 * widened and emboldened on light grounds (the condensed mono that was hard
 * to read in C's first pass).
 */

import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/martian-mono/wdth.css";

import { DitherField } from "@/components/ui/DitherField";
import { Icon, type IconName } from "@/components/ui/icon";
import { Led, type LedState } from "@/components/ui/led";
import { useDitherGeometry } from "@/components/ui/use-dither-geometry";
import {
  isLightGround,
  mixHex,
  relativeLuminance,
  resolveCssColor,
} from "@/lib/auth-art";
import { rulePainter } from "@/lib/dither-painters";
import { cn } from "@/lib/utils";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// ── Type ─────────────────────────────────────────────────────────────────────

const GEIST = `"Geist Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
const GEIST_MONO = `"Geist Mono Variable", "Cascadia Mono", Consolas, ui-monospace, monospace`;
const BRICOLAGE = `"Bricolage Grotesque Variable", ${GEIST}`;
const MARTIAN = `"Martian Mono Variable", ${GEIST_MONO}`;

/** Wrapper variables: display and mono swap, body stays Geist. */
const KIT_VARS = {
  "--font-display": BRICOLAGE,
  "--font-mono": MARTIAN,
  "--font-ui": GEIST,
  "--font-sans": GEIST,
  fontFamily: GEIST,
} as CSSProperties;

/**
 * Silkscreen: Martian Mono, 11/14, uppercase. On dark grounds it runs at
 * wdth 90 and 500 (light-on-dark gains apparent weight). On light grounds
 * the `.ck-silk` rule below widens it to 100 and 600, which is the fix for
 * the condensed labels that were hard to read in C's first pass.
 */
const SILK =
  "ck-silk font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] uppercase [font-stretch:90%]";
/** Readouts: Martian Mono at normal width, tabular. */
const NUM = "font-mono tabular-nums [font-stretch:100%]";
/** Bricolage with optical sizing on. */
const DISPLAY =
  "font-display [font-optical-sizing:auto] [font-kerning:normal] text-ink-1";
/** Control label: Bricolage 600 at 15px. */
const CTRL = `${DISPLAY} text-[15px] leading-none font-semibold`;

const KIT_CSS = `
.ck-root .ck-silk { font-stretch: 90%; font-weight: 500; }
.light .ck-root .ck-silk,
.miku-light .ck-root .ck-silk,
.spiderman-light .ck-root .ck-silk { font-stretch: 100%; font-weight: 600; letter-spacing: 0.1em; }
.ck-root .ck-notch { clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%); }
.ck-root .ck-notch-sm { clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%); }
.ck-root .ck-notch-bl { clip-path: polygon(0 0, 100% 0, 100% 100%, 10px 100%, 0 calc(100% - 10px)); }
@media (forced-colors: active) { .ck-root [data-dither] { display: none !important; } }
`;

// ── Theme colours and static dither tiles ────────────────────────────────────

interface Roles {
  accent: string;
  ground: string;
  ink: string;
  primary: string;
  onPrimary: string;
}

function useRoles(): Roles | null {
  const [roles, setRoles] = useState<Roles | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const s = getComputedStyle(root);
      const get = (name: string) =>
        resolveCssColor(s.getPropertyValue(name).trim());
      const accent = get("--accent-ink");
      const ground = get("--ply-0");
      const ink = get("--ink-1");
      const primary = get("--primary-fill");
      const onPrimary = get("--on-primary");
      if (!accent || !ground || !ink || !primary || !onPrimary) return;
      setRoles((prev) =>
        prev &&
        prev.accent === accent &&
        prev.ground === ground &&
        prev.ink === ink &&
        prev.primary === primary
          ? prev
          : { accent, ground, ink, primary, onPrimary },
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
  return roles;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * One 4x4 Bayer tile of `ink` over a transparent ground at `coverage`
 * (0–1), as a data URL. Used as a repeating background with pixelated
 * scaling; a still image, so nothing runs.
 */
function bayerTile(ink: string, coverage: number): string | null {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 4;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = ink;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++)
      if (coverage > (BAYER4[y]![x]! + 0.5) / 16) ctx.fillRect(x, y, 1, 1);
  return c.toDataURL("image/png");
}

/** A left-to-right coverage ramp (for the fader range). */
function bayerRamp(
  ink: string,
  from: number,
  to: number,
  w = 64,
): string | null {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = 4;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = ink;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < w; x++) {
      const cov = from + (to - from) * (x / (w - 1));
      if (cov > (BAYER4[y]![x % 4]! + 0.5) / 16) ctx.fillRect(x, y, 1, 1);
    }
  return c.toDataURL("image/png");
}

function tileStyle(
  url: string | null,
  cell: number,
  extra?: CSSProperties,
): CSSProperties {
  if (!url) return extra ?? {};
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${4 * cell}px ${4 * cell}px`,
    backgroundRepeat: "repeat",
    imageRendering: "pixelated",
    ...extra,
  };
}

/** Which ink a decorative dither uses: accent on neutral plies, on-primary on the primary fill. */
type DitherInk = "accent" | "ink" | "onPrimary";

function useTile(ink: DitherInk, coverage: number) {
  const roles = useRoles();
  return useMemo(
    () => (roles ? bayerTile(roles[ink], coverage) : null),
    [roles, ink, coverage],
  );
}

/** A still dithered patch. Decorative; never carries text. */
function Dots({
  ink = "accent",
  coverage = 0.5,
  cell = 2,
  className,
  style,
}: {
  ink?: DitherInk;
  coverage?: number;
  cell?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const url = useTile(ink, coverage);
  return (
    <span
      aria-hidden="true"
      data-dither=""
      className={cn("pointer-events-none block", className)}
      style={tileStyle(url, cell, style)}
    />
  );
}

/** The dithered rule from C: a row of light running out from the left. */
function Rule({ className, cell = 3 }: { className?: string; cell?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const geometry = useDitherGeometry(ref);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-dither=""
      className={cn("pointer-events-none relative overflow-hidden", className)}
    >
      {geometry ? (
        <DitherField
          key={`${geometry.width}:${geometry.aspect}`}
          paint={rulePainter}
          cell={cell}
          contrast={1.1}
          style={{ background: "transparent" }}
        />
      ) : null}
    </div>
  );
}

const TEX_W = 192;
const TEX_H = 64;
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

function paintWordTexture(a: string, b: string): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  for (let y = 0; y < TEX_H; y++)
    for (let x = 0; x < TEX_W; x++) {
      const u = x / TEX_W;
      const v = y / TEX_H;
      const core = Math.exp(-((u - 0.3) ** 2 * 9 + (v - 0.35) ** 2 * 6));
      const field = 0.1 + 0.5 * (1 - u) * (1 - v * 0.6) + 0.45 * core;
      ctx.fillStyle = field > (BAYER8[y % 8]![x % 8]! + 0.5) / 64 ? b : a;
      ctx.fillRect(x, y, 1, 1);
    }
  return canvas.toDataURL("image/png");
}

/**
 * Two-ink accent dither clipped to a display word. Both inks must clear
 * 4.5:1 on the ground or the word stays solid accent; CanvasText under
 * forced colours.
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
  const roles = useRoles();
  const url = useMemo(() => {
    if (!roles) return null;
    const { accent, ground } = roles;
    const deep = isLightGround(ground)
      ? mixHex(accent, "#000000", 0.42)
      : mixHex(accent, "#ffffff", 0.62);
    if (
      contrastRatio(accent, ground) < 4.5 ||
      contrastRatio(deep, ground) < 4.5
    )
      return null;
    return paintWordTexture(accent, deep);
  }, [roles]);
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

// ── State demo plumbing ──────────────────────────────────────────────────────

type Demo = "idle" | "hover" | "focus" | "active" | "disabled";
const DEMOS: Demo[] = ["idle", "hover", "focus", "active", "disabled"];

const FOCUS =
  "focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const FOCUS_ON = "outline-2 outline-offset-2 outline-focus";
/** Hover and press overlay: currentColor at 8 / 14 percent, opacity only. */
const OVERLAY =
  "relative select-none transition-[scale] duration-100 ease-out after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-current after:opacity-0 after:transition-opacity after:duration-100 pointer-fine:hover:enabled:after:opacity-(--hover-o) enabled:active:after:opacity-(--press-o) enabled:active:scale-[0.97] [--hover-o:0.08] [--press-o:0.14] motion-reduce:transition-none";

function demoClass(demo: Demo | undefined, opts?: { ring?: boolean }) {
  switch (demo) {
    case "hover":
      return "after:opacity-(--hover-o)!";
    case "active":
      return "after:opacity-(--press-o)! scale-[0.97]";
    case "focus":
      return opts?.ring === false ? "" : FOCUS_ON;
    default:
      return "";
  }
}

// ── Buttons ──────────────────────────────────────────────────────────────────

type ButtonKind = "primary" | "secondary" | "ghost" | "danger" | "icon";
type Opt = 1 | 2 | 3;

const KEY_BASE = `${OVERLAY} ${FOCUS} inline-flex h-12 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[2px] px-5 ${CTRL} disabled:cursor-not-allowed`;

const KEY_KIND: Record<ButtonKind, string> = {
  primary:
    "bg-primary-fill text-on-primary [--hover-o:0.12] disabled:bg-tint-2 disabled:text-ink-3",
  secondary:
    "border-2 border-ink-1 bg-transparent text-ink-1 disabled:border-line-strong disabled:text-ink-3",
  ghost: "bg-transparent text-ink-1 disabled:text-ink-3",
  danger:
    "bg-danger-fill text-on-danger [--hover-o:0.12] disabled:bg-tint-2 disabled:text-ink-3",
  icon: "w-12 px-0 bg-tint-2 text-ink-1 disabled:text-ink-3",
};

function KitButton({
  opt,
  kind,
  demo,
  children,
  icon,
  className,
}: {
  opt: Opt;
  kind: ButtonKind;
  demo?: Demo;
  children?: ReactNode;
  icon?: IconName;
  className?: string;
}) {
  const disabled = demo === "disabled";
  const content = (
    <>
      {icon ? <Icon name={icon} size={kind === "icon" ? "lg" : "sm"} /> : null}
      {kind === "icon" ? null : children}
    </>
  );

  if (opt === 3) {
    // C3 Rule: no box. A 2px ink rule under a bold label; primary carries a
    // solid key cap for its glyph; hover and focus move the rule to accent.
    const rule =
      kind === "danger"
        ? "border-danger-ink text-danger-ink"
        : "border-ink-1 text-ink-1";
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={kind === "icon" ? "More" : undefined}
        className={cn(
          OVERLAY,
          FOCUS,
          "inline-flex h-12 items-center gap-3 rounded-[2px] border-b-2 px-1 after:hidden",
          DISPLAY,
          "text-[16px] leading-none font-bold",
          rule,
          kind === "ghost" && "border-transparent",
          kind === "secondary" && "border-line-strong",
          demo === "hover" && "border-accent-ink",
          demo === "focus" && FOCUS_ON,
          demo === "active" && "scale-[0.97] border-accent-ink",
          "disabled:cursor-not-allowed disabled:border-line-strong disabled:text-ink-3",
          className,
        )}
      >
        {kind === "primary" ? (
          <span
            aria-hidden="true"
            className="inline-flex size-7 items-center justify-center bg-primary-fill text-on-primary"
          >
            <Icon name={icon ?? "arrowRight"} size="sm" />
          </span>
        ) : icon ? (
          <Icon name={icon} size={kind === "icon" ? "lg" : "sm"} />
        ) : null}
        {kind === "icon" ? null : children}
      </button>
    );
  }

  const button = (
    <button
      type="button"
      disabled={disabled}
      aria-label={kind === "icon" ? "More" : undefined}
      className={cn(
        KEY_BASE,
        KEY_KIND[kind],
        opt === 2 && kind !== "ghost" && "ck-notch",
        opt === 2 && kind !== "ghost" && kind !== "icon" && "pr-3",
        demoClass(demo, { ring: opt !== 2 }),
        className,
      )}
    >
      {content}
      {opt === 2 && kind !== "ghost" && kind !== "icon" && !disabled ? (
        // The trailing cap: a dithered strip after the label, never under it.
        <Dots
          ink={
            kind === "primary"
              ? "onPrimary"
              : kind === "danger"
                ? "onPrimary"
                : "accent"
          }
          coverage={0.45}
          cell={2}
          className="ml-2 h-6 w-3 self-center"
        />
      ) : null}
    </button>
  );
  if (opt === 2 && kind !== "ghost") {
    // clip-path would cut an outline, so the focus ring sits on a wrapper.
    return (
      <span
        className={cn(
          "inline-flex rounded-[2px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
          demo === "focus" && FOCUS_ON,
        )}
      >
        {button}
      </span>
    );
  }
  return button;
}

// ── Fields ───────────────────────────────────────────────────────────────────

type FieldKind = "input" | "select" | "search";

function KitField({
  opt,
  kind,
  demo,
  label,
  value,
  placeholder,
  id,
  className,
}: {
  opt: Opt;
  kind: FieldKind;
  demo?: Demo;
  label: string;
  value?: string;
  placeholder?: string;
  id: string;
  className?: string;
}) {
  const disabled = demo === "disabled";
  const focused = demo === "focus";
  const hovered = demo === "hover" || demo === "active";

  const control = (() => {
    const base = cn(
      "peer h-12 w-full min-w-0 bg-transparent text-[15px] leading-none text-ink-1 focus:outline-none placeholder:text-ink-3 disabled:cursor-not-allowed disabled:text-ink-3",
      NUM.replace("font-mono ", ""),
      kind === "search"
        ? "pr-12 pl-11"
        : kind === "select"
          ? "pr-11 pl-4"
          : "px-4",
      opt === 1 && "px-0",
      opt === 1 && kind === "search" && "pl-7",
    );
    if (kind === "select") {
      return (
        <select
          id={id}
          disabled={disabled}
          defaultValue={value}
          className={cn(base, "appearance-none")}
        >
          <option>{value}</option>
          <option>Built-in microphone</option>
        </select>
      );
    }
    return (
      <input
        id={id}
        type={kind === "search" ? "search" : "text"}
        disabled={disabled}
        defaultValue={value}
        placeholder={placeholder}
        className={base}
      />
    );
  })();

  const adornments = (
    <>
      {kind === "search" ? (
        <Icon
          name="search"
          size="sm"
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-3",
            opt === 1 ? "left-0" : "left-4",
          )}
        />
      ) : null}
      {kind === "search" ? (
        <KitKbd
          opt={1}
          className={cn(
            "absolute top-1/2 -translate-y-1/2",
            opt === 1 ? "right-0" : "right-3",
          )}
        >
          /
        </KitKbd>
      ) : null}
      {kind === "select" ? (
        <Icon
          name="chevronDown"
          size="sm"
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-2",
            opt === 1 ? "right-0" : "right-4",
          )}
        />
      ) : null}
    </>
  );

  if (opt === 1) {
    // C1 Underline: no box; a 2px rule that turns ink on hover and accent on focus.
    return (
      <div
        className={cn(
          "flex flex-col gap-2",
          disabled && "opacity-60",
          className,
        )}
      >
        <label htmlFor={id} className={cn(SILK, "text-ink-2")}>
          {label}
        </label>
        <div
          className={cn(
            "relative border-b-2 border-line-field transition-colors duration-100 has-[:hover]:border-ink-2 has-[:focus-visible]:border-accent-ink",
            hovered && "border-ink-2",
            focused && "border-accent-ink",
          )}
        >
          {control}
          {adornments}
        </div>
      </div>
    );
  }

  if (opt === 2) {
    // C2 Legend plate: a ply-2 plate with its label printed across the top edge.
    return (
      <div className={cn("relative pt-2", disabled && "opacity-60", className)}>
        <label
          htmlFor={id}
          className={cn(
            SILK,
            "absolute top-0 left-3 z-10 bg-(--ck-ground,var(--ply-0)) px-1 text-ink-2",
            focused && "text-accent-ink",
          )}
        >
          {label}
        </label>
        <div
          className={cn(
            "relative rounded-[2px] border border-line-field bg-ply-2 transition-colors duration-100 has-[:hover]:border-ink-2 has-[:focus-visible]:border-ink-1 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ink-1",
            hovered && "border-ink-2",
            focused && "border-ink-1 ring-1 ring-ink-1",
          )}
        >
          {control}
          {adornments}
        </div>
      </div>
    );
  }

  // C3 Brackets: four corner brackets, like a viewfinder; accent when focused.
  const b = cn(
    "pointer-events-none absolute size-3 border-ink-2 transition-colors duration-100",
    hovered && "border-ink-1",
    focused && "border-accent-ink",
  );
  return (
    <div
      className={cn("flex flex-col gap-2", disabled && "opacity-60", className)}
    >
      <label htmlFor={id} className={cn(SILK, "text-ink-2")}>
        {label}
      </label>
      <div className="group/f relative">
        <span
          aria-hidden="true"
          className={cn(
            b,
            "top-0 left-0 border-t-2 border-l-2 group-has-[:focus-visible]/f:border-accent-ink",
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            b,
            "top-0 right-0 border-t-2 border-r-2 group-has-[:focus-visible]/f:border-accent-ink",
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            b,
            "bottom-0 left-0 border-b-2 border-l-2 group-has-[:focus-visible]/f:border-accent-ink",
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            b,
            "right-0 bottom-0 border-r-2 border-b-2 group-has-[:focus-visible]/f:border-accent-ink",
          )}
        />
        {control}
        {adornments}
      </div>
    </div>
  );
}

// ── Switch, checkbox, radio, segmented ───────────────────────────────────────

function KitSwitch({
  opt,
  on,
  demo,
  label,
  className,
}: {
  opt: Opt;
  on: boolean;
  demo?: Demo;
  label: string;
  className?: string;
}) {
  const disabled = demo === "disabled";
  if (opt === 3) {
    // C3 Segmented ON / OFF: two silkscreen cells inside a 2px ink rail.
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        className={cn(
          FOCUS,
          "inline-grid h-8 grid-cols-2 overflow-hidden rounded-[2px] border-2 border-ink-1 disabled:cursor-not-allowed disabled:border-line-strong disabled:opacity-60",
          demo === "focus" && FOCUS_ON,
          demo === "active" && "scale-[0.97]",
          className,
        )}
      >
        <span
          className={cn(
            SILK,
            "flex items-center px-2.5",
            !on ? "bg-primary-fill text-on-primary" : "text-ink-3",
            demo === "hover" && on && "bg-tint-1",
          )}
        >
          Off
        </span>
        <span
          className={cn(
            SILK,
            "flex items-center px-2.5",
            on ? "bg-primary-fill text-on-primary" : "text-ink-3",
            demo === "hover" && !on && "bg-tint-1",
          )}
        >
          On
        </span>
      </button>
    );
  }
  const dither = opt === 2;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={cn(
        FOCUS,
        "relative inline-flex h-7 w-14 shrink-0 items-center rounded-[2px] transition-[scale] duration-100 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
        dither
          ? "border-2 border-ink-1 bg-transparent"
          : on
            ? "bg-primary-fill"
            : "bg-tint-3",
        demo === "focus" && FOCUS_ON,
        demo === "active" && "scale-[0.97]",
        demo === "hover" && !dither && (on ? "opacity-90" : "bg-line-field"),
        className,
      )}
    >
      {dither && on ? (
        <Dots
          ink="accent"
          coverage={0.5}
          cell={2}
          className="absolute inset-0.5 right-6"
        />
      ) : null}
      {!dither ? (
        // C1: a talk LED in the track that lights when the switch is on.
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-1/2 left-2 flex -translate-y-1/2",
            !on && "opacity-0",
          )}
        >
          <Led state="talk" size={6} />
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1 bottom-1 w-5 rounded-[1px] transition-[translate] duration-150 ease-out motion-reduce:transition-none",
          dither ? "bg-ink-1" : on ? "bg-on-primary" : "bg-ink-2",
          on ? "translate-x-[30px]" : "translate-x-1",
          dither && (on ? "translate-x-[30px]" : "translate-x-0.5"),
        )}
      />
    </button>
  );
}

function KitCheckbox({
  opt,
  checked,
  demo,
  label,
}: {
  opt: Opt;
  checked: boolean;
  demo?: Demo;
  label: string;
}) {
  const disabled = demo === "disabled";
  const box = cn(
    FOCUS,
    "relative inline-flex size-6 shrink-0 items-center justify-center rounded-[2px] border-2 transition-[scale] duration-100 disabled:cursor-not-allowed motion-reduce:transition-none",
    checked
      ? "border-primary-fill bg-primary-fill text-on-primary"
      : "border-ink-2 bg-transparent",
    opt === 2 && "ck-notch-sm",
    opt === 3 && "size-7",
    demo === "hover" && !checked && "border-ink-1 bg-tint-1",
    demo === "hover" && checked && "opacity-90",
    demo === "active" && "scale-[0.92]",
    disabled && "opacity-45",
  );
  const inner =
    opt === 3 ? (
      // C3 DIP: a solid ink block, no glyph.
      checked ? (
        <span aria-hidden="true" className="size-3 bg-on-primary" />
      ) : null
    ) : checked ? (
      <Icon name="check" state="active" size="sm" />
    ) : null;
  const control = (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      className={cn(box, demo === "focus" && opt !== 2 && FOCUS_ON)}
    >
      {inner}
    </button>
  );
  return (
    <label
      className={cn(
        "inline-flex h-12 items-center gap-3 text-[14px] font-medium text-ink-1",
        disabled && "text-ink-3",
      )}
    >
      {opt === 2 ? (
        <span
          className={cn(
            "inline-flex rounded-[2px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
            demo === "focus" && FOCUS_ON,
          )}
        >
          {control}
        </span>
      ) : (
        control
      )}
      {label}
    </label>
  );
}

function KitRadio({
  opt,
  checked,
  demo,
  label,
}: {
  opt: 1 | 2;
  checked: boolean;
  demo?: Demo;
  label: string;
}) {
  const disabled = demo === "disabled";
  return (
    <label
      className={cn(
        "inline-flex h-12 items-center gap-3 text-[14px] font-medium text-ink-1",
        disabled && "text-ink-3",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        disabled={disabled}
        className={cn(
          FOCUS,
          "relative inline-flex size-6 shrink-0 items-center justify-center border-2 transition-[scale] duration-100 disabled:cursor-not-allowed motion-reduce:transition-none",
          opt === 1 ? "rounded-full" : "rounded-[2px]",
          checked ? "border-ink-1" : "border-ink-2",
          demo === "hover" && "border-ink-1 bg-tint-1",
          demo === "active" && "scale-[0.92]",
          demo === "focus" && FOCUS_ON,
          disabled && "opacity-45",
        )}
      >
        {checked ? (
          <span
            aria-hidden="true"
            className={cn("size-2.5 bg-ink-1", opt === 1 ? "rounded-full" : "")}
          />
        ) : null}
      </button>
      {label}
    </label>
  );
}

function KitSegmented({
  items,
  value,
  demo,
  label,
  size = "md",
  className,
}: {
  items: string[];
  value: string;
  demo?: Demo;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const disabled = demo === "disabled";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-grid overflow-hidden rounded-[2px] border-2 border-ink-1 bg-ply-0",
        disabled && "border-line-strong opacity-60",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item, i) => {
        const on = item === value;
        return (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            className={cn(
              OVERLAY,
              "-outline-offset-4 focus:outline-none focus-visible:outline-2 focus-visible:outline-focus",
              size === "md" ? cn(CTRL, "h-12 px-4") : cn(SILK, "h-8 px-3"),
              "inline-flex items-center justify-center whitespace-nowrap disabled:cursor-not-allowed",
              i > 0 && "border-l-2 border-ink-1",
              disabled && "border-line-strong",
              on ? "bg-primary-fill text-on-primary" : "text-ink-2",
              demo === "hover" &&
                !on &&
                i === 1 &&
                "after:opacity-(--hover-o)!",
              demo === "focus" && on && "outline-2 outline-focus",
            )}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function KitTabs({
  opt,
  items,
  value,
  demo,
  className,
}: {
  opt: 1 | 2;
  items: string[];
  value: string;
  demo?: Demo;
  className?: string;
}) {
  if (opt === 2) {
    // C2 Index tabs: numbered cells on a 2px rule, the active one lit in ink.
    return (
      <div
        role="tablist"
        className={cn("grid", className)}
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {items.map((item, i) => {
          const on = item === value;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={on}
              className={cn(
                FOCUS,
                "flex h-14 flex-col justify-end gap-1 border-t-2 px-3 pb-2 text-left transition-colors duration-100 -outline-offset-2",
                on
                  ? "border-ink-1 text-ink-1"
                  : "border-line-strong text-ink-3 hover:border-ink-2 hover:text-ink-2",
                demo === "hover" && !on && i === 1 && "border-ink-2 text-ink-2",
                demo === "focus" && on && "outline-2 outline-focus",
              )}
            >
              <span className={cn(SILK, on ? "text-accent-ink" : "")}>
                0{i + 1}
              </span>
              <span
                className={cn(
                  DISPLAY,
                  "text-[17px] leading-5 font-bold",
                  !on && "text-inherit",
                )}
              >
                {item}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div
      role="tablist"
      className={cn("flex gap-6 border-b border-line", className)}
    >
      {items.map((item, i) => {
        const on = item === value;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={on}
            className={cn(
              FOCUS,
              DISPLAY,
              "-mb-px h-12 border-b-2 text-[16px] font-semibold transition-colors duration-100 -outline-offset-2",
              on
                ? "border-ink-1 text-ink-1"
                : "border-transparent text-ink-3 hover:text-ink-1",
              demo === "hover" && !on && i === 1 && "text-ink-1",
              demo === "focus" && on && "outline-2 outline-focus",
            )}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

// ── Badges and LEDs ──────────────────────────────────────────────────────────

function KitCount({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        NUM,
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[2px] bg-badge px-1 text-[11px] leading-none font-semibold text-on-badge",
        className,
      )}
    >
      {children}
    </span>
  );
}

function KitStatus({
  state,
  children,
  className,
}: {
  state: LedState;
  children: ReactNode;
  className?: string;
}) {
  const ink: Record<LedState, string> = {
    talk: "text-success-ink",
    live: "text-live-ink",
    muted: "text-danger-ink",
    idle: "text-warning-ink",
    off: "text-ink-3",
  };
  return (
    <span
      className={cn(
        SILK,
        "inline-flex h-6 items-center gap-2",
        ink[state],
        className,
      )}
    >
      <Led state={state} size={6} />
      {children}
    </span>
  );
}

function KitTag({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        SILK,
        "inline-flex h-6 items-center gap-2 text-ink-1",
        className,
      )}
    >
      <Dots ink="accent" coverage={0.6} cell={2} className="size-3" />
      {children}
    </span>
  );
}

// ── Kbd ──────────────────────────────────────────────────────────────────────

function KitKbd({
  opt,
  children,
  className,
}: {
  opt: Opt;
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        NUM,
        "inline-flex h-6 min-w-6 items-center justify-center px-1.5 text-[11px] font-semibold",
        opt === 1 &&
          "rounded-[2px] border-b-2 border-ink-2 bg-tint-2 text-ink-1",
        opt === 2 && "rounded-[2px] border border-line-strong text-ink-2",
        opt === 3 && "rounded-[2px] bg-ink-1 text-ply-0",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

// ── Menu and tooltip ─────────────────────────────────────────────────────────

interface MenuRow {
  icon?: IconName;
  label: string;
  hint?: string;
  led?: LedState;
  danger?: boolean;
  highlight?: boolean;
}

function KitMenu({
  opt,
  title,
  rows,
  className,
}: {
  opt: Opt;
  title: string;
  rows: MenuRow[];
  className?: string;
}) {
  const big = opt === 3;
  return (
    <div
      role="menu"
      className={cn(
        "w-64 rounded-[2px] border border-line-strong border-t-2 border-t-ink-1 bg-ply-3 p-1 shadow-float",
        big && "w-72",
        className,
      )}
    >
      <p
        className={cn(
          SILK,
          "flex h-8 items-center justify-between px-3 text-ink-3",
        )}
      >
        {title}
        {opt === 2 ? (
          <span className="text-ink-off">{rows.length} items</span>
        ) : null}
      </p>
      {rows.map((row, i) => (
        <button
          key={row.label}
          type="button"
          role="menuitem"
          className={cn(
            FOCUS,
            "flex w-full items-center gap-3 rounded-[2px] px-3 text-left -outline-offset-2 hover:bg-tint-2",
            big ? "h-11" : "h-9",
            row.highlight && "bg-tint-2",
            row.danger ? "text-danger-ink" : "text-ink-1",
            i === rows.length - 1 &&
              row.danger &&
              "mt-1 border-t border-line pt-px",
          )}
        >
          {opt === 2 ? (
            <span className={cn(SILK, "w-5 text-ink-3")}>0{i + 1}</span>
          ) : row.icon ? (
            <Icon
              name={row.icon}
              size="sm"
              className={row.danger ? "" : "text-ink-2"}
            />
          ) : (
            <span className="w-4" />
          )}
          <span
            className={cn(
              big
                ? cn(DISPLAY, "text-[15px] font-semibold")
                : "text-[14px] font-medium",
              "flex-1 truncate",
              row.danger && "text-danger-ink",
            )}
          >
            {row.label}
          </span>
          {row.led ? <Led state={row.led} size={6} /> : null}
          {row.hint ? (
            opt === 1 ? (
              <span className={cn(SILK, "text-ink-3 normal-case")}>
                {row.hint}
              </span>
            ) : (
              <KitKbd opt={2}>{row.hint}</KitKbd>
            )
          ) : null}
        </button>
      ))}
    </div>
  );
}

function KitTooltip({
  opt,
  children,
  hint,
}: {
  opt: Opt;
  children: ReactNode;
  hint?: string;
}) {
  if (opt === 2)
    return (
      <span
        role="tooltip"
        className={cn(
          SILK,
          "inline-flex h-7 items-center gap-2 rounded-[2px] bg-ink-1 px-2 text-ply-0",
        )}
      >
        {children}
        {hint ? <span className="opacity-70">{hint}</span> : null}
      </span>
    );
  if (opt === 3)
    return (
      <span
        role="tooltip"
        className="inline-flex h-7 items-center gap-2 rounded-[2px] border border-line-strong bg-ply-3 px-2 text-[12px] font-medium text-ink-1 shadow-float"
      >
        {children}
        {hint ? <KitKbd opt={2}>{hint}</KitKbd> : null}
      </span>
    );
  return (
    <span
      role="tooltip"
      className="inline-flex h-7 items-center gap-2 rounded-[2px] bg-ink-1 px-2 text-[12px] font-medium text-ply-0"
    >
      {children}
      {hint ? (
        <kbd
          className={cn(
            NUM,
            "inline-flex h-4 min-w-4 items-center justify-center rounded-[2px] bg-ply-0/20 px-1 text-[11px] font-semibold",
          )}
        >
          {hint}
        </kbd>
      ) : null}
    </span>
  );
}

// ── Dialog, toast ────────────────────────────────────────────────────────────

function CloseKey({ className }: { className?: string }) {
  return (
    <button
      type="button"
      aria-label="Close"
      className={cn(
        OVERLAY,
        FOCUS,
        "inline-flex size-10 shrink-0 items-center justify-center rounded-[2px] bg-tint-2 text-ink-1",
        className,
      )}
    >
      <Icon name="close" size="md" />
    </button>
  );
}

function KitDialog({
  opt,
  kicker,
  title,
  titleLast,
  children,
  actions,
  className,
}: {
  opt: Opt;
  kicker: string;
  title: string;
  /** C2 only: the last word, set in dither. */
  titleLast?: string;
  children: ReactNode;
  actions: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`dlg-${opt}`}
      className={cn(
        "w-full max-w-[520px] rounded-[2px] border border-line-strong bg-ply-3 shadow-modal [--ck-ground:var(--ply-3)]",
        opt === 3 && "border-t-2 border-t-ink-1",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4 px-6 pt-5">
        <p className={cn(SILK, "text-ink-3")}>{kicker}</p>
        <CloseKey />
      </div>
      <div className="px-6 pt-4">
        <h2
          id={`dlg-${opt}`}
          className={cn(
            DISPLAY,
            "text-balance",
            opt === 2
              ? "text-[40px] leading-[0.92] font-extrabold tracking-[-0.04em]"
              : opt === 3
                ? "text-[22px] leading-7 font-bold tracking-[-0.01em]"
                : "text-[28px] leading-8 font-extrabold tracking-[-0.03em]",
          )}
        >
          {title}
          {titleLast ? (
            <>
              {" "}
              <DitherWord cell={3}>{titleLast}</DitherWord>
            </>
          ) : null}
        </h2>
        {opt === 1 ? <Rule className="mt-4 h-2" cell={2} /> : null}
        <div className="mt-4 text-[15px] leading-[22px] text-pretty text-ink-2">
          {children}
        </div>
      </div>
      <div
        className={cn(
          "mt-6 flex flex-col-reverse gap-2 border-t border-line p-4 max-sm:[&>*]:w-full max-sm:[&_button]:w-full sm:flex-row sm:justify-end sm:px-6",
          opt === 2 && "border-t-0 pt-0",
        )}
      >
        {actions}
      </div>
    </div>
  );
}

function KitToast({
  opt,
  led,
  title,
  body,
  action,
  className,
}: {
  opt: Opt;
  led: LedState;
  title: string;
  body: string;
  action?: string;
  className?: string;
}) {
  const inverted = opt === 2;
  return (
    <div
      role="status"
      className={cn(
        "relative w-[360px] max-w-full overflow-hidden rounded-[2px] border shadow-float",
        inverted
          ? "border-ink-1 bg-ink-1 text-ply-0"
          : "border-line-strong bg-ply-3 text-ink-1",
        opt === 3 && "ck-notch",
        className,
      )}
    >
      <div className="flex items-start gap-3 p-4 pr-3">
        <Led state={led} size={8} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              DISPLAY,
              "text-[15px] leading-5 font-bold",
              inverted && "text-ply-0",
            )}
          >
            {title}
          </p>
          <p
            className={cn(
              "mt-1 text-[13px] leading-[18px] text-pretty",
              inverted ? "text-ply-0/80" : "text-ink-2",
            )}
          >
            {body}
          </p>
          {action ? (
            <button
              type="button"
              className={cn(
                SILK,
                FOCUS,
                "mt-3 inline-flex h-8 items-center rounded-[2px] border-b-2",
                inverted
                  ? "border-ply-0 text-ply-0"
                  : "border-ink-1 text-ink-1",
              )}
            >
              {action}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          className={cn(
            FOCUS,
            "-mt-1 -mr-1 inline-flex size-8 items-center justify-center rounded-[2px]",
            inverted ? "text-ply-0/70" : "text-ink-3",
          )}
        >
          <Icon name="close" size="sm" />
        </button>
      </div>
      {opt === 1 ? (
        // Time left: a still dithered bar (would shrink in 1s steps, never a loop).
        <Dots ink="accent" coverage={0.6} cell={2} className="h-1 w-[62%]" />
      ) : null}
    </div>
  );
}

// ── Card and rows ────────────────────────────────────────────────────────────

function KitCard({
  opt,
  legend,
  title,
  index,
  children,
  className,
}: {
  opt: Opt;
  legend: string;
  title?: string;
  index?: string;
  children: ReactNode;
  className?: string;
}) {
  if (opt === 2) {
    // C2 Rule card: no fill. A 2px ink rule, a legend, a bold title.
    return (
      <section className={cn("border-t-2 border-ink-1 pt-3", className)}>
        <div className="flex items-baseline justify-between gap-4">
          <p className={cn(SILK, "text-ink-3")}>{legend}</p>
          {index ? <p className={cn(SILK, "text-ink-3")}>{index}</p> : null}
        </div>
        {title ? (
          <h3
            className={cn(
              DISPLAY,
              "mt-2 text-[20px] leading-6 font-bold tracking-[-0.01em]",
            )}
          >
            {title}
          </h3>
        ) : null}
        <div className="mt-3">{children}</div>
      </section>
    );
  }
  if (opt === 3) {
    return (
      <section
        className={cn(
          "ck-notch relative rounded-[2px] bg-ply-2 p-4",
          className,
        )}
      >
        <div className="flex items-baseline justify-between gap-4">
          <p className={cn(SILK, "text-ink-3")}>{legend}</p>
          {index ? (
            <p
              className={cn(
                DISPLAY,
                "text-[22px] leading-none font-extrabold text-ink-3",
              )}
            >
              {index}
            </p>
          ) : null}
        </div>
        {title ? (
          <h3 className={cn(DISPLAY, "mt-2 text-[18px] leading-6 font-bold")}>
            {title}
          </h3>
        ) : null}
        <div className="mt-3">{children}</div>
      </section>
    );
  }
  return (
    <section
      className={cn(
        "relative mt-2 rounded-[2px] border border-line-strong bg-ply-2 p-4 pt-5 [--ck-ground:var(--ply-2)]",
        className,
      )}
    >
      <p
        className={cn(
          SILK,
          "absolute -top-[7px] left-3 bg-ply-0 px-1 text-ink-2",
        )}
      >
        {legend}
      </p>
      {title ? (
        <h3 className={cn(DISPLAY, "text-[18px] leading-6 font-bold")}>
          {title}
        </h3>
      ) : null}
      <div className={title ? "mt-3" : ""}>{children}</div>
    </section>
  );
}

function KitRow({
  avatar,
  name,
  meta,
  led,
  trailing,
  selected,
  className,
}: {
  avatar: ReactNode;
  name: string;
  meta?: string;
  led?: LedState;
  trailing?: ReactNode;
  selected?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-12 items-center gap-3 rounded-[2px] px-2",
        selected && "bg-tint-2",
        className,
      )}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] leading-5 font-medium text-ink-1">
          {name}
        </p>
        {meta ? (
          <p className="truncate text-[12px] leading-4 text-ink-3">{meta}</p>
        ) : null}
      </div>
      {led ? <Led state={led} size={6} /> : null}
      {trailing}
    </div>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────

function KitAvatar({
  opt,
  initial,
  presence,
  size = 40,
  speaking,
  className,
}: {
  opt: Opt;
  initial: string;
  presence?: LedState;
  size?: 24 | 32 | 40 | 56;
  speaking?: boolean;
  className?: string;
}) {
  const round = opt === 2 ? "rounded-full" : "rounded-[2px]";
  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-full items-center justify-center bg-tint-3",
          DISPLAY,
          "font-extrabold",
          round,
          opt === 3 && "ck-notch-sm",
          size >= 40
            ? "text-[18px]"
            : size >= 32
              ? "text-[14px]"
              : "text-[11px]",
          speaking && "outline-2 outline-offset-[-2px] outline-talk",
        )}
      >
        {initial}
      </span>
      {presence ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -right-0.5 -bottom-0.5 flex items-center justify-center bg-(--ck-ground,var(--ply-0))",
            round,
            size >= 40 ? "size-3.5" : "size-3",
          )}
        >
          <Led state={presence} size={size >= 40 ? 8 : 6} />
        </span>
      ) : null}
    </span>
  );
}

// ── Slider ───────────────────────────────────────────────────────────────────

function KitSlider({
  opt,
  value,
  demo,
  label,
  className,
}: {
  opt: Opt;
  value: number;
  demo?: Demo;
  label: string;
  className?: string;
}) {
  const roles = useRoles();
  const ramp = useMemo(
    () => (roles ? bayerRamp(roles.accent, 0.3, 1) : null),
    [roles],
  );
  const disabled = demo === "disabled";
  const pct = `${value}%`;
  const thumb = cn(
    FOCUS,
    "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[scale] duration-100 motion-reduce:transition-none",
    demo === "focus" && FOCUS_ON,
    demo === "hover" && "scale-110",
    demo === "active" && "scale-125",
  );
  if (opt === 3) {
    // C3 Bar meter: twenty cells, lit in accent up to the value.
    const cells = Array.from(
      { length: 20 },
      (_, i) => i < Math.round(value / 5),
    );
    return (
      <div
        className={cn(
          "flex items-center gap-4",
          disabled && "opacity-45",
          className,
        )}
      >
        <div
          role="slider"
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={disabled ? -1 : 0}
          className={cn(
            FOCUS,
            "flex h-6 flex-1 items-center gap-[3px] rounded-[2px]",
            demo === "focus" && FOCUS_ON,
          )}
        >
          {cells.map((on, i) => (
            <span
              key={i}
              className={cn(
                "h-4 flex-1 rounded-[1px]",
                on ? "bg-accent-ink" : "bg-tint-3",
              )}
            />
          ))}
        </div>
        <span
          className={cn(
            NUM,
            "w-10 text-right text-[13px] font-semibold text-ink-1",
          )}
        >
          {pct}
        </span>
      </div>
    );
  }
  const ticks = opt === 2;
  return (
    <div
      className={cn(
        "flex items-center gap-4",
        disabled && "opacity-45",
        className,
      )}
    >
      <div className="relative h-8 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-[1px] bg-tint-3">
          {opt === 1 ? (
            <span
              aria-hidden="true"
              data-dither=""
              className="absolute inset-y-0 left-0"
              style={{
                width: pct,
                ...(ramp
                  ? {
                      backgroundImage: `url(${ramp})`,
                      backgroundSize: "100% 8px",
                      imageRendering: "pixelated",
                    }
                  : { background: "var(--accent-ink)" }),
              }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 bg-primary-fill"
              style={{ width: pct }}
            />
          )}
        </div>
        {ticks ? (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-1/2 flex translate-y-[7px] justify-between px-px"
          >
            {Array.from({ length: 11 }, (_, i) => (
              <span
                key={i}
                className={cn("w-px bg-ink-3", i % 5 === 0 ? "h-2" : "h-1")}
              />
            ))}
          </div>
        ) : null}
        <span
          role="slider"
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={disabled ? -1 : 0}
          className={cn(
            thumb,
            opt === 1
              ? "h-7 w-3 rounded-[2px] bg-ink-1 shadow-xs"
              : "size-5 rounded-[2px] bg-ink-1 shadow-xs",
          )}
          style={{ left: pct }}
        />
      </div>
      <span
        className={cn(
          NUM,
          "w-10 text-right text-[13px] font-semibold text-ink-1",
        )}
      >
        {pct}
      </span>
    </div>
  );
}

// ── Sheet chrome ─────────────────────────────────────────────────────────────

function Section({
  index,
  title,
  pick,
  children,
}: {
  index: string;
  title: string;
  pick: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t-2 border-ink-1 px-4 py-8 md:px-10">
      <div className="grid gap-4 md:grid-cols-12">
        <div className="md:col-span-3">
          <p
            className={cn(
              DISPLAY,
              "text-[40px] leading-none font-extrabold tracking-[-0.04em] text-ink-3",
            )}
          >
            {index}
          </p>
          <h2
            className={cn(
              DISPLAY,
              "mt-2 text-[24px] leading-7 font-bold tracking-[-0.02em]",
            )}
          >
            {title}
          </h2>
          <p className="mt-3 max-w-[30ch] text-[13px] leading-[18px] text-pretty text-ink-2">
            <span className={cn(SILK, "text-accent-ink")}>Pick</span> {pick}
          </p>
        </div>
        <div className="flex flex-col gap-8 md:col-span-9">{children}</div>
      </div>
    </section>
  );
}

function Option({
  id,
  name,
  note,
  children,
}: {
  id: string;
  name: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="flex items-baseline gap-3">
        <span className={cn(SILK, "text-ink-1")}>{id}</span>
        <span className={cn(DISPLAY, "text-[15px] font-bold")}>{name}</span>
        {note ? <span className="text-[12px] text-ink-3">{note}</span> : null}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** One row per state, labelled in silkscreen. */
function States({
  render,
  states = DEMOS,
}: {
  render: (demo: Demo) => ReactNode;
  states?: Demo[];
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
      {states.map((d) => (
        <div key={d} className="flex flex-col gap-2">
          <span className={cn(SILK, "text-ink-3")}>{d}</span>
          <div className="flex items-center">{render(d)}</div>
        </div>
      ))}
    </div>
  );
}

// ── Kit sheet ────────────────────────────────────────────────────────────────

const MENU_ROWS: MenuRow[] = [
  { icon: "mic", label: "Mute", hint: "Ctrl+M", led: "muted" },
  { icon: "deafen", label: "Deafen", hint: "Ctrl+D", led: "off" },
  { icon: "camera", label: "Camera", led: "live", highlight: true },
  { icon: "copy", label: "Copy link" },
  { icon: "disconnect", label: "Leave call", danger: true },
];

function KitSheet() {
  return (
    <div data-part="kit">
      <header className="px-4 pt-10 pb-8 md:px-10 md:pt-14">
        <p className={cn(SILK, "text-ink-3")}>Component kit · direction C</p>
        <h1
          className={cn(
            DISPLAY,
            "mt-3 text-[length:clamp(2.75rem,1.4rem+6vw,6rem)] leading-[0.88] font-extrabold tracking-[-0.045em] text-balance",
          )}
        >
          Keys, plates <br />
          and <DitherWord cell={3}>lights.</DitherWord>
        </h1>
        <Rule className="mt-6 h-3 md:h-4" cell={3} />
        <div className="mt-6 grid gap-6 md:grid-cols-12">
          <p className="max-w-[48ch] text-[16px] leading-6 text-pretty text-ink-2 md:col-span-6">
            Hard 2px ink rules instead of 1px grey borders, 2px corners instead
            of rounded-md, one notched corner on the primary key, silkscreen
            mono labels, LEDs for state, dither only in a cap, a rule or a
            fader, never under text. 48px controls.
          </p>
          <dl
            className={cn(
              SILK,
              "grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-ink-3 md:col-span-6",
            )}
          >
            <dt className="text-ink-1">Display</dt>
            <dd>Bricolage Grotesque 600–800 · titles, control labels</dd>
            <dt className="text-ink-1">Silkscreen</dt>
            <dd>Martian Mono 11px · wdth 90/500 dark, 100/600 light</dd>
            <dt className="text-ink-1">Body</dt>
            <dd
              className="normal-case tracking-normal"
              style={{ fontFamily: GEIST }}
            >
              Geist 14–15px stays for messages and rows (8-hour reading)
            </dd>
          </dl>
        </div>
      </header>

      <Section
        index="01"
        title="Button"
        pick="C2 notched key for the one primary per view; C1 keys for secondary, ghost, danger and icon. C3 rules stay for inline links and settings footers."
      >
        <Option
          id="C1"
          name="Key"
          note="solid silkscreened key, 48px, 2px corner"
        >
          <div className="flex flex-col gap-4">
            <States
              render={(d) => (
                <KitButton opt={1} kind="primary" demo={d} icon="arrowRight">
                  Start a room
                </KitButton>
              )}
            />
            <div className="flex flex-wrap items-center gap-3">
              <KitButton opt={1} kind="secondary">
                Download
              </KitButton>
              <KitButton opt={1} kind="ghost">
                Not now
              </KitButton>
              <KitButton opt={1} kind="danger" icon="disconnect">
                Leave
              </KitButton>
              <KitButton opt={1} kind="icon" icon="more" />
              <KitButton opt={1} kind="icon" icon="settings" demo="hover" />
            </div>
          </div>
        </Option>
        <Option
          id="C2"
          name="Notched key"
          note="a cut corner and a dithered trailing cap"
        >
          <div className="flex flex-col gap-4">
            <States
              render={(d) => (
                <KitButton opt={2} kind="primary" demo={d}>
                  Start a room
                </KitButton>
              )}
            />
            <div className="flex flex-wrap items-center gap-3">
              <KitButton opt={2} kind="secondary">
                Download
              </KitButton>
              <KitButton opt={2} kind="ghost">
                Not now
              </KitButton>
              <KitButton opt={2} kind="danger">
                Leave
              </KitButton>
              <KitButton opt={2} kind="icon" icon="more" />
            </div>
          </div>
        </Option>
        <Option
          id="C3"
          name="Rule"
          note="no box; a 2px rule under a bold label"
        >
          <div className="flex flex-col gap-4">
            <States
              render={(d) => (
                <KitButton opt={3} kind="primary" demo={d}>
                  Start a room
                </KitButton>
              )}
            />
            <div className="flex flex-wrap items-center gap-6">
              <KitButton opt={3} kind="secondary">
                Download
              </KitButton>
              <KitButton opt={3} kind="ghost">
                Not now
              </KitButton>
              <KitButton opt={3} kind="danger">
                Leave
              </KitButton>
              <KitButton opt={3} kind="icon" icon="more" />
            </div>
          </div>
        </Option>
      </Section>

      <Section
        index="02"
        title="Fields"
        pick="C2 legend plate: keeps a fill so a field scans as a field in a dense panel, and the label printed through the edge is the kit's own mark. C1 underline for search in headers."
      >
        {[1, 2, 3].map((o) => (
          <Option
            key={o}
            id={`C${o}`}
            name={o === 1 ? "Underline" : o === 2 ? "Legend plate" : "Brackets"}
            note={
              o === 1
                ? "no box, 2px rule"
                : o === 2
                  ? "label printed across the edge"
                  : "viewfinder corners"
            }
          >
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              <KitField
                opt={o as Opt}
                kind="input"
                id={`f${o}-a`}
                label="Display name"
                value="Jon"
              />
              <KitField
                opt={o as Opt}
                kind="input"
                id={`f${o}-b`}
                label="Display name"
                value="Jon"
                demo="focus"
              />
              <KitField
                opt={o as Opt}
                kind="input"
                id={`f${o}-c`}
                label="Email"
                placeholder="you@example.com"
                demo="disabled"
              />
              <KitField
                opt={o as Opt}
                kind="select"
                id={`f${o}-d`}
                label="Microphone"
                value="Shure MV7 (USB Audio)"
              />
              <KitField
                opt={o as Opt}
                kind="select"
                id={`f${o}-e`}
                label="Microphone"
                value="Shure MV7 (USB Audio)"
                demo="hover"
              />
              <KitField
                opt={o as Opt}
                kind="search"
                id={`f${o}-f`}
                label="Search"
                placeholder="Search settings"
              />
            </div>
          </Option>
        ))}
      </Section>

      <Section
        index="03"
        title="Toggles"
        pick="C1 LED switch (on is a light, as everywhere else), C1 hard checkbox, segmented rail for any choice of two to four. Round radios only in long lists."
      >
        <Option id="C1" name="LED switch" note="talk LED lights in the track">
          <States
            render={(d) => (
              <KitSwitch opt={1} on demo={d} label="Noise suppression" />
            )}
          />
          <div className="mt-3">
            <KitSwitch opt={1} on={false} label="Off" />
          </div>
        </Option>
        <Option
          id="C2"
          name="Dither slide"
          note="on fills the track with accent dots"
        >
          <States
            render={(d) => (
              <KitSwitch opt={2} on demo={d} label="Noise suppression" />
            )}
          />
          <div className="mt-3">
            <KitSwitch opt={2} on={false} label="Off" />
          </div>
        </Option>
        <Option id="C3" name="Segmented on/off">
          <States
            render={(d) => (
              <KitSwitch opt={3} on demo={d} label="Noise suppression" />
            )}
          />
        </Option>
        <Option
          id="C1 · C2 · C3"
          name="Checkbox"
          note="hard check · notched · DIP block"
        >
          <div className="flex flex-wrap gap-x-8">
            <States
              states={["idle", "hover", "focus", "disabled"]}
              render={(d) => (
                <KitCheckbox opt={1} checked demo={d} label="Push to talk" />
              )}
            />
          </div>
          <div className="flex flex-wrap gap-x-8">
            <KitCheckbox opt={1} checked={false} label="Unchecked" />
            <KitCheckbox opt={2} checked label="Notched" />
            <KitCheckbox opt={2} checked={false} label="Notched" />
            <KitCheckbox opt={3} checked label="DIP" />
            <KitCheckbox opt={3} checked={false} label="DIP" />
          </div>
        </Option>
        <Option id="C1 · C2" name="Radio" note="ring · square">
          <div className="flex flex-wrap gap-x-8">
            <KitRadio opt={1} checked label="Voice isolation" />
            <KitRadio opt={1} checked={false} label="Studio" />
            <KitRadio opt={1} checked={false} label="Hover" demo="hover" />
            <KitRadio opt={2} checked label="Voice isolation" />
            <KitRadio opt={2} checked={false} label="Studio" />
            <KitRadio opt={2} checked label="Focus" demo="focus" />
          </div>
        </Option>
        <Option id="C3" name="Segmented rail" note="2px ink rail, primary cell">
          <div className="flex flex-col gap-4">
            <States
              states={["idle", "hover", "focus", "disabled"]}
              render={(d) => (
                <KitSegmented
                  items={["Isolation", "Studio", "Custom"]}
                  value="Isolation"
                  demo={d}
                  label="Input profile"
                />
              )}
            />
            <KitSegmented
              size="sm"
              items={["720p", "1080p", "Source"]}
              value="1080p"
              label="Quality"
            />
          </div>
        </Option>
      </Section>

      <Section
        index="04"
        title="Tabs"
        pick="C2 index tabs for the three Studio groups (You, Calls, App) and other top-level switches; C1 rule tabs inside a page."
      >
        <Option id="C1" name="Rule tabs">
          <KitTabs
            opt={1}
            items={["Messages", "Pins", "Files", "Members"]}
            value="Pins"
            demo="hover"
            className="max-w-[520px]"
          />
        </Option>
        <Option id="C2" name="Index tabs">
          <KitTabs
            opt={2}
            items={["You", "Calls", "App"]}
            value="Calls"
            demo="hover"
            className="max-w-[520px]"
          />
        </Option>
        <Option id="C3" name="Segmented">
          <KitSegmented
            items={["Grid", "Focus", "Theatre"]}
            value="Focus"
            label="Stage layout"
          />
        </Option>
      </Section>

      <Section
        index="05"
        title="Badge · LED"
        pick="C1 square count chip for mentions and DMs; C2 LED label for every status word. C3 only as a collectible tag."
      >
        <Option id="C1" name="Count chip" note="2px corners, mono 11">
          <div className="flex items-center gap-3">
            <KitCount>1</KitCount>
            <KitCount>12</KitCount>
            <KitCount>99+</KitCount>
            <span className="ml-4 inline-flex items-center gap-2 text-[14px] font-medium text-ink-1">
              <Icon name="textChannel" size="sm" className="text-ink-3" />
              design-system
              <KitCount>2</KitCount>
            </span>
          </div>
        </Option>
        <Option id="C2" name="LED label">
          <div className="flex flex-wrap items-center gap-6">
            <KitStatus state="talk">Talking</KitStatus>
            <KitStatus state="live">Live</KitStatus>
            <KitStatus state="muted">Muted</KitStatus>
            <KitStatus state="idle">Reconnecting</KitStatus>
            <KitStatus state="off">Offline</KitStatus>
          </div>
        </Option>
        <Option id="C3" name="Dither tag">
          <div className="flex flex-wrap items-center gap-6">
            <KitTag>Nameplate · Night Drive</KitTag>
            <KitTag>Beta</KitTag>
          </div>
        </Option>
      </Section>

      <Section
        index="06"
        title="Menu · Tooltip"
        pick="C1 panel menu with a 2px ink top rule and mono hints, LEDs on toggle rows; C1 inverted tooltip with a key cap."
      >
        <div className="flex flex-wrap items-start gap-8">
          <Option
            id="C1"
            name="Panel menu"
            note="2px top rule, silkscreen title"
          >
            <KitMenu opt={1} title="Lounge · 4 in call" rows={MENU_ROWS} />
          </Option>
          <Option id="C2" name="Index menu" note="numbered rows, key caps">
            <KitMenu opt={2} title="Lounge" rows={MENU_ROWS} />
          </Option>
          <Option id="C3" name="Sheet menu" note="44px rows, display labels">
            <KitMenu opt={3} title="Lounge" rows={MENU_ROWS} />
          </Option>
        </div>
        <div className="flex flex-wrap items-center gap-8">
          <Option id="C1" name="Inverted">
            <KitTooltip opt={1} hint="M">
              Mute
            </KitTooltip>
          </Option>
          <Option id="C2" name="Silkscreen">
            <KitTooltip opt={2} hint="Ctrl M">
              Mute
            </KitTooltip>
          </Option>
          <Option id="C3" name="Plate">
            <KitTooltip opt={3} hint="M">
              Mute
            </KitTooltip>
          </Option>
        </div>
      </Section>

      <Section
        index="07"
        title="Dialog"
        pick="C1 plate dialog: kicker, 28px display title, the dithered rule, 48px keys. C2 for the one-off moments (device approval, first run)."
      >
        <div className="grid gap-6 xl:grid-cols-2">
          <Option id="C1" name="Plate">
            <KitDialog
              opt={1}
              kicker="Invite · Ralph HQ"
              title="Invite friends to Ralph HQ"
              actions={
                <>
                  <KitButton opt={1} kind="ghost">
                    Cancel
                  </KitButton>
                  <KitButton opt={2} kind="primary" icon="copy">
                    Copy link
                  </KitButton>
                </>
              }
            >
              <p>Anyone with the link can join. It expires in 7 days.</p>
              <div className="mt-4">
                <KitField
                  opt={2}
                  kind="input"
                  id="dlg1-link"
                  label="Invite link"
                  value="ralph.meet/j/WDJB-MJHT"
                />
              </div>
            </KitDialog>
          </Option>
          <Option id="C2" name="Poster">
            <KitDialog
              opt={2}
              kicker="Desktop sign-in"
              title="Is this"
              titleLast="you?"
              actions={
                <>
                  <KitButton opt={1} kind="secondary">
                    Deny
                  </KitButton>
                  <KitButton opt={2} kind="primary" icon="check">
                    Approve
                  </KitButton>
                </>
              }
            >
              <p>
                A Windows app on{" "}
                <span className="font-medium text-ink-1">JON-PC</span> asked to
                sign in with code
              </p>
              <p
                className={cn(
                  NUM,
                  DISPLAY,
                  "mt-3 text-[36px] leading-none font-semibold tracking-[0.04em]",
                )}
                style={{ fontFamily: MARTIAN }}
              >
                WDJB-MJHT
              </p>
            </KitDialog>
          </Option>
          <Option id="C3" name="Panel">
            <KitDialog
              opt={3}
              kicker="Delete channel"
              title="Delete #brand-new?"
              actions={
                <>
                  <KitButton opt={1} kind="ghost">
                    Cancel
                  </KitButton>
                  <KitButton opt={1} kind="danger" icon="trash">
                    Delete forever
                  </KitButton>
                </>
              }
            >
              <p>
                Messages, pins and files in this channel are removed for
                everyone. This cannot be undone.
              </p>
            </KitDialog>
          </Option>
        </div>
      </Section>

      <Section
        index="08"
        title="Toast"
        pick="C1 LED toast; the bar under it is time left and ticks once a second (never a loop). C2 inverted only for a call-state change (muted, disconnected)."
      >
        <div className="flex flex-wrap items-start gap-6">
          <Option id="C1" name="LED toast">
            <KitToast
              opt={1}
              led="talk"
              title="Linus joined Lounge"
              body="4 in the call now."
              action="Open"
            />
          </Option>
          <Option id="C2" name="Inverted">
            <KitToast
              opt={2}
              led="muted"
              title="You are muted"
              body="Press Ctrl+M to unmute."
            />
          </Option>
          <Option id="C3" name="Notched">
            <KitToast
              opt={3}
              led="idle"
              title="Reconnecting"
              body="Voice dropped; trying again in 3 s."
              action="Leave"
            />
          </Option>
        </div>
      </Section>

      <Section
        index="09"
        title="Card · Row"
        pick="C2 rule card for settings sections (one 2px rule per section, no boxes); C1 legend plate for floats and side panels; rows at 48px."
      >
        <div className="grid gap-8 lg:grid-cols-3">
          <Option id="C1" name="Legend plate">
            <KitCard opt={1} legend="Input" title="Microphone">
              <KitRow
                avatar={
                  <KitAvatar opt={1} initial="A" presence="talk" size={32} />
                }
                name="Ada Lovelace"
                meta="Shure MV7"
                led="talk"
              />
              <KitRow
                avatar={
                  <KitAvatar opt={1} initial="G" presence="idle" size={32} />
                }
                name="Grace Hopper"
                meta="in a meeting"
                led="muted"
              />
            </KitCard>
          </Option>
          <Option id="C2" name="Rule card">
            <KitCard opt={2} legend="Calls" index="02 / 03" title="Processing">
              <KitRow
                avatar={
                  <KitAvatar
                    opt={1}
                    initial="L"
                    presence="talk"
                    size={32}
                    speaking
                  />
                }
                name="Linus"
                meta="talking"
                led="talk"
                selected
              />
              <KitRow
                avatar={
                  <KitAvatar opt={1} initial="J" presence="talk" size={32} />
                }
                name="Jon"
                meta="you"
                trailing={<KitCount>3</KitCount>}
              />
            </KitCard>
          </Option>
          <Option id="C3" name="Notched plate">
            <KitCard
              opt={3}
              legend="Collectible"
              index="04"
              title="Night Drive"
            >
              <KitRow
                avatar={<KitAvatar opt={3} initial="N" size={32} />}
                name="Nameplate"
                meta="equipped"
                trailing={<KitTag>New</KitTag>}
              />
            </KitCard>
          </Option>
        </div>
      </Section>

      <Section
        index="10"
        title="Avatar"
        pick="C1 square avatar with a square-cut presence LED: a square reads as a key on the panel, and the circle is the shadcn tell. The speaking ring stays 2px talk."
      >
        <div className="flex flex-wrap items-end gap-8">
          <Option id="C1" name="Square">
            <div className="flex items-end gap-3">
              <KitAvatar
                opt={1}
                initial="J"
                presence="talk"
                size={56}
                speaking
              />
              <KitAvatar opt={1} initial="A" presence="talk" size={40} />
              <KitAvatar opt={1} initial="G" presence="idle" size={32} />
              <KitAvatar opt={1} initial="L" presence="muted" size={24} />
            </div>
          </Option>
          <Option id="C2" name="Round (current)">
            <div className="flex items-end gap-3">
              <KitAvatar
                opt={2}
                initial="J"
                presence="talk"
                size={56}
                speaking
              />
              <KitAvatar opt={2} initial="A" presence="talk" size={40} />
              <KitAvatar opt={2} initial="G" presence="idle" size={32} />
            </div>
          </Option>
          <Option id="C3" name="Notched">
            <div className="flex items-end gap-3">
              <KitAvatar opt={3} initial="J" presence="talk" size={56} />
              <KitAvatar opt={3} initial="A" presence="off" size={40} />
            </div>
          </Option>
        </div>
      </Section>

      <Section
        index="11"
        title="Slider"
        pick="C1 fader: a dithered accent range that gets denser toward the value, a tall fader cap, a mono readout. The dots never carry text."
      >
        <div className="grid max-w-[720px] gap-8">
          <Option id="C1" name="Dither fader">
            <div className="flex flex-col gap-3">
              <KitSlider opt={1} value={72} label="Input volume" />
              <KitSlider opt={1} value={72} label="Input volume" demo="focus" />
              <KitSlider
                opt={1}
                value={72}
                label="Input volume"
                demo="disabled"
              />
            </div>
          </Option>
          <Option id="C2" name="Tick rail">
            <KitSlider opt={2} value={40} label="Output volume" />
          </Option>
          <Option id="C3" name="Bar meter">
            <KitSlider opt={3} value={65} label="Output volume" />
          </Option>
        </div>
      </Section>

      <Section
        index="12"
        title="Kbd"
        pick="C1 key cap with a 2px bottom edge; C2 outline inside menus; C3 inverted inside tooltips."
      >
        <div className="flex flex-wrap items-center gap-8">
          <Option id="C1" name="Key cap">
            <span className="inline-flex gap-1">
              <KitKbd opt={1}>Ctrl</KitKbd>
              <KitKbd opt={1}>K</KitKbd>
            </span>
          </Option>
          <Option id="C2" name="Outline">
            <span className="inline-flex gap-1">
              <KitKbd opt={2}>Ctrl</KitKbd>
              <KitKbd opt={2}>M</KitKbd>
            </span>
          </Option>
          <Option id="C3" name="Inverted">
            <span className="inline-flex gap-1">
              <KitKbd opt={3}>Esc</KitKbd>
            </span>
          </Option>
        </div>
      </Section>
    </div>
  );
}

// ── Applied screens: shared app chrome ───────────────────────────────────────

interface Person {
  initial: string;
  name: string;
  presence: LedState;
  speaking?: boolean;
  muted?: boolean;
  deafened?: boolean;
  live?: boolean;
}

const LOUNGE: Person[] = [
  { initial: "J", name: "Jon", presence: "talk" },
  { initial: "A", name: "Ada Lovelace", presence: "talk", muted: true },
  { initial: "G", name: "Grace Hopper", presence: "talk", deafened: true },
  { initial: "L", name: "Linus", presence: "talk", speaking: true, live: true },
];

const MESSAGES: {
  who: Person;
  time: string;
  lines: ReactNode[];
  reactions?: [string, number][];
}[] = [
  {
    who: LOUNGE[1]!,
    time: "7:47 AM",
    lines: [
      "Lounge is open if anyone’s around tonight.",
      "Trivia starts at 9. Ten questions, twenty seconds each.",
    ],
  },
  {
    who: LOUNGE[2]!,
    time: "8:12 AM",
    lines: ["I’m in. Bringing snacks and a grudge from last week."],
    reactions: [["😂", 3]],
  },
  {
    who: LOUNGE[3]!,
    time: "8:31 AM",
    lines: ["Last week’s scores are pinned. Ada, you’re on notice."],
    reactions: [
      ["🔥", 5],
      ["👀", 1],
    ],
  },
  {
    who: LOUNGE[0]!,
    time: "8:52 AM",
    lines: [
      "Queueing music for the break between rounds.",
      <>
        Playlist for the break is{" "}
        <span className="font-semibold text-ink-1">Night Drive</span> first,{" "}
        <em>obviously</em>.
      </>,
    ],
  },
  {
    who: LOUNGE[2]!,
    time: "9:20 AM",
    lines: ["Adding two of mine to the queue.", "Question pack for round two."],
  },
];

function Rail() {
  const servers = [
    { id: "R", on: true },
    { id: "G", count: 1 },
    { id: "D", count: 4 },
    { id: "N" },
  ];
  return (
    <nav
      aria-label="Servers"
      className="hidden w-[60px] shrink-0 flex-col items-center gap-2 border-r border-line bg-ply-0 py-3 md:flex"
    >
      <button
        type="button"
        aria-label="Home"
        className={cn(
          OVERLAY,
          FOCUS,
          "inline-flex size-10 items-center justify-center rounded-[2px] bg-tint-2 text-ink-1",
        )}
      >
        <Icon name="home" size="lg" />
      </button>
      <span aria-hidden="true" className="my-1 h-0.5 w-6 bg-ink-1" />
      {servers.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-label={`Server ${s.id}`}
          className={cn(
            OVERLAY,
            FOCUS,
            DISPLAY,
            "relative inline-flex size-10 items-center justify-center rounded-[2px] text-[15px] font-extrabold",
            s.on ? "bg-primary-fill text-on-primary" : "bg-tint-1 text-ink-2",
          )}
        >
          {s.id}
          {s.count ? (
            <KitCount className="absolute -right-1.5 -bottom-1.5">
              {s.count}
            </KitCount>
          ) : null}
        </button>
      ))}
      <button
        type="button"
        aria-label="Add a server"
        className={cn(
          OVERLAY,
          FOCUS,
          "inline-flex size-10 items-center justify-center rounded-[2px] border-2 border-line-strong text-ink-2",
        )}
      >
        <Icon name="add" size="md" />
      </button>
    </nav>
  );
}

function Branch({
  label,
  count,
  children,
}: {
  label: string;
  count?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-4 first:mt-2">
      <p className={cn(SILK, "flex h-6 items-center gap-2 px-2 text-ink-3")}>
        <Icon name="chevronDown" size="xs" />
        <span className="flex-1">{label}</span>
        {count ? <span>{count}</span> : null}
      </p>
      <div className="mt-0.5 flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function ChannelRow({
  icon,
  name,
  selected,
  unread,
  count,
  meta,
}: {
  icon: IconName;
  name: string;
  selected?: boolean;
  unread?: boolean;
  count?: number;
  meta?: string;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      className={cn(
        FOCUS,
        "relative flex h-8 w-full items-center gap-2 rounded-[2px] px-2 text-left hover:bg-tint-1 -outline-offset-2",
        selected && "bg-tint-2",
      )}
    >
      {unread ? (
        <span
          aria-hidden="true"
          className="absolute top-1/2 -left-2 h-2 w-0.5 -translate-y-1/2 bg-ink-1"
        />
      ) : null}
      <Icon
        name={icon}
        size="sm"
        className={selected ? "text-ink-1" : "text-ink-3"}
      />
      <span
        className={cn(
          "flex-1 truncate text-[14px] leading-5",
          selected || unread
            ? "font-semibold text-ink-1"
            : "font-medium text-ink-2",
        )}
      >
        {name}
      </span>
      {meta ? (
        <span className={cn(NUM, "text-[11px] font-medium text-ink-3")}>
          {meta}
        </span>
      ) : null}
      {count ? <KitCount>{count}</KitCount> : null}
    </button>
  );
}

function OccupantRow({ p, last }: { p: Person; last?: boolean }) {
  return (
    <div className="relative flex h-7 items-center gap-2 pl-7 text-[13px] font-medium text-ink-2">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0 left-[15px] w-px bg-guide",
          last ? "h-1/2" : "h-full",
        )}
      />
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-[15px] h-px w-2 bg-guide"
      />
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-[13px] flex -translate-y-1/2"
      >
        <Led state={p.speaking ? "talk" : "off"} size={6} />
      </span>
      <KitAvatar opt={1} initial={p.initial} size={24} speaking={p.speaking} />
      <span className={cn("flex-1 truncate", p.speaking && "text-ink-1")}>
        {p.name}
      </span>
      {p.live ? (
        <Icon name="screenShare" size="xs" className="text-live-ink" />
      ) : null}
      {p.muted ? (
        <Icon name="mic" state="off" size="xs" className="text-danger-ink" />
      ) : null}
      {p.deafened ? (
        <Icon name="deafen" state="off" size="xs" className="text-danger-ink" />
      ) : null}
    </div>
  );
}

function CallBar() {
  const key = (
    name: IconName,
    label: string,
    state: "idle" | "active" | "off" = "idle",
    tone?: "muted" | "live",
  ) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={state !== "idle"}
      className={cn(
        OVERLAY,
        FOCUS,
        "inline-flex size-12 items-center justify-center rounded-[2px]",
        tone === "muted"
          ? "bg-muted-state-tint text-danger-ink"
          : tone === "live"
            ? "bg-live-tint text-live-ink"
            : state === "active"
              ? "bg-tint-3 text-ink-1"
              : "bg-tint-1 text-ink-1",
      )}
    >
      <Icon name={name} state={state} size="lg" />
    </button>
  );
  return (
    <div className="border-t-2 border-ink-1 bg-ply-1 p-3">
      <div className="flex items-center justify-between">
        <KitStatus state="talk">Voice connected</KitStatus>
        <span className={cn(NUM, "text-[12px] font-semibold text-ink-1")}>
          25:04
        </span>
      </div>
      <p className="mt-0.5 truncate text-[13px] font-medium text-ink-2">
        Lounge · Ralph HQ
      </p>
      <div className="mt-3 flex items-center gap-2">
        {key("camera", "Camera", "idle")}
        {key("screenShare", "Share screen", "active", "live")}
        {key("activities", "Activities")}
        {key("soundboard", "Soundboard")}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Leave call"
          className={cn(
            OVERLAY,
            FOCUS,
            "inline-flex size-12 items-center justify-center rounded-[2px] bg-danger-fill text-on-danger [--hover-o:0.12]",
          )}
        >
          <Icon name="disconnect" size="lg" />
        </button>
      </div>
    </div>
  );
}

function AccountRow() {
  return (
    <div className="flex h-16 items-center gap-3 border-t border-line bg-ply-1 px-3">
      <KitAvatar opt={1} initial="J" presence="talk" size={40} />
      <div className="min-w-0 flex-1">
        <p className={cn(DISPLAY, "truncate text-[15px] leading-5 font-bold")}>
          Jon
        </p>
        <KitStatus state="talk">Online</KitStatus>
      </div>
      <button
        type="button"
        aria-label="Mute"
        className={cn(
          OVERLAY,
          FOCUS,
          "inline-flex size-10 items-center justify-center rounded-[2px] text-ink-1",
        )}
      >
        <Icon name="mic" size="lg" />
      </button>
      <button
        type="button"
        aria-label="Deafen"
        className={cn(
          OVERLAY,
          FOCUS,
          "inline-flex size-10 items-center justify-center rounded-[2px] text-ink-1",
        )}
      >
        <Icon name="deafen" size="lg" />
      </button>
      <button
        type="button"
        aria-label="Settings"
        className={cn(
          OVERLAY,
          FOCUS,
          "inline-flex size-10 items-center justify-center rounded-[2px] text-ink-1",
        )}
      >
        <Icon name="settings" size="lg" />
      </button>
    </div>
  );
}

function TreePanel({ inCall = true }: { inCall?: boolean }) {
  return (
    <aside className="hidden w-[264px] shrink-0 flex-col border-r border-line bg-ply-1 md:flex [--ck-ground:var(--ply-1)]">
      <button
        type="button"
        className={cn(
          FOCUS,
          "flex h-12 items-center justify-between border-b border-line px-4 text-left -outline-offset-2",
        )}
      >
        <span
          className={cn(
            DISPLAY,
            "text-[17px] font-extrabold tracking-[-0.01em]",
          )}
        >
          Ralph HQ
        </span>
        <Icon name="chevronDown" size="sm" className="text-ink-2" />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        <Branch label="Information">
          <ChannelRow icon="textChannel" name="welcome" />
        </Branch>
        <Branch label="Text channels">
          <ChannelRow icon="textChannel" name="general" selected />
          <ChannelRow
            icon="textChannel"
            name="design-system"
            unread
            count={2}
          />
          <ChannelRow icon="textChannel" name="random" />
          <ChannelRow icon="textChannel" name="brand-new" />
        </Branch>
        <Branch label="Voice channels">
          <ChannelRow icon="voiceChannel" name="Lounge" meta="4 · 25:04" />
          <div className="pb-1">
            {LOUNGE.map((p, i) => (
              <OccupantRow key={p.name} p={p} last={i === LOUNGE.length - 1} />
            ))}
          </div>
          <ChannelRow icon="voiceChannel" name="Standup" />
        </Branch>
      </div>
      {inCall ? <CallBar /> : null}
      <AccountRow />
    </aside>
  );
}

function ChatHeader({
  title,
  icon = "textChannel",
  children,
}: {
  title: string;
  icon?: IconName;
  children?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3 md:px-4">
      <button
        type="button"
        aria-label="Menu"
        className={cn(
          OVERLAY,
          FOCUS,
          "inline-flex size-10 items-center justify-center rounded-[2px] text-ink-1 md:hidden",
        )}
      >
        <Icon name="menu" size="lg" />
      </button>
      <Icon name={icon} size="md" className="text-ink-3" />
      <h1
        className={cn(
          DISPLAY,
          "min-w-0 flex-1 truncate text-[18px] leading-6 font-extrabold tracking-[-0.02em]",
        )}
      >
        {title}
      </h1>
      {children}
    </header>
  );
}

function ChatColumn() {
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-ply-0">
      <ChatHeader title="general">
        <div className="hidden items-center gap-1 md:flex">
          <button
            type="button"
            aria-label="Pins"
            className={cn(
              OVERLAY,
              FOCUS,
              "inline-flex size-10 items-center justify-center rounded-[2px] text-ink-2",
            )}
          >
            <Icon name="pin" size="lg" />
          </button>
          <button
            type="button"
            aria-label="Notifications"
            className={cn(
              OVERLAY,
              FOCUS,
              "relative inline-flex size-10 items-center justify-center rounded-[2px] text-ink-2",
            )}
          >
            <Icon name="bell" size="lg" />
            <KitCount className="absolute top-0.5 right-0.5">2</KitCount>
          </button>
          <button
            type="button"
            aria-label="Members"
            aria-pressed="true"
            className={cn(
              OVERLAY,
              FOCUS,
              "inline-flex size-10 items-center justify-center rounded-[2px] bg-tint-2 text-ink-1",
            )}
          >
            <Icon name="members" size="lg" />
          </button>
        </div>
        <div className="hidden w-56 md:block">
          <div className="relative border-b-2 border-line-field has-[:focus-visible]:border-accent-ink">
            <Icon
              name="search"
              size="sm"
              className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 text-ink-3"
            />
            <input
              type="search"
              aria-label="Search"
              placeholder="Search"
              className="h-9 w-full bg-transparent pr-8 pl-6 text-[14px] text-ink-1 focus:outline-none placeholder:text-ink-3"
            />
            <KitKbd
              opt={2}
              className="absolute top-1/2 right-0 h-5 min-w-5 -translate-y-1/2"
            >
              /
            </KitKbd>
          </div>
        </div>
        <button
          type="button"
          aria-label="Members"
          className={cn(
            OVERLAY,
            FOCUS,
            "inline-flex size-10 items-center justify-center rounded-[2px] text-ink-2 md:hidden",
          )}
        >
          <Icon name="members" size="lg" />
        </button>
      </ChatHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-4 md:px-4">
        <p className={cn(SILK, "flex items-center gap-3 text-ink-3")}>
          <span className="h-0.5 w-6 bg-ink-1" />
          Thursday, October 22
        </p>
        <ol className="mt-4 flex max-w-[72ch] flex-col gap-5">
          {MESSAGES.map((m, i) => (
            <li key={i} className="flex gap-3">
              <KitAvatar
                opt={1}
                initial={m.who.initial}
                presence={m.who.presence}
                size={40}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2">
                  <span
                    className={cn(DISPLAY, "text-[15px] leading-5 font-bold")}
                  >
                    {m.who.name}
                  </span>
                  <span
                    className={cn(NUM, "text-[11px] font-medium text-ink-3")}
                  >
                    {m.time}
                  </span>
                </p>
                {m.lines.map((line, j) => (
                  <p key={j} className="text-[15px] leading-[22px] text-ink-1">
                    {line}
                  </p>
                ))}
                {m.reactions ? (
                  <div className="mt-1.5 flex gap-1.5">
                    {m.reactions.map(([e, n]) => (
                      <button
                        key={e}
                        type="button"
                        className={cn(
                          FOCUS,
                          "inline-flex h-7 items-center gap-1.5 rounded-[2px] border border-line-strong px-2 text-[13px] hover:border-ink-2",
                        )}
                      >
                        <span aria-hidden="true">{e}</span>
                        <span
                          className={cn(
                            NUM,
                            "text-[11px] font-semibold text-ink-2",
                          )}
                        >
                          {n}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {i === MESSAGES.length - 1 ? (
                  <div className="mt-2 flex max-w-[420px] items-center gap-3 rounded-[2px] border border-line-strong bg-ply-2 p-3">
                    <span className="inline-flex size-10 items-center justify-center bg-tint-2 text-ink-2">
                      <Icon name="fileText" size="lg" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-accent-ink">
                        round-two-questions.pdf
                      </p>
                      <p
                        className={cn(
                          NUM,
                          "text-[11px] font-medium text-ink-3",
                        )}
                      >
                        402.3 KB
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Download"
                      className={cn(
                        OVERLAY,
                        FOCUS,
                        "inline-flex size-10 items-center justify-center rounded-[2px] text-ink-2",
                      )}
                    >
                      <Icon name="download" size="md" />
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 flex h-6 items-center gap-2 text-[12px] font-medium text-ink-3">
          <Led state="idle" size={6} />{" "}
          <span className="font-semibold text-ink-2">Grace Hopper</span> is
          typing
        </p>
      </div>
      <div className="shrink-0 p-3 md:px-4 md:pb-4">
        <div className="relative flex h-12 items-center rounded-[2px] border border-line-field bg-ply-2 has-[:focus-visible]:border-ink-1 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ink-1">
          <button
            type="button"
            aria-label="Attach"
            className={cn(
              FOCUS,
              "inline-flex size-12 items-center justify-center text-ink-2",
            )}
          >
            <Icon name="add" size="lg" />
          </button>
          <input
            aria-label="Message #general"
            placeholder="Message #general"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink-1 focus:outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            aria-label="GIF"
            className={cn(
              FOCUS,
              SILK,
              "hidden h-12 items-center px-2 text-ink-2 md:inline-flex",
            )}
          >
            GIF
          </button>
          <button
            type="button"
            aria-label="Stickers"
            className={cn(
              FOCUS,
              "hidden size-12 items-center justify-center text-ink-2 md:inline-flex",
            )}
          >
            <Icon name="sticker" size="lg" />
          </button>
          <button
            type="button"
            aria-label="Emoji"
            className={cn(
              FOCUS,
              "inline-flex size-12 items-center justify-center text-ink-2",
            )}
          >
            <Icon name="emoji" size="lg" />
          </button>
        </div>
      </div>
      <PhoneCallBar />
    </main>
  );
}

/** Phone only: the call strip along the bottom. */
function PhoneCallBar() {
  return (
    <div className="flex h-16 items-center gap-2 border-t-2 border-ink-1 bg-ply-1 px-3 md:hidden">
      <Led state="talk" size={8} />
      <div className="min-w-0 flex-1">
        <p className={cn(DISPLAY, "truncate text-[14px] leading-4 font-bold")}>
          Lounge
        </p>
        <p className={cn(NUM, "text-[11px] font-medium text-ink-3")}>
          4 · 25:04
        </p>
      </div>
      <button
        type="button"
        aria-label="Mute"
        className={cn(
          OVERLAY,
          FOCUS,
          "inline-flex size-12 items-center justify-center rounded-[2px] bg-tint-1 text-ink-1",
        )}
      >
        <Icon name="mic" size="lg" />
      </button>
      <button
        type="button"
        aria-label="Deafen"
        className={cn(
          OVERLAY,
          FOCUS,
          "inline-flex size-12 items-center justify-center rounded-[2px] bg-tint-1 text-ink-1",
        )}
      >
        <Icon name="deafen" size="lg" />
      </button>
      <button
        type="button"
        aria-label="Leave call"
        className={cn(
          OVERLAY,
          FOCUS,
          "inline-flex size-12 items-center justify-center rounded-[2px] bg-danger-fill text-on-danger",
        )}
      >
        <Icon name="disconnect" size="lg" />
      </button>
    </div>
  );
}

function MemberPanel() {
  const group = (
    label: string,
    n: number,
    people: { p: Person; sub?: string; tone?: string }[],
  ) => (
    <div className="mt-4 first:mt-2">
      <p className={cn(SILK, "flex h-6 items-center gap-2 px-2 text-ink-3")}>
        <span className="flex-1">{label}</span>
        <span>{n}</span>
      </p>
      {people.map(({ p, sub, tone }) => (
        <div key={p.name} className="flex h-10 items-center gap-3 px-2">
          <KitAvatar
            opt={1}
            initial={p.initial}
            presence={p.presence}
            size={32}
            speaking={p.speaking}
          />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-[14px] leading-5 font-medium",
                tone ?? "text-ink-1",
              )}
            >
              {p.name}
            </p>
            {sub ? (
              <p className="truncate text-[12px] leading-4 text-ink-3">{sub}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <aside className="hidden w-[240px] shrink-0 border-l border-line bg-ply-0 px-2 py-1 xl:block">
      {group("Admin", 2, [
        { p: LOUNGE[1]!, tone: "text-warning-ink" },
        {
          p: LOUNGE[0]!,
          sub: "shipping the UI pass",
          tone: "text-warning-ink",
        },
      ])}
      {group("Moderator", 1, [
        { p: LOUNGE[2]!, sub: "in a meeting", tone: "text-success-ink" },
      ])}
      {group("Online", 1, [{ p: LOUNGE[3]! }])}
      {group("Offline", 2, [
        {
          p: { initial: "K", name: "Ken", presence: "off" },
          tone: "text-ink-3",
        },
        {
          p: { initial: "M", name: "Margaret Hamilton", presence: "off" },
          tone: "text-ink-3",
        },
      ])}
    </aside>
  );
}

function AppFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex h-[900px] w-full overflow-hidden bg-ply-0 text-ink-1 max-md:h-[844px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ChatScreen() {
  return (
    <AppFrame>
      <Rail />
      <TreePanel />
      <ChatColumn />
      <MemberPanel />
    </AppFrame>
  );
}

// ── Settings screen (Studio IA) ──────────────────────────────────────────────

const NAV: {
  group: string;
  rows: { icon: IconName; label: string; on?: boolean }[];
}[] = [
  {
    group: "You",
    rows: [
      { icon: "account", label: "Account" },
      { icon: "sessions", label: "Sessions" },
      { icon: "privacy", label: "Privacy & safety" },
    ],
  },
  {
    group: "Calls",
    rows: [
      { icon: "mic", label: "Voice & video", on: true },
      { icon: "soundboard", label: "Soundboard" },
      { icon: "keyboard", label: "Keybinds" },
    ],
  },
  {
    group: "App",
    rows: [
      { icon: "appearance", label: "Appearance" },
      { icon: "bell", label: "Notifications" },
      { icon: "monitor", label: "Desktop app" },
    ],
  },
];

function SettingRow({
  title,
  body,
  control,
  stacked,
}: {
  title: string;
  body?: string;
  control: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-4 border-b border-line py-4 last:border-b-0",
        stacked ? "flex-col" : "items-center justify-between",
      )}
    >
      <div className="min-w-0">
        <p className="text-[15px] leading-5 font-medium text-ink-1">{title}</p>
        {body ? (
          <p className="mt-0.5 text-[13px] leading-[18px] text-pretty text-ink-2">
            {body}
          </p>
        ) : null}
      </div>
      <div className={cn("shrink-0", stacked ? "w-full" : "")}>{control}</div>
    </div>
  );
}

function SettingsScreen() {
  return (
    <AppFrame className="[--ck-ground:var(--ply-0)]">
      <nav
        aria-label="Settings"
        className="hidden w-[264px] shrink-0 flex-col border-r border-line bg-ply-1 md:flex [--ck-ground:var(--ply-1)]"
      >
        <div className="flex h-12 items-center justify-between border-b border-line px-4">
          <h1
            className={cn(
              DISPLAY,
              "text-[17px] font-extrabold tracking-[-0.01em]",
            )}
          >
            Settings
          </h1>
          <KitKbd opt={2}>Esc</KitKbd>
        </div>
        <div className="px-3 pt-4">
          <KitField
            opt={2}
            kind="search"
            id="st-search"
            label="Search"
            placeholder="Search settings"
          />
        </div>
        <div className="px-2 pt-2">
          {NAV.map((g, gi) => (
            <div key={g.group} className="mt-4">
              <p
                className={cn(
                  SILK,
                  "flex h-6 items-center gap-3 px-2 text-ink-3",
                )}
              >
                <span className="text-ink-1">0{gi + 1}</span>
                {g.group}
              </p>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {g.rows.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    aria-current={r.on ? "page" : undefined}
                    className={cn(
                      FOCUS,
                      "flex h-9 items-center gap-3 rounded-[2px] px-2 text-left hover:bg-tint-1 -outline-offset-2",
                      r.on && "bg-tint-2",
                    )}
                  >
                    <Icon
                      name={r.icon}
                      size="md"
                      className={r.on ? "text-ink-1" : "text-ink-3"}
                    />
                    <span
                      className={cn(
                        "text-[14px] leading-5",
                        r.on
                          ? "font-semibold text-ink-1"
                          : "font-medium text-ink-2",
                      )}
                    >
                      {r.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col bg-ply-0">
        <ChatHeader title="Voice & video" icon="mic">
          <CloseKey className="hidden md:inline-flex" />
        </ChatHeader>
        <div className="md:hidden">
          <KitTabs opt={2} items={["You", "Calls", "App"]} value="Calls" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[760px] flex-col gap-10 px-4 py-6 md:px-8 md:py-8">
            <div>
              <p className={cn(SILK, "text-ink-3")}>02 Calls · Voice & video</p>
              <h2
                className={cn(
                  DISPLAY,
                  "mt-2 text-[36px] leading-[0.95] font-extrabold tracking-[-0.035em] md:text-[44px]",
                )}
              >
                Your mic, speakers and camera.
              </h2>
              <Rule className="mt-5 h-2" cell={2} />
            </div>

            <KitCard opt={2} legend="Input" index="01 / 04">
              <div className="grid gap-5 pt-1 sm:grid-cols-2">
                <KitField
                  opt={2}
                  kind="select"
                  id="st-mic"
                  label="Microphone"
                  value="Shure MV7 (USB Audio)"
                />
                <KitField
                  opt={2}
                  kind="select"
                  id="st-cam"
                  label="Camera"
                  value="Elgato Facecam"
                />
              </div>
              <div className="mt-5">
                <p className={cn(SILK, "text-ink-2")}>Input volume</p>
                <KitSlider
                  opt={1}
                  value={72}
                  label="Input volume"
                  className="mt-2"
                />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <KitButton opt={1} kind="secondary" icon="mic">
                  Test mic
                </KitButton>
                <div
                  className="flex h-12 flex-1 items-center gap-1"
                  aria-hidden="true"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-3 flex-1 rounded-[1px]",
                        i < 9 ? "bg-talk" : "bg-tint-3",
                      )}
                    />
                  ))}
                </div>
              </div>
            </KitCard>

            <KitCard opt={2} legend="Input profile" index="02 / 04">
              <p className="text-[13px] leading-[18px] text-ink-2">
                Pick a preset, or Custom to set each option yourself.
              </p>
              <KitSegmented
                items={["Voice isolation", "Studio", "Custom"]}
                value="Voice isolation"
                label="Input profile"
                className="mt-3 w-full"
              />
              <p className="mt-3 text-[13px] leading-[18px] text-ink-2">
                Balanced processing for everyday voice.
              </p>
            </KitCard>

            <KitCard opt={2} legend="Processing" index="03 / 04">
              <SettingRow
                title="Adjust sensitivity automatically"
                body="The voice detector adapts to your mic level."
                control={
                  <KitSwitch
                    opt={1}
                    on
                    label="Adjust sensitivity automatically"
                  />
                }
              />
              <SettingRow
                title="Noise suppression"
                body="Reduces background noise with RNNoise."
                control={<KitSwitch opt={1} on label="Noise suppression" />}
              />
              <SettingRow
                title="Echo cancellation"
                control={
                  <KitSwitch opt={1} on={false} label="Echo cancellation" />
                }
              />
              <SettingRow
                title="Input sensitivity"
                body="Set by your input profile."
                control={
                  <KitSlider
                    opt={1}
                    value={40}
                    label="Input sensitivity"
                    demo="disabled"
                    className="w-full"
                  />
                }
                stacked
              />
            </KitCard>

            <KitCard opt={2} legend="Video" index="04 / 04">
              <SettingRow
                title="Quality"
                body="Higher costs more upload while you share."
                control={
                  <KitSegmented
                    size="sm"
                    items={["720p", "1080p", "Source"]}
                    value="1080p"
                    label="Quality"
                  />
                }
              />
              <SettingRow
                title="Background"
                control={
                  <KitSegmented
                    size="sm"
                    items={["None", "Blur", "Image"]}
                    value="None"
                    label="Background"
                  />
                }
              />
              <SettingRow
                title="Open camera on join"
                control={
                  <KitSwitch opt={1} on={false} label="Open camera on join" />
                }
              />
            </KitCard>

            <div className="flex items-center justify-between border-t-2 border-ink-1 pt-4">
              <KitButton opt={3} kind="ghost">
                Reset to defaults
              </KitButton>
              <KitStatus state="talk">Saved</KitStatus>
            </div>
          </div>
        </div>
      </main>
    </AppFrame>
  );
}

// ── Dialog over the app ──────────────────────────────────────────────────────

function DialogScreen() {
  return (
    <AppFrame>
      <div aria-hidden="true" className="flex min-w-0 flex-1">
        <Rail />
        <TreePanel />
        <ChatColumn />
        <MemberPanel />
      </div>
      <div className="absolute inset-0 flex items-end justify-center bg-scrim md:items-center md:p-6">
        <KitDialog
          opt={2}
          kicker="Desktop sign-in · 4 min left"
          title="Is this"
          titleLast="you?"
          className="rounded-b-none md:rounded-[2px]"
          actions={
            <>
              <KitButton opt={1} kind="secondary">
                Deny
              </KitButton>
              <KitButton opt={2} kind="primary" icon="check">
                Approve sign-in
              </KitButton>
            </>
          }
        >
          <p>
            Ralph Meet for Windows on{" "}
            <span className="font-medium text-ink-1">JON-PC</span> wants to sign
            in as <span className="font-medium text-ink-1">Jon</span>. Only
            approve if the code matches the app.
          </p>
          <p
            className={cn(
              NUM,
              "mt-4 text-[40px] leading-none font-semibold tracking-[0.04em] text-ink-1",
            )}
          >
            WDJB-MJHT
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Dots
              ink="accent"
              coverage={0.5}
              cell={2}
              className="h-2 w-[62%]"
            />
            <span className={cn(SILK, "text-ink-3")}>Expires 4:12</span>
          </div>
        </KitDialog>
      </div>
    </AppFrame>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type Part = "kit" | "chat" | "settings" | "dialog";

function partParam(): Part | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("part");
  return v === "kit" || v === "chat" || v === "settings" || v === "dialog"
    ? v
    : null;
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <p
      className="border-t border-line bg-ply-1 px-4 py-2 text-[12px] leading-4 text-ink-3"
      style={{ fontFamily: GEIST }}
    >
      {children}
    </p>
  );
}

export function ComponentKitFixture() {
  const [part] = useState(partParam);
  const show = (p: Part) => !part || part === p;
  return (
    <div
      data-testid="component-kit"
      className="ck-root h-full overflow-y-auto bg-ply-0 text-ink-1 [--ck-ground:var(--ply-0)]"
      style={KIT_VARS}
    >
      <style>{KIT_CSS}</style>
      {show("kit") ? <KitSheet /> : null}
      {show("chat") ? (
        <div data-part="chat">
          <Caption>
            Applied · chat with the tree, call bar and composer (Geist body,
            Bricolage names and titles, Martian silkscreen)
          </Caption>
          <ChatScreen />
        </div>
      ) : null}
      {show("settings") ? (
        <div data-part="settings">
          <Caption>
            Applied · Studio settings, Calls › Voice &amp; video: legend
            selects, dither fader, LED switches, segmented rails
          </Caption>
          <SettingsScreen />
        </div>
      ) : null}
      {show("dialog") ? (
        <div data-part="dialog">
          <Caption>
            Applied · device approval over the app (poster dialog; a bottom
            sheet on the phone)
          </Caption>
          <DialogScreen />
        </div>
      ) : null}
    </div>
  );
}
