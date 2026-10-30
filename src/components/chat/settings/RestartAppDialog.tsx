"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { RowError } from "./primitives";

export interface RestartAppDialogProps {
  open: boolean;
  /** Called with `false` on Cancel, Escape, back or a scrim tap. */
  onOpenChange: (open: boolean) => void;
  /** "Restart now". */
  onConfirm: () => void;
  /** The question, e.g. "Turn off hardware acceleration?". */
  title: ReactNode;
  /** Defaults to the restart/leave-call explanation. */
  description?: ReactNode;
  /** Restart in flight: the confirm button spins and Cancel is disabled. */
  restarting?: boolean;
  /** Why the last attempt failed; the dialog stays open to retry. */
  error?: ReactNode;
}

const DEFAULT_DESCRIPTION =
  "Ralph Meet restarts to apply this. If you're in a call, you'll leave it and can rejoin after the restart.";

/**
 * Confirm before restarting the desktop app. Opens over the Settings dialog
 * (z-50), so the surface sits on the modal-stacked layer (z-60); Escape and
 * back close only this confirm.
 */
export function RestartAppDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description = DEFAULT_DESCRIPTION,
  restarting = false,
  error,
}: RestartAppDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent size="sm" className="z-60">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {description}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {error ? <RowError className="mt-0">{error}</RowError> : null}
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={restarting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" loading={restarting} onClick={onConfirm}>
            Restart now
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
