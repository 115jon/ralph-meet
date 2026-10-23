import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiPost } from "@/lib/api-client";
import { getWebOrigin } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import InlineEmojiText from "./InlineEmojiText";
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
  });

  useEffect(() => {
    if (!open) return;
    // A reopened controlled dialog starts a fresh invite flow.
    setState((previous) => ({
      ...previous,
      inviteCode: "",
      loading: false,
      copied: false,
    }));
  }, [open, serverId]);

  const firstSelectRef = useRef<HTMLButtonElement>(null);

  const createInvite = async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await apiPost<{ code: string }>(
        `/api/servers/${serverId}/invites`,
        {
          expires_hours: state.expiresHours || null,
          max_uses: state.maxUses || null,
        },
      );
      setState((prev) => ({ ...prev, inviteCode: data.code }));
    } catch (err: any) {
      console.error("Failed to create invite:", err);
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  };

  const copyLink = async () => {
    const link = `${getWebOrigin()}/invite/${state.inviteCode}`;
    await navigator.clipboard.writeText(link);
    setState((prev) => ({ ...prev, copied: true }));
    setTimeout(() => setState((prev) => ({ ...prev, copied: false })), 2000);
  };

  const selectStyle = "w-full max-md:min-h-11";

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent
        className="md:max-w-md"
        // Desktop only (the drawer drops this): start on the first field. On a
        // phone focus stays on the sheet so nothing pops open under the thumb.
        onOpenAutoFocus={(event) => {
          if (!firstSelectRef.current) return;
          event.preventDefault();
          firstSelectRef.current.focus();
        }}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            Invite people to{" "}
            <InlineEmojiText text={serverName} className="text-rm-accent-ink" />
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            Generate an invite link for this server.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div>
          {!state.inviteCode ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="expire-after">Expire after</Label>
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
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="max-uses">Max uses</Label>
                <Select
                  value={String(state.maxUses)}
                  onValueChange={(value) =>
                    setState((prev) => ({
                      ...prev,
                      maxUses: Number(value),
                    }))
                  }
                >
                  <SelectTrigger id="max-uses" className={selectStyle}>
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
              </div>
              <Button
                className="w-full max-md:min-h-11"
                size="lg"
                onClick={createInvite}
                disabled={state.loading}
                loading={state.loading}
              >
                Generate Invite Link
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={`${getWebOrigin()}/invite/${state.inviteCode}`}
                  readOnly
                  aria-label="Invite link"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 max-md:min-h-11"
                />
                <Button
                  variant="secondary"
                  onClick={copyLink}
                  className={cn(
                    "h-9 max-md:min-h-11",
                    state.copied && "text-rm-accent-ink",
                  )}
                >
                  {state.copied ? (
                    <>
                      <Icon name="check" size="sm" /> Copied
                    </>
                  ) : (
                    <>
                      <Icon name="copy" size="sm" /> Copy
                    </>
                  )}
                </Button>
              </div>
              <p className="text-ui-xs text-rm-text-muted">
                Share this link with others to let them join your server.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setState((prev) => ({ ...prev, inviteCode: "" }))
                }
                className="-ml-2.5 text-rm-text-secondary"
              >
                Generate New Link
              </Button>
            </div>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
