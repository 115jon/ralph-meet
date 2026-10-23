"use client";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { DontAskAgainCheckbox } from "@/components/chat/DontAskAgainCheckbox";
import { START_CALL_CONFIRM_KEY } from "@/components/chat/voice-confirmation-preferences";
import { useCallback, useState } from "react";

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
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onCancel()}
    >
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Ready to start a call?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            You&apos;re about to call{" "}
            <span className="font-semibold text-rm-text">{targetName}</span>.
            Jump in when you&apos;re ready.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <DontAskAgainCheckbox
          checked={dontAskAgain}
          onCheckedChange={setDontAskAgain}
        />
        <ResponsiveDialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm}>
            Start Call
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
