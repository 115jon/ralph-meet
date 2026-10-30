/**
 * The one public frame (DESIGN.md, Public pages; type-mockups variant C,
 * "Access"): every screen around the app (sign-in, sign-up, /activate,
 * desktop sign-in, invites, room joins, shared messages, 404 and route
 * errors) is this frame.
 *
 *   - the sign-in dither in a panel on the LEADING edge at lg and up (a slim
 *     strip beside a wide column), a short band across the top below lg.
 *     The column always sits on plain ground; no text is drawn on the field.
 *   - a header row: the logo lockup (a link home on the web, plain in the
 *     desktop app) and an optional silkscreen section label at the far end
 *   - a left-aligned column, 440px (720 for a shared message), top-aligned
 *     at a fixed offset so a state change grows downward instead of
 *     re-centring the whole column
 *
 * The dither is decorative and still: aria-hidden, one painted frame (no
 * `animate`, so nothing ticks and reduced motion has nothing to stop),
 * hidden outright under forced colours, and never mounted while its
 * breakpoint hides it.
 *
 * The parts give every page the same poster anatomy: an optional silkscreen
 * kicker, a 48px status tile, a Bricolage 800 title over a dithered rule
 * (`display` on a flow's entry screen, `xl` after it), one line of body
 * copy, then 48px keys at full column width.
 *
 * `.auth-split` stays on the root: the Kova card's bridge in styles.css is
 * scoped to it.
 */

import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { Spinner } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { DitherField } from "@/components/ui/DitherField";
import { DitherRule } from "@/components/ui/dither";
import { ThemeMark } from "@/components/ui/theme-slots";
import { useDitherGeometry } from "@/components/ui/use-dither-geometry";
import { cn } from "@/lib/utils";
import { useRef, type ReactNode, type Ref } from "react";
import { PUBLIC_DISPLAY_CLASS, PUBLIC_TITLE_CLASS } from "./public-type";

export function PublicFrame({
  children,
  width = "narrow",
  art = true,
  home = "/",
  label,
  className,
  "aria-busy": ariaBusy,
}: {
  children: ReactNode;
  /** `wide` (720) is for a shared message; everything else is 400. */
  width?: "narrow" | "wide";
  /** The dithered edge panel (and its phone band). On by default. */
  art?: boolean;
  /** Where the lockup links; `null` renders it as plain identity (desktop app). */
  home?: string | null;
  /** Silkscreen section label at the header's far end ("Access"). */
  label?: ReactNode;
  className?: string;
  "aria-busy"?: boolean;
}) {
  return (
    <div
      className={cn(
        "auth-split flex min-h-dvh w-full flex-col bg-ply-0 text-ink-1 antialiased lg:flex-row",
        className,
      )}
    >
      {art ? <PublicArtBand /> : null}
      {art ? <PublicArtPanel strip={width === "wide"} /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "flex shrink-0 items-center justify-between gap-4 px-[max(24px,var(--safe-area-left,0px))] pt-[max(16px,var(--safe-area-top,0px))]",
            // Below lg the band already clears the safe area.
            art && "max-lg:pt-4",
          )}
        >
          <Lockup home={home} />
          {label ? (
            <span className="silkscreen text-ink-3">{label}</span>
          ) : null}
        </header>
        <main
          aria-busy={ariaBusy || undefined}
          className="flex min-w-0 flex-1 justify-center overflow-y-auto overscroll-contain px-[max(24px,var(--safe-area-right,0px))] pt-10 md:pt-[clamp(32px,10vh,96px)] pb-[max(48px,var(--safe-area-bottom,0px))]"
        >
          <div
            className={cn(
              "w-full",
              width === "wide" ? "max-w-[720px]" : "max-w-[440px]",
            )}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Ralph's mark (with the theme's mark over it) and the name. */
function Lockup({ home }: { home: string | null }) {
  const content = (
    <>
      <span className="relative flex size-7 shrink-0 items-center justify-center">
        <ThemeAwareSplashLogo className="size-7 object-contain select-none" />
        <ThemeMark />
      </span>
      <span className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-ink-1">
        Ralph Meet
      </span>
    </>
  );
  const box =
    "-mx-1 inline-flex min-h-11 items-center gap-3 rounded-[2px] px-1";
  return home === null ? (
    <span className={box}>{content}</span>
  ) : (
    <a href={home} className={box}>
      {content}
    </a>
  );
}

/**
 * A still field keyed on its host's coarse size, so a resize or rotation
 * re-cuts the frame instead of stretching it. The host's own ground shows
 * until the frame fades in (no bright fallback flash in light themes).
 */
