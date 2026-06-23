"use client";

import { BaseModal } from "@/components/ui/BaseModal";
import { VOICE_SWITCH_CONFIRM_KEY } from "@/components/chat/voice-confirmation-preferences";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ── LocalStorage key for "Don't ask again" ─────────────────────────────────
const DONT_ASK_KEY = VOICE_SWITCH_CONFIRM_KEY;

interface VoiceSwitchModalProps {
  /** Whether the modal is visible */
  open: boolean;
  /** Display name of the target channel / call the user wants to switch to */
  targetName: string;
  /** What kind of voice session the user is currently in */
  currentType: "voice" | "call";
  /** Called when the user confirms the switch */
  onConfirm: () => void;
  /** Called when the user cancels */
  onCancel: () => void;
  isClosing?: boolean;
}

/**
 * Confirmation modal shown when the user tries to switch to a different
 * voice channel or call while already in one.
 *
 * Respects the `rm-voice-switch-skip-confirm` localStorage flag — if true,
 * `shouldShowVoiceSwitchModal` will return false and the caller can skip
 * rendering this modal entirely.
 */
export function VoiceSwitchModal({
  open,
  targetName,
  currentType,
  onConfirm,
  onCancel,
  isClosing,
}: VoiceSwitchModalProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Reset the checkbox when modal opens
  useEffect(() => {
    if (open) setDontAskAgain(false);
  }, [open]);

  const handleConfirm = useCallback(() => {
    if (dontAskAgain) {
      try {
        localStorage.setItem(DONT_ASK_KEY, "true");
      } catch { /* quota / private-mode — silently ignore */ }
    }
    onConfirm();
  }, [dontAskAgain, onConfirm]);

  if (!open) return null;

  const bodyText =
    currentType === "call"
      ? `Looks like you're in a call. Are you sure you want to switch to `
      : `Looks like you're in another voice channel. Are you sure you want to switch to `;

  return (
    <BaseModal onClose={onCancel}>
      <div className={cn(
        "fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-[2px] animate-in fade-in duration-200",
        isClosing && "animate-out fade-out"
      )}>
        <div
          className={cn(
            "relative w-full max-w-[440px] mx-4 rounded-lg bg-rm-bg-surface shadow-2xl animate-in fade-in zoom-in-95 duration-200",
            isClosing && "animate-out zoom-out-95"
          )}
          role="dialog"
          aria-modal="true"
          aria-labelledby="voice-switch-title"
        >
          {/* ── Header ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-4 pt-4">
            <h2
              id="voice-switch-title"
              className="text-base font-bold text-rm-text"
            >
              You sure?
            </h2>
            <button
              onClick={onCancel}
              className="flex h-6 w-6 items-center justify-center rounded-sm text-rm-text-muted hover:text-rm-text transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Body ───────────────────────────────────────────── */}
          <div className="px-4 pt-3 pb-5 text-sm text-rm-text-secondary leading-relaxed">
            {bodyText}
            <span className="font-semibold text-rm-text">{targetName}</span>?
          </div>

          {/* ── Footer ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-4 pb-4">
            {/* Checkbox */}
            <label className="flex items-center gap-2 select-none cursor-pointer group">
              <span
                className={`flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border transition-colors ${dontAskAgain
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
              <button
                onClick={onCancel}
                className="px-4 py-1.5 text-sm font-medium text-rm-text-muted hover:text-rm-text hover:underline transition-colors rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-1.5 text-sm font-medium rounded bg-primary text-primary-foreground hover:bg-primary/85 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
