"use client";

import { ConfirmCallDialog } from "@/components/chat/ConfirmCallDialog";
import { VOICE_SWITCH_CONFIRM_KEY } from "@/components/chat/voice-confirmation-preferences";

interface VoiceSwitchModalProps {
  /** Whether the modal is visible */
  open: boolean;
  /** Display name of the target channel / call the user wants to switch to */
  targetName: string;
  /** What kind of voice session the user is currently in */
  currentType: "voice" | "call";
  /**
   * Name of the channel or call being left ("Standup"). Without it the body
   * falls back to "your current voice channel" / "your current call".
   */
  currentName?: string;
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
  currentName,
  onConfirm,
  onCancel,
}: VoiceSwitchModalProps) {
  const leaving =
    currentName ??
    (currentType === "call"
      ? "your current call"
      : "your current voice channel");

  return (
    <ConfirmCallDialog
      open={open}
      title={`Switch to ${targetName}?`}
      description={<>You&apos;ll leave {leaving}.</>}
      confirmLabel="Switch"
      skipConfirmKey={VOICE_SWITCH_CONFIRM_KEY}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
