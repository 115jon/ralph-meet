"use client";

/**
 * Toasts (design-system 14.3, layer 80): transient feedback that isn't tied to
 * a control. Built on sonner for queueing, swipe-to-dismiss, the hotkey and
 * focus handling; the card itself is ours, drawn from Quiet Pro tokens, so it
 * follows every theme without sonner's palette.
 *
 *   toast.success("Server ID copied")
 *   toast.error(describeApiError(err, "ban this member"))
 *
 * Successes and info last 4s. Errors stay until dismissed (14.3). Mount
 * <Toaster /> once at the app root.
 *
 * Placement: bottom-centre below md, bottom-right from md. Either way the
 * stack sits above whatever marks itself `data-floating-avoid` (composer, tab
 * bar, voice dock), measured when a toast is shown, and above the home
 * indicator.
 */

import * as React from "react";
import { toast as sonner, Toaster as SonnerToaster } from "sonner";

import { DitherDots } from "@/components/ui/dither";
import { Icon } from "@/components/ui/icon";
import { HIT } from "@/components/ui/interaction";
import { Led, type LedState } from "@/components/ui/led";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

export const TOAST_DURATION_MS = 4000;

/**
 * success / info / error are C1 LED toasts on ply-3. `call` is the inverted
 * C2 toast, for a call-state change only (muted, deafened, disconnected,
 * moved); pass its light with `led`.
 */
export type ToastKind = "success" | "info" | "error" | "call";

export type ToastOptions = {
  /** Stable id: a repeat replaces the visible toast instead of stacking. */
  id?: string;
  /** Secondary line under the message. */
  description?: React.ReactNode;
  /** Override the kind's default (4s; errors persist). */
  duration?: number;
  /** One short verb ("Undo", "Retry", "Open"), rendered as a silkscreen rule action. */
  action?: { label: string; onClick: () => void };
  /** The toast's light; defaults by kind (talk, off, muted, idle for call). */
  led?: LedState;
};

const KIND: Record<ToastKind, { led: LedState; duration: number }> = {
  success: { led: "talk", duration: TOAST_DURATION_MS },
  info: { led: "off", duration: TOAST_DURATION_MS },
  error: { led: "muted", duration: Number.POSITIVE_INFINITY },
  call: { led: "idle", duration: TOAST_DURATION_MS },
};

/* ------------------------------------------------------------------ */
/* Clearance                                                            */
/* ------------------------------------------------------------------ */

const CLEARANCE_VAR = "--rm-toast-clearance";
const GAP_PX = 12;

/**
 * Height from the viewport's bottom edge to the top of the highest visible
 * `data-floating-avoid` element that touches the bottom third of the screen.
 * Written to a CSS variable the toaster's offset reads, so the stack never
 * covers the composer or tab bar.
 */
export function measureToastClearance(): number {
  if (typeof document === "undefined") return 0;
  const vh = window.innerHeight;
  let clearance = 0;
  document
    .querySelectorAll<HTMLElement>("[data-floating-avoid]")
    .forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.bottom < vh * (2 / 3) || rect.top >= vh) return;
      clearance = Math.max(clearance, vh - rect.top);
    });
  document.documentElement.style.setProperty(CLEARANCE_VAR, `${clearance}px`);
  return clearance;
}

/* ------------------------------------------------------------------ */
/* Card                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The toast card; exported for specimens. Use `toast.*` to show one.
 *
 * C1 LED toast: an LED, a Bricolage title, a 13px body, an optional
 * silkscreen rule action, a dismiss key. A timed toast carries a still
 * dithered time-left bar along its foot that steps down once a second
 * (never a smooth tween, never a loop; it pauses while the stack is
 * hovered). `call` toasts are inverted.
 */
