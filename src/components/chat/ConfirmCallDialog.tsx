"use client";

import { useCallback, useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

/**
 * The confirm template shared by VoiceSwitchModal and StartCallModal: a
 * question as the title, one plain sentence of consequence as the body, an
 * optional "Don't ask again" row, then Cancel and the verb. Initial focus is
 * on the verb button, never on the checkbox, so Space can't tick it by
 * accident.
 */
export function ConfirmCallDialog({
  open,
  title,
  description,
  confirmLabel,
  skipConfirmKey,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  /** The verb on the primary button ("Switch", "Start call"). */
  confirmLabel: string;
  /** localStorage flag that "Don't ask again" sets. */
  skipConfirmKey: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const checkboxId = useId();

  const handleConfirm = useCallback(() => {
    if (dontAskAgain) {
      try {
        localStorage.setItem(skipConfirmKey, "true");
      } catch {
        /* quota / private-mode: silently ignore */
      }
    }
    onConfirm();
  }, [dontAskAgain, onConfirm, skipConfirmKey]);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onCancel()}
    >
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {description}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <label
          htmlFor={checkboxId}
          className="flex w-fit cursor-pointer items-center gap-2 text-ui-sm text-ink-2 select-none pointer-coarse:min-h-11 pointer-fine:hover:text-ink-1"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={dontAskAgain}
            onChange={(event) => setDontAskAgain(event.target.checked)}
            className="size-4 shrink-0 cursor-pointer rounded-xs accent-primary-fill"
          />
          Don&apos;t ask again
        </label>
        <ResponsiveDialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" autoFocus onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
