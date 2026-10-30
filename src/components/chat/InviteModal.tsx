/**
 * Invite people to a server: pick expiry and uses, generate a link, copy it.
 * The kit's C1 plate (DESIGN.md, Dialog): a silkscreen kicker ("Invite ·
 * server"), the Bricolage title, the dithered rule, a 15/22 body, fields as
 * legend plates on ply-3 with 48px controls, and a footer of 48px keys: a
 * ghost Cancel (Done once there is a link) beside the notched primary. A
 * form dialog (md, top-anchored); a bottom sheet below md.
 */

import { Button } from "@/components/ui/button";
import { DialogKicker, DialogRule } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { FieldPlate, Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyToClipboard } from "@/components/ui/toast";
import { apiPost } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { getWebOrigin } from "@/lib/platform";
import { useEffect, useRef, useState } from "react";
import InlineEmojiText from "./InlineEmojiText";
import { RowError } from "./settings/primitives";

interface InviteModalProps {
  open: boolean;
  serverId: string;
  serverName: string;
  onClose: () => void;
}

export default function InviteModal({
  open,
  serverId,
  serverName,
  onClose,
}: InviteModalProps) {
  const [state, setState] = useState({
    inviteCode: "",
    loading: false,
    copied: false,
    expiresHours: 24,
    maxUses: 0,
    error: null as string | null,
  });
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    // A reopened controlled dialog starts a fresh invite flow.
    setState((previous) => ({
      ...previous,
      inviteCode: "",
      loading: false,
      copied: false,
      error: null,
    }));
  }, [open, serverId]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const firstSelectRef = useRef<HTMLButtonElement>(null);

  const createInvite = async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await apiPost<{ code: string }>(
        `/api/servers/${serverId}/invites`,
        {
          expires_hours: state.expiresHours || null,
          max_uses: state.maxUses || null,
        },
      );
      setState((prev) => ({ ...prev, inviteCode: data.code }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: describeApiError(err, "create the invite link"),
      }));
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  };

  const link = `${getWebOrigin()}/invite/${state.inviteCode}`;

  const copyLink = async () => {
    if (!(await copyToClipboard(link, "Link copied"))) return;
    setState((prev) => ({ ...prev, copied: true }));
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(
      () => setState((prev) => ({ ...prev, copied: false })),
      2000,
    );
  };

  const selectStyle = "w-full";

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent
        size="md"
        placement="top"
        // Desktop only (the drawer drops this): start on the first field. On a
        // phone focus stays on the sheet so nothing pops open under the thumb.
        onOpenAutoFocus={(event) => {
          if (!firstSelectRef.current) return;
          event.preventDefault();
          firstSelectRef.current.focus();
        }}
      >
        <ResponsiveDialogHeader>
          <DialogKicker>
            Invite · <InlineEmojiText text={serverName} />
          </DialogKicker>
          <ResponsiveDialogTitle>
            Invite people to <InlineEmojiText text={serverName} />
          </ResponsiveDialogTitle>
          <DialogRule />
          <ResponsiveDialogDescription className="mt-2">
            {state.inviteCode
              ? "Share this link with others to let them join your server."
              : "Choose how long the link lasts and how many people can use it."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {!state.inviteCode ? (
          <div className="flex flex-col gap-4">
            <FieldPlate
              label="Expire after"
              htmlFor="expire-after"
              ground="ply-3"
            >
              <Select
                value={String(state.expiresHours)}
                onValueChange={(value) =>
                  setState((prev) => ({
                    ...prev,
                    expiresHours: Number(value),
                  }))
                }
              >
                <SelectTrigger
                  ref={firstSelectRef}
                  id="expire-after"
                  size="lg"
                  className={selectStyle}
                >
                  <SelectValue placeholder="Expire after" />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="1">1 hour</SelectItem>
                  <SelectItem value="6">6 hours</SelectItem>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="168">7 days</SelectItem>
                  <SelectItem value="0">Never</SelectItem>
                </SelectContent>
              </Select>
            </FieldPlate>
            <FieldPlate label="Max uses" htmlFor="max-uses" ground="ply-3">
              <Select
                value={String(state.maxUses)}
                onValueChange={(value) =>
                  setState((prev) => ({
                    ...prev,
                    maxUses: Number(value),
                  }))
                }
              >
                <SelectTrigger id="max-uses" size="lg" className={selectStyle}>
                  <SelectValue placeholder="Maximum uses" />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="0">No limit</SelectItem>
                  <SelectItem value="1">1 use</SelectItem>
                  <SelectItem value="5">5 uses</SelectItem>
                  <SelectItem value="10">10 uses</SelectItem>
                  <SelectItem value="25">25 uses</SelectItem>
                  <SelectItem value="100">100 uses</SelectItem>
                </SelectContent>
              </Select>
            </FieldPlate>
            {state.error ? (
              <RowError className="mt-0">{state.error}</RowError>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <FieldPlate
              label="Invite link"
              htmlFor="invite-link"
              ground="ply-3"
              className="w-full"
            >
              <Input
                id="invite-link"
                inputSize="lg"
                value={link}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </FieldPlate>
            <Button
              variant="rule"
              onClick={() => setState((prev) => ({ ...prev, inviteCode: "" }))}
            >
              Generate new link
            </Button>
          </div>
        )}

        <ResponsiveDialogFooter>
          {state.inviteCode ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Done
              </Button>
              <Button variant="primary" onClick={() => void copyLink()}>
                <Icon name={state.copied ? "check" : "copy"} size="sm" />
                {state.copied ? "Copied" : "Copy link"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void createInvite()}
                loading={state.loading}
              >
                Generate invite link
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
