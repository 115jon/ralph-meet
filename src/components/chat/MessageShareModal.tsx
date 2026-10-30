import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { RadioList, RowError } from "@/components/chat/settings/primitives";
import { describeApiError } from "@/lib/api-errors";
import type { Message } from "@/lib/types";
import { isPlayableVideo } from "@/lib/media";
import { lastInputWasKeyboard } from "@/components/ui/dialog-stack";
import { Icon } from "@/components/ui/icon";
import { useEffect, useId, useState } from "react";
import { MessagePreviewCard } from "./MessagePreviewCard";

type ShareExpiry = "7d" | "30d" | "90d" | "never";

interface MessageShareModalProps {
  open: boolean;
  message: Message;
  onClose: () => void;
  onCreateShare: (messageId: string, expires: ShareExpiry) => Promise<string>;
  onManageShares?: () => void;
}

const expiryOptions: Array<{ value: ShareExpiry; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "never", label: "Never" },
];

function focusSurfaceUnlessKeyboard(event: Event) {
  if (lastInputWasKeyboard()) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
}

export default function MessageShareModal({
  open,
  message,
  onClose,
  onCreateShare,
  onManageShares,
}: MessageShareModalProps) {
  const [expires, setExpires] = useState<ShareExpiry>("30d");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);
  const expiryLabelId = useId();
  const expiryName = useId();
  const shareUrlId = useId();

  const omittedAttachmentCount = (message.attachments ?? []).filter(
    (attachment) =>
      !attachment.content_type?.startsWith("image/") &&
      !isPlayableVideo(attachment.content_type),
  ).length;

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const createShare = async () => {
    setCreating(true);
    setError(null);
    try {
      const url = await onCreateShare(message.id, expires);
      setShareUrl(url);
      await navigator.clipboard.writeText(url).then(
        () => setCopyState("copied"),
        () => setCopyState("idle"),
      );
    } catch (err) {
      setError(describeApiError(err, "share this message"));
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopyState("copied");
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent
        size="md"
        placement="top"
        dialogClassName="flex flex-col"
        // Keyboard opens land on the first expiry option. A pointer open
        // lands on the surface, so no ring shows on an option nobody chose.
        onOpenAutoFocus={focusSurfaceUnlessKeyboard}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Share message</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Creates a public snapshot link
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain md:-mx-5 md:px-5">
          <div
            inert
            aria-hidden="true"
            className="pointer-events-none select-none"
          >
            <MessagePreviewCard message={message}>
              {omittedAttachmentCount > 0 ? (
                <p className="mt-2 text-ui-xs text-pretty text-ink-3">
                  {omittedAttachmentCount === 1
                    ? "1 file isn't included in the public link."
                    : `${omittedAttachmentCount} files aren't included in the public link.`}
                </p>
              ) : null}
            </MessagePreviewCard>
          </div>

          {!shareUrl && (
            <div>
              <p
                id={expiryLabelId}
                className="mb-2 text-ui-sm font-medium text-ink-1"
              >
                Link expiry
              </p>
              <RadioList
                ids={{ labelId: expiryLabelId }}
                name={expiryName}
                value={expires}
                options={expiryOptions}
                onChange={setExpires}
                disabled={creating}
              />
              {error && <RowError>{error}</RowError>}
            </div>
          )}

          {shareUrl && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor={shareUrlId}
                className="text-ui-sm font-medium text-ink-1"
              >
                Public link
              </label>
              <div className="flex gap-2">
                <Input
                  id={shareUrlId}
                  value={shareUrl}
                  readOnly
                  className="flex-1"
                  onFocus={(event) => event.target.select()}
                />
                <Button variant="secondary" onClick={copyLink}>
                  {copyState === "copied" ? (
                    <Icon name="check" size="sm" />
                  ) : (
                    <Icon name="copy" size="sm" />
                  )}
                  {copyState === "copied" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <ResponsiveDialogFooter>
          {shareUrl ? (
            <>
              {onManageShares && (
                <Button
                  variant="ghost"
                  onClick={onManageShares}
                  className="md:mr-auto"
                >
                  Manage shares
                </Button>
              )}
              <Button asChild variant="secondary">
                <a href={shareUrl} target="_blank" rel="noreferrer">
                  <Icon name="externalLink" size="sm" />
                  Open
                </a>
              </Button>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={createShare}
                disabled={creating}
                loading={creating}
              >
                <Icon name="share" size="sm" />
                Create link
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
