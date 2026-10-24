"use client";

import { useId, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type BanTarget = { userId: string; username: string };

/**
 * Ban with an optional reason (replaces `window.prompt`). A failure stays in
 * the dialog beside the reason so the moderator can retry.
 */
export function BanMemberDialog({
  target,
  onClose,
  onBan,
  forceMode,
}: {
  target: BanTarget | null;
  onClose: () => void;
  onBan: (target: BanTarget, reason: string) => Promise<unknown>;
  forceMode?: "dialog" | "drawer";
}) {
  const reasonId = useId();
  const [reason, setReason] = useState("");

  return (
    <ConfirmDialog
      open={target !== null}
      forceMode={forceMode}
      onOpenChange={(open) => {
        if (open) return;
        setReason("");
        onClose();
      }}
      title="Ban member"
      description={`${target?.username ?? ""} will be removed from this server and can't rejoin until unbanned.`}
      confirmLabel="Ban"
      // Reversible from Server settings > Bans, so the red tint (13.2).
      errorAction="ban this member"
      onConfirm={() => (target ? onBan(target, reason.trim()) : undefined)}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={reasonId}>
          Reason{" "}
          <span className="font-normal text-rm-text-muted">(optional)</span>
        </Label>
        <Input
          id={reasonId}
          value={reason}
          maxLength={512}
          autoComplete="off"
          className="max-md:min-h-11 max-md:text-ui-md"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
}