function EdgeDither({ cell }: { cell: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const geometry = useDitherGeometry(ref);
  return (
    <div ref={ref} className="absolute inset-0">
      {geometry ? (
        <DitherField
          key={`${geometry.width}:${geometry.aspect}`}
          cell={cell}
          intensity={0.6}
          style={{ background: "transparent" }}
        />
      ) : null}
    </div>
  );
}

/** lg and up: a full-height panel on the leading edge. */
function PublicArtPanel({ strip }: { strip: boolean }) {
  return (
    <aside
      aria-hidden="true"
      data-slot="public-art"
      className={cn(
        "relative hidden shrink-0 overflow-hidden border-r border-line bg-ply-1 lg:block forced-colors:hidden",
        strip ? "w-[clamp(160px,20%,320px)]" : "w-[36%] max-w-[600px]",
      )}
    >
      <EdgeDither cell={7} />
    </aside>
  );
}

/** Below lg: a short band across the top, clear of the column. */
function PublicArtBand() {
  return (
    <div
      aria-hidden="true"
      data-slot="public-art-band"
      className="relative h-[calc(64px+var(--safe-area-top,0px))] shrink-0 overflow-hidden border-b border-line bg-ply-1 lg:hidden forced-colors:hidden"
    >
      <EdgeDither cell={4} />
    </div>
  );
}

// ── Parts ─────────────────────────────────────────────────────────────────────

const TILE_TONE = {
  neutral: "bg-tint-1 text-ink-2",
  accent: "bg-accent-tint text-accent-ink",
  success: "bg-success-tint text-success-ink",
  danger: "bg-danger-tint text-danger-ink",
} as const;

export type StatusTone = keyof typeof TILE_TONE;

/**
 * The one status tile: a 48px key-cornered square, tinted by tone, a 24px
 * glyph. Pass
 * `busy` for work in flight (a spinner, the one allowed loop, unmounted
 * when the state ends). Children replace the glyph (a server icon).
 */
export function StatusTile({
  icon,
  tone = "neutral",
  busy = false,
  children,
  className,
}: {
  icon?: IconName;
  tone?: StatusTone;
  busy?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      data-slot="status-tile"
      data-tone={tone}
      className={cn(
        "mb-6 flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[2px]",
        TILE_TONE[tone],
        className,
      )}
    >
      {children ??
        (busy ? (
          <Spinner className="size-5" />
        ) : icon ? (
          <Icon name={icon} size="xl" />
        ) : null)}
    </div>
  );
}

/**
 * The silkscreen kicker over the title (where you are, who invited you):
 * Martian 11 uppercase in ink-3. A label, never a sentence.
 */
export function PublicKicker({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "silkscreen mb-4 text-ink-3 [overflow-wrap:anywhere]",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * The page heading: Bricolage 800 over a still dithered rule (the poster's
 * lip). `display` is for a flow's entry screen (44 to 68px); every state
 * after it is `xl` (28/32). Focusable so a state change can move focus here.
 * `rule={false}` drops the rule.
 */
export function PublicTitle({
  children,
  size = "xl",
  id,
  headingRef,
  rule = true,
  className,
}: {
  children: ReactNode;
  size?: "xl" | "display";
  id?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  rule?: boolean;
  className?: string;
}) {
  return (
    <>
      <h1
        id={id}
        ref={headingRef}
        tabIndex={-1}
        className={cn(
          "text-balance text-ink-1 outline-none [overflow-wrap:anywhere]",
          size === "display" ? PUBLIC_DISPLAY_CLASS : PUBLIC_TITLE_CLASS,
          className,
        )}
      >
        {children}
      </h1>
      {rule ? (
        <DitherRule
          cell={2}
          className={size === "display" ? "mt-6 h-2" : "mt-4 h-2 max-w-[240px]"}
        />
      ) : null}
    </>
  );
}

/**
 * One line of body copy. `lead` follows a display title: 17/24 at a 38ch
 * measure, 24px under the rule. `base` (15/22) follows an `xl` title.
 */
export function PublicBody({
  children,
  size = "base",
  className,
}: {
  children: ReactNode;
  size?: "base" | "lead";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-pretty text-ink-2 [overflow-wrap:anywhere]",
        size === "lead"
          ? "mt-6 max-w-[38ch] text-[17px] leading-6"
          : "mt-4 max-w-[44ch] text-ui-base",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Full-width 48px keys, primary first, 12px apart, 32px under the body. */
export function PublicActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-8 flex flex-col gap-3 *:w-full", className)}>
      {children}
    </div>
  );
}

const NOTICE_TONE = {
  accent: "bg-accent-tint text-ink-1 [--notice-icon:var(--accent-ink)]",
  danger: "bg-danger-tint text-danger-ink [--notice-icon:var(--danger-ink)]",
  neutral: "bg-tint-1 text-ink-2 [--notice-icon:var(--ink-3)]",
} as const;

/**
 * The notice strip: an inline message inside the column (an error under the
 * actions, "a device is waiting"). 16px glyph, text-ui-sm, 2px corners.
 */
export function Notice({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: keyof typeof NOTICE_TONE;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[2px] px-3 py-3 text-ui-sm",
        NOTICE_TONE[tone],
        className,
      )}
    >
      <Icon
        name={icon ?? (tone === "danger" ? "alert" : "info")}
        size="sm"
        className="mt-px shrink-0 text-(--notice-icon)"
      />
      <div className="min-w-0 flex-1 text-pretty">{children}</div>
    </div>
  );
}

/** Live error slot: renders nothing when empty but keeps the alert region. */
export function ErrorNotice({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("empty:hidden", className)}>
      {children ? <Notice tone="danger">{children}</Notice> : null}
    </div>
  );
}

/** @deprecated The old name of `PublicKicker`. */
export const PublicLeadIn = PublicKicker;