export function ToastCard({
  id,
  kind,
  message,
  description,
  action,
  led,
  duration,
}: {
  id: string | number;
  kind: ToastKind;
  message: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastOptions["action"];
  led?: LedState;
  /** Time left, for the bar. Omitted or infinite: no bar. */
  duration?: number;
}) {
  const spec = KIND[kind];
  const inverted = kind === "call";
  const timed =
    duration !== undefined && Number.isFinite(duration) && duration > 0;
  // No role here: sonner's <section aria-live="polite"> already announces
  // each toast as it is added, and a nested status region inside it makes
  // some screen readers read the toast twice.
  return (
    <div
      data-kind={kind}
      className={cn(
        "group/toast relative w-full overflow-hidden rounded-[2px] border shadow-float forced-colors:border-[CanvasText]",
        inverted
          ? "border-ink-1 bg-ink-1 text-ply-0"
          : "border-line-strong bg-ply-3 text-ink-1",
      )}
    >
      <div className="flex items-start gap-3 py-3 pr-2 pl-4">
        <Led state={led ?? spec.led} size={8} className="mt-1.5" />
        <div className="min-w-0 flex-1 py-px">
          <p
            className={cn(
              "font-display text-pretty text-[15px] leading-5 font-bold wrap-break-word",
              inverted ? "text-ply-0" : "text-ink-1",
            )}
          >
            {message}
          </p>
          {description ? (
            <p
              className={cn(
                "mt-1 text-pretty text-ui-sm",
                inverted ? "text-ply-0/80" : "text-ink-2",
              )}
            >
              {description}
            </p>
          ) : null}
          {action ? (
            <button
              type="button"
              onClick={() => {
                action.onClick();
                sonner.dismiss(id);
              }}
              className={cn(
                "silkscreen relative mt-2 inline-flex min-h-8 items-center border-b-2 transition-colors duration-(--dur-1) ease-out pointer-fine:hover:border-accent-ink",
                inverted
                  ? "border-ply-0 text-ply-0"
                  : "border-ink-1 text-ink-1",
                HIT,
              )}
            >
              {action.label}
            </button>
          ) : null}
        </div>
        {/* Revealed on hover or focus with a fine pointer; always shown on touch. */}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => sonner.dismiss(id)}
          className={cn(
            "relative grid size-8 shrink-0 place-items-center rounded-[2px] transition-[color,background-color,opacity] duration-(--dur-1) ease-out pointer-fine:opacity-0 pointer-fine:group-hover/toast:opacity-100 pointer-fine:group-focus-within/toast:opacity-100",
            inverted
              ? "text-ply-0/70 pointer-fine:hover:text-ply-0"
              : "text-ink-3 pointer-fine:hover:bg-tint-2 pointer-fine:hover:text-ink-1",
            HIT,
          )}
        >
          <Icon name="close" size="sm" />
        </button>
      </div>
      {timed ? (
        <DitherDots
          ink={inverted ? "ground" : "accent"}
          coverage={0.6}
          cell={2}
          className="rm-toast-time h-1 w-full"
          style={
            {
              "--toast-duration": `${duration}ms`,
              "--toast-steps": Math.max(1, Math.round(duration / 1000)),
            } as React.CSSProperties
          }
        />
      ) : null}
    </div>
  );
}

function show(kind: ToastKind, message: React.ReactNode, opts?: ToastOptions) {
  measureToastClearance();
  const duration = opts?.duration ?? KIND[kind].duration;
  return sonner.custom(
    (id) => (
      <ToastCard
        id={id}
        kind={kind}
        message={message}
        description={opts?.description}
        action={opts?.action}
        led={opts?.led}
        duration={duration}
      />
    ),
    {
      id: opts?.id,
      duration,
    },
  );
}

export const toast = {
  success: (message: React.ReactNode, opts?: ToastOptions) =>
    show("success", message, opts),
  info: (message: React.ReactNode, opts?: ToastOptions) =>
    show("info", message, opts),
  error: (message: React.ReactNode, opts?: ToastOptions) =>
    show("error", message, opts),
  /** Inverted: a call-state change (muted, deafened, disconnected, moved). */
  call: (message: React.ReactNode, opts?: ToastOptions) =>
    show("call", message, opts),
  dismiss: (id?: string | number) => sonner.dismiss(id),
};

/**
 * Copies text and confirms with a toast. Failure (no permission, insecure
 * context) is an error toast instead of silence.
 */
export async function copyToClipboard(
  text: string,
  label = "Copied",
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label, { id: "rm-copied" });
    return true;
  } catch {
    toast.error("Couldn't copy. Your browser blocked clipboard access.", {
      id: "rm-copied",
    });
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Toaster                                                              */
/* ------------------------------------------------------------------ */

/** Viewport gap below the stack: clearance + safe area + 12. */
const BOTTOM = `calc(max(var(${CLEARANCE_VAR}, 0px), var(--safe-area-bottom, 0px)) + ${GAP_PX}px)`;

export function Toaster() {
  const isMobile = useIsMobile();

  // Re-measure when the layout changes under a visible stack (keyboard,
  // rotation, a composer that grows).
  React.useEffect(() => {
    const onResize = () => measureToastClearance();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <SonnerToaster
      position={isMobile ? "bottom-center" : "bottom-right"}
      visibleToasts={3}
      gap={8}
      offset={{ bottom: BOTTOM, right: 16, left: 16 }}
      // sonner's own phone layout (< 600px) reads these.
      mobileOffset={{ bottom: BOTTOM, right: 12, left: 12 }}
      containerAriaLabel="Notifications"
      // Unstyled: the card is ToastCard. Above sonner's 600px phone layout
      // every toast takes the stack width, so stacked cards line up.
      toastOptions={{ unstyled: true, className: "min-[601px]:w-(--width)" }}
      // Layer 80 (11.1) instead of sonner's 999999999.
      // Card width 360; sonner's own 400ms height tween is replaced by a
      // 200ms transform/opacity transition in styles/foundation.css.
      style={{ zIndex: 80, "--width": "360px" } as React.CSSProperties}
      className="rm-toaster"
    />
  );
}
