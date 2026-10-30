"use client";

import { ConfirmCallDialog } from "@/components/chat/ConfirmCallDialog";
import { START_CALL_CONFIRM_KEY } from "@/components/chat/voice-confirmation-preferences";

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
  return (
    <ConfirmCallDialog
      open={open}
      title={`Call ${targetName}?`}
      description={<>This rings {targetName} right away.</>}
      confirmLabel="Start call"
      skipConfirmKey={START_CALL_CONFIRM_KEY}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
