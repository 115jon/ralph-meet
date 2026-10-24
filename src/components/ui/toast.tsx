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

import { Icon, type IconName } from "@/components/ui/icon";
import { HIT } from "@/components/ui/interaction";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

export const TOAST_DURATION_MS = 4000;

type ToastKind = "success" | "info" | "error";

export type ToastOptions = {
  /** Stable id: a repeat replaces the visible toast instead of stacking. */
  id?: string;
  /** Secondary line under the message. */
  description?: React.ReactNode;
  /** Override the kind's default (4s; errors persist). */
  duration?: number;
};

const KIND: Record<
  ToastKind,
  { icon: IconName; iconClass: string; duration: number }
> = {
  success: {
    icon: "check",
    iconClass: "text-rm-success-ink",
    duration: TOAST_DURATION_MS,
  },
  info: {
    icon: "info",
    iconClass: "text-rm-text-muted",
    duration: TOAST_DURATION_MS,
  },
  error: {
    icon: "alert",
    iconClass: "text-rm-danger-ink",
    duration: Number.POSITIVE_INFINITY,
  },
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

function ToastCard({
  id,
  kind,
  message,
  description,
}: {
  id: string | number;
  kind: ToastKind;
  message: React.ReactNode;
  description?: React.ReactNode;
}) {
  const spec = KIND[kind];
  return (
    <div
      role="status"
      data-kind={kind}
      className="flex w-full items-start gap-3 rounded-lg border border-rm-border bg-rm-bg-surface py-3 pr-2 pl-3 text-rm-text shadow-lg dark:bg-rm-bg-elevated"
    >
      <Icon
        name={spec.icon}
        size="md"
        className={cn("mt-0.5 shrink-0", spec.iconClass)}
      />
      <div className="min-w-0 flex-1 py-px">
        <p className="text-pretty text-ui-sm font-medium wrap-break-word">
          {message}
        </p>
        {description ? (
          <p className="mt-0.5 text-pretty text-ui-xs text-rm-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => sonner.dismiss(id)}
        className={cn(
          "relative -my-1 grid size-7 shrink-0 place-items-center rounded-sm text-rm-text-muted transition-colors duration-150 ease-(--rm-ease-out) pointer-fine:hover:bg-rm-tint-2 pointer-fine:hover:text-rm-text",
          HIT,
        )}
      >
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}

function show(kind: ToastKind, message: React.ReactNode, opts?: ToastOptions) {
  measureToastClearance();
  return sonner.custom(
    (id) => (
      <ToastCard
        id={id}
        kind={kind}
        message={message}
        description={opts?.description}
      />
    ),
    {
      id: opts?.id,
      duration: opts?.duration ?? KIND[kind].duration,
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
      style={{ zIndex: 80 }}
      className="rm-toaster"
    />
  );
}
