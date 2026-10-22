"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/IconButton";
import { START_CALL_CONFIRM_KEY } from "@/components/chat/voice-confirmation-preferences";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

// ── LocalStorage key for "Don't ask again" ─────────────────────────────────
const DONT_ASK_KEY = START_CALL_CONFIRM_KEY;

interface StartCallModalProps {
  /** Whether the modal is visible */
  open: boolean;
  /** Display name of the user being called */
  targetName: string;
  /** Called when the user confirms the call */
  onConfirm: () => void;
  /** Called when the user cancels */
  onCancel: () => void;
}

/**
 * Confirmation modal shown before initiating a DM call.
 *
 * Styled to match the app theme with rm-* CSS variables.
 * Respects a "Don't ask again" localStorage flag so the user can
 * skip the confirmation in the future.
 */
export function StartCallModal({
  open,
  targetName,
  onConfirm,
  onCancel,
}: StartCallModalProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const handleConfirm = useCallback(() => {
    if (dontAskAgain) {
      try {
        localStorage.setItem(DONT_ASK_KEY, "true");
      } catch {
        /* quota / private-mode — silently ignore */
      }
    }
    onConfirm();
  }, [dontAskAgain, onConfirm]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogPortal>
        <div
          data-state={open ? "open" : "closed"}
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] animate-in fade-in duration-200 data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0",
          )}
        >
          <DialogSurface
            showCloseButton={false}
            className={cn(
              "relative m-0 w-[calc(100%-2rem)] max-w-[440px] rounded-xl border border-rm-border bg-rm-bg-surface dark:bg-rm-bg-elevated p-0 shadow-[var(--rm-shadow-3)] outline-none animate-in fade-in zoom-in-95 duration-200",
              "data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=closed]:fade-out",
            )}
            aria-labelledby="start-call-title"
            aria-describedby="start-call-description"
          >
            {/* ── Header ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 pt-4">
              <h2
                id="start-call-title"
                className="text-ui-lg font-semibold text-rm-text"
              >
                Ready to start a call?
              </h2>
              <IconButton
                icon="close"
                size="xs"
                iconSize="sm"
                type="button"
                onClick={onCancel}
                aria-label="Close"
              />
            </div>

            {/* ── Body ───────────────────────────────────────────── */}
            <div
              id="start-call-description"
              className="px-4 pt-3 pb-5 text-sm text-rm-text-secondary leading-relaxed"
            >
              You&apos;re about to call{" "}
              <span className="font-semibold text-rm-text">{targetName}</span>.
              Jump in when you&apos;re ready.
            </div>

            {/* ── Footer ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 pb-4">
              {/* Checkbox */}
              <label className="flex items-center gap-2 select-none cursor-pointer group">
                <span
                  className={`flex h-[18px] w-[18px] items-center justify-center rounded-xs border transition-colors ${
                    dontAskAgain
                      ? "border-primary bg-primary"
                      : "border-rm-text-muted/40 bg-transparent group-hover:border-rm-text-muted/60"
                  }`}
                >
                  {dontAskAgain && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3 w-3 text-primary-foreground"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={dontAskAgain}
                  onChange={(e) => setDontAskAgain(e.target.checked)}
                />
                <span className="text-xs text-rm-text-muted group-hover:text-rm-text-secondary transition-colors">
                  Don&apos;t ask again
                </span>
              </label>

              {/* Buttons */}
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" onClick={onCancel}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleConfirm}>
                  Start Call
                </Button>
              </div>
            </div>
          </DialogSurface>
        </div>
      </DialogPortal>
    </Dialog>
  );
}
