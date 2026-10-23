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
import { VOICE_SWITCH_CONFIRM_KEY } from "@/components/chat/voice-confirmation-preferences";
import { useCallback, useState } from "react";

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
}: VoiceSwitchModalProps) {
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

  const bodyText =
    currentType === "call"
      ? `Looks like you're in a call. Are you sure you want to switch to `
      : `Looks like you're in another voice channel. Are you sure you want to switch to `;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onCancel()}
    >
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>You sure?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {bodyText}
            <span className="font-semibold text-rm-text">{targetName}</span>?
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
            Confirm
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
