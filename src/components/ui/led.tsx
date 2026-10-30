import * as React from "react";

import { cn } from "@/lib/utils";

export type LedState = "talk" | "live" | "muted" | "idle" | "off";

type LedProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** Which light. `off` is the unlit dot in --line-strong. */
  state: LedState;
  /** 6 (default) or 8. */
  size?: 6 | 8;
  /**
   * `"speaking"`: a talk LED lit only while it or an ancestor carries
   * `[data-speaking]` (useSpeakingAttr on the leaf), so a speaking flip
   * re-renders nothing but that leaf. Default `"always"`: lit whenever the
   * state is not `off`.
   */
  follow?: "always" | "speaking";
  /** Accessible name when the LED is the only signal (rare). */
  label?: string;
};

/**
 * The state light (talk-tree-spec §5a): talk green, live azure, muted red,
 * idle amber. On, it fills in its colour with a halo painted once; only
 * opacity changes, 60ms on and 220ms off. No pulse, breathing or level
 * scaling. Decorative by default: the row's text or glyph carries meaning.
 */
function Led({
  state,
  size = 6,
  follow = "always",
  label,
  className,
  ...props
}: LedProps) {
  const lit = state !== "off" && follow === "always";
  return (
    <span
      data-slot="led"
      data-state={state}
      data-size={size}
      data-follow={
        state !== "off" && follow === "speaking" ? "speaking" : undefined
      }
      data-lit={lit ? "" : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("rm-led", className)}
      {...props}
    />
  );
}

const LED_INK: Record<LedState, string> = {
  talk: "text-success-ink",
  live: "text-live-ink",
  muted: "text-danger-ink",
  idle: "text-warning-ink",
  off: "text-ink-3",
};

/**
 * LED label (DESIGN.md, Badge · LED): every status word is a lit dot and a
 * silkscreen word in the light's ink (Talking, Live, Muted, Reconnecting,
 * Offline, Saved, Voice connected). The word carries the meaning; the LED is
 * decorative. `tone="plain"` keeps the word in ink-2 (an account status line
 * under a name). Never truncates into a neighbour: it shrinks and clips.
 */
function LedLabel({
  state,
  size = 6,
  tone = "led",
  follow,
  led = true,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  state: LedState;
  size?: 6 | 8;
  tone?: "led" | "plain";
  follow?: LedProps["follow"];
  /** `false` drops the dot (when a presence LED already sits beside it). */
  led?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      data-slot="led-label"
      data-state={state}
      className={cn(
        "silkscreen inline-flex min-w-0 items-center gap-2",
        tone === "led" ? LED_INK[state] : "text-ink-2",
        className,
      )}
      {...props}
    >
      {led ? <Led state={state} size={size} follow={follow} /> : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export { Led, LedLabel };
