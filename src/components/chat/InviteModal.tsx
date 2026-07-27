import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useEffect, useState } from "react";
import { Check, Copy, Loader2, X } from "./Icons";
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

  // Close on Escape

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

  const selectStyle =
    "w-full rounded-xl border border-rm-border bg-rm-bg-surface px-3 py-2.5 text-sm text-rm-text outline-none transition-all focus:border-primary/30 focus:ring-2 focus:ring-primary/20";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="relative w-full max-w-[440px] animate-in fade-in zoom-in-95 rounded-2xl border border-rm-border bg-rm-bg-primary p-6 shadow-2xl duration-200"
      >
        <div>
          <DialogClose asChild>
            <button
              type="button"
              className="absolute right-4 top-4 rounded-lg p-1 text-rm-text-muted/40 transition-colors hover:text-rm-text outline-none"
              aria-label="Close invite modal"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>

          <DialogTitle className="mb-6 text-base font-semibold text-rm-text">
            Invite people to{" "}
            <InlineEmojiText text={serverName} className="text-primary" />
          </DialogTitle>
          <DialogDescription className="sr-only">
            Generate an invite link for this server.
          </DialogDescription>

          {!state.inviteCode ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="expire-after"
                  className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted/40"
                >
                  Expire after
                </label>
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
                    id="expire-after"
                    aria-label="Expire after"
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
              <div className="space-y-2">
                <label
                  htmlFor="max-uses"
                  className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted/40"
                >
                  Max uses
                </label>
                <Select
                  value={String(state.maxUses)}
                  onValueChange={(value) =>
                    setState((prev) => ({
                      ...prev,
                      maxUses: Number(value),
                    }))
                  }
                >
                  <SelectTrigger
                    id="max-uses"
                    aria-label="Maximum uses"
                    className={selectStyle}
                  >
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
              <button
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:brightness-110 disabled:opacity-40"
                onClick={createInvite}
                disabled={state.loading}
              >
                {state.loading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {state.loading ? "Creating..." : "Generate Invite Link"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={`${getWebOrigin()}/invite/${state.inviteCode}`}
                  readOnly
                  aria-label="Invite link"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 rounded-xl border border-rm-border bg-rm-bg-surface px-3 py-2.5 text-sm text-rm-text outline-none"
                />
                <button
                  onClick={copyLink}
                  className={cn(
                    "flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
                    state.copied
                      ? "border-primary/30 bg-primary/20 text-primary"
                      : "border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover",
                  )}
                >
                  {state.copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-rm-text-muted">
                Share this link with others to let them join your server.
              </p>
              <button
                onClick={() =>
                  setState((prev) => ({ ...prev, inviteCode: "" }))
                }
                className="text-xs font-medium text-rm-text-muted/60 transition-colors hover:text-rm-text outline-none"
              >
                Generate New Link
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
