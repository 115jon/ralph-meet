/**
 * The one save pattern for settings that don't save on change (server and
 * channel overview, roles, permissions, the profile editor). Overlays audit
 * issue 7, flow 3.
 *
 *   hidden while clean; slides up 100% -> 0 with a fade over 200ms when the
 *   form turns dirty. 56 high, a 2px ink-1 rule on top (the kit's settings
 *   footer), ply-3.
 *   left   an idle LED label "Unsaved changes" (or an error, in danger ink)
 *   right  [rule Reset] [primary Save changes]
 *
 * Closing or pressing Escape while dirty doesn't close: the host calls
 * `nudge()` from `useUnsavedNudge`, and the bar shakes (translateX ±4px,
 * three cycles, 240ms) so the person sees why. Reduced motion flashes a
 * warning tint instead.
 *
 *   const unsaved = useUnsavedNudge();
 *   <SettingsWorkbench unsaved={{ dirty, saving, onReset, onSave, ...unsaved }} …>
 *
 * Hosts that aren't a SettingsWorkbench render <UnsavedBar> themselves at
 * the bottom of their scroll column.
 */

import { Button } from "@/components/ui/button";
import { LedLabel } from "@/components/ui/led";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type UnsavedBarProps = {
  dirty: boolean;
  saving?: boolean;
  /** Save failure, shown in place of "Unsaved changes". */
  error?: ReactNode;
  onReset: () => void;
  onSave: () => void;
  saveLabel?: string;
  resetLabel?: string;
  message?: ReactNode;
  /** Bump to shake the bar (from useUnsavedNudge). */
  nudgeKey?: number;
  /** Disable Save (an invalid field) while keeping Reset live. */
  saveDisabled?: boolean;
  className?: string;
};

/** Counter the host bumps when a close is refused while dirty. */
export function useUnsavedNudge() {
  const [nudgeKey, setNudgeKey] = useState(0);
  const nudge = useCallback(() => setNudgeKey((key) => key + 1), []);
  return { nudgeKey, nudge };
}

const SHAKE: Keyframe[] = [
  { translate: "0 0" },
  { translate: "-4px 0" },
  { translate: "4px 0" },
  { translate: "-4px 0" },
  { translate: "4px 0" },
  { translate: "-4px 0" },
  { translate: "0 0" },
];

export function UnsavedBar({
  dirty,
  saving = false,
  error,
  onReset,
  onSave,
  saveLabel = "Save changes",
  resetLabel = "Reset",
  message = "Unsaved changes",
  nudgeKey = 0,
  saveDisabled = false,
  className,
}: UnsavedBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastNudge = useRef(nudgeKey);

  useEffect(() => {
    if (nudgeKey === lastNudge.current) return;
    lastNudge.current = nudgeKey;
    const node = ref.current;
    if (!node?.animate) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      node.setAttribute("data-flash", "");
      const timer = window.setTimeout(
        () => node.removeAttribute("data-flash"),
        400,
      );
      return () => window.clearTimeout(timer);
    }
    node.animate(SHAKE, {
      duration: 240,
      easing: "cubic-bezier(.65,0,.35,1)",
    });
    return undefined;
  }, [nudgeKey]);

  if (!dirty && !saving) return null;

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Unsaved changes"
      data-slot="unsaved-bar"
      className={cn(
        "flex min-h-14 items-center gap-3 border-t-2 border-ink-1 bg-ply-3 px-4 py-3 md:px-8",
        // Enter: slide up from its own height with a fade.
        "transition-[translate,opacity,background-color] duration-(--dur-3) ease-out starting:opacity-0 motion-safe:starting:translate-y-full",
        "data-flash:bg-warning-tint",
        className,
      )}
    >
      <p
        aria-live="polite"
        className={cn(
          "min-w-0 flex-1 truncate",
          error
            ? "text-ui-sm font-medium text-danger-ink"
            : typeof message === "string"
              ? undefined
              : "text-ui-sm font-medium text-ink-1",
        )}
      >
        {error ??
          (typeof message === "string" ? (
            <LedLabel state="idle">{message}</LedLabel>
          ) : (
            message
          ))}
      </p>
      <Button variant="rule" disabled={saving} onClick={onReset}>
        {resetLabel}
      </Button>
      <Button
        variant="primary"
        loading={saving}
        disabled={saveDisabled}
        onClick={onSave}
      >
        {saveLabel}
      </Button>
    </div>
  );
}
