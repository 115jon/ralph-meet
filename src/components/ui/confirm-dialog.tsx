"use client";

/**
 * Confirm for an action started from a menu, row or toolbar, where there is no
 * inline spot for a ConfirmStrip: a centred dialog on desktop, a bottom drawer
 * on phones (13.1). Replaces `window.confirm`.
 *
 *   <ConfirmDialog
 *     open={target !== null}
 *     onOpenChange={(open) => !open && setTarget(null)}
 *     title="Delete channel"
 *     description={`#${target?.name} and its messages will be deleted.`}
 *     confirmLabel="Delete channel"
 *     irreversible
 *     errorAction="delete this channel"
 *     onConfirm={() => deleteChannel(target!.id)}
 *   />
 *
 * `onConfirm` may return a promise: the confirm button shows a spinner while
 * it runs, the dialog closes when it resolves, and a rejection keeps the
 * dialog open with the failure (describeApiError) above the buttons so the
 * person can retry or back out.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { describeApiError } from "@/lib/api-errors";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /** Verb + object, matching the menu item that opened it. */
  confirmLabel: string;
  cancelLabel?: string;
  /**
   * Solid danger fill for what can't be undone (delete, kick). Reversible
   * actions use the red tint (13.2).
   */
  irreversible?: boolean;
  /** Completes "Unable to …" in the failure copy, e.g. "delete this channel". */
  errorAction?: string;
  onConfirm: () => void | Promise<unknown>;
  /** Fixtures: pin the dialog or drawer form. */
  forceMode?: "dialog" | "drawer";
  /** Extra fields between the description and the buttons (a reason). */
  children?: React.ReactNode;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  irreversible = false,
  errorAction = "finish that",
  onConfirm,
  forceMode,
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const close = () => {
    setError(null);
    onOpenChange(false);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      close();
    } catch (err) {
      setError(describeApiError(err, errorAction));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      forceMode={forceMode}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!busy) close();
      }}
    >
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {description}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {children}
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-rm-danger-tint px-3 py-2 text-ui-sm text-rm-danger-ink"
          >
            <Icon name="warning" size="sm" className="mt-px shrink-0" />
            <span className="min-w-0">{error}</span>
          </p>
        ) : null}
        <ResponsiveDialogFooter>
          <Button variant="secondary" disabled={busy} onClick={close}>
            {cancelLabel}
          </Button>
          <Button
            variant={irreversible ? "danger" : "destructive"}
            loading={busy}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
