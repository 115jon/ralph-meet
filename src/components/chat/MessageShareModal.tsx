import { Button } from "@/components/ui/button";
import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import type { Message } from "@/lib/types";
import { isPlayableVideo } from "@/lib/media";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useEffect, useState } from "react";
import ShareSnapshotPreview from "./ShareSnapshotPreview";

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

  const avatarUrl = message.author?.avatar_url
    ? getAuthAssetUrl(message.author.avatar_url)
    : null;
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
    } catch (err: any) {
      setError(err?.message || "This message cannot be shared publicly.");
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
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <div
          data-state={open ? "open" : "closed"}
          className={cn(
            "fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm transition-opacity duration-200 md:items-center md:p-6",
            "animate-in fade-in data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 data-[state=closed]:animate-out data-[state=closed]:fade-out",
          )}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
          role="presentation"
        >
          <DialogSurface
            showCloseButton={false}
            className={cn(
              "relative m-0 flex max-h-[calc(100dvh-16px)] w-full max-w-[560px] flex-col overflow-hidden rounded-t-xl border border-rm-border bg-rm-bg-surface dark:bg-rm-bg-elevated p-0 shadow-[var(--rm-shadow-3)] outline-none md:max-h-[min(760px,calc(100dvh-48px))] md:rounded-xl",
              "animate-in fade-in zoom-in-95 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
            )}
            aria-labelledby="message-share-title"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-rm-border px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rm-accent-tint text-rm-accent-ink">
                  <Icon name="share" size="sm" />
                </div>
                <div>
                  <h2
                    id="message-share-title"
                    className="text-ui-lg font-semibold text-rm-text"
                  >
                    Share Message
                  </h2>
                  <p className="text-xs text-rm-text-muted">
                    Creates a public snapshot link
                  </p>
                </div>
              </div>
              <IconButton
                icon="close"
                iconSize="sm"
                shape="circle"
                onClick={onClose}
                aria-label="Close"
              />
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 custom-scrollbar">
              <div>
                <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] mb-2 text-rm-text-muted">
                  Snapshot Preview
                </p>
                <ShareSnapshotPreview
                  content={message.content}
                  author={{
                    username: message.author?.username ?? "Unknown",
                    display_name: message.author?.display_name ?? null,
                    avatar_url: message.author?.avatar_url ?? null,
                    avatar_display: message.author?.avatar_display ?? null,
                  }}
                  createdAt={message.created_at}
                  attachments={message.attachments ?? []}
                  omittedAttachmentCount={omittedAttachmentCount}
                  embeds={message.embeds ?? []}
                  reactions={
                    message.reactions?.map((reaction) => ({
                      emoji: reaction.emoji,
                      count: reaction.count,
                    })) ?? []
                  }
                  replyCount={message.reply_count ?? 0}
                  avatarUrl={avatarUrl}
                  mediaUrlForAttachment={(attachment) =>
                    getMediaUrl(attachment.url || `/api/${attachment.file_key}`)
                  }
                  compact
                  previewMedia
                />
              </div>

              {!shareUrl && (
                <div>
                  <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] mb-2 text-rm-text-muted">
                    Link Expiry
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {expiryOptions.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        variant={
                          expires === option.value ? "secondary" : "outline"
                        }
                        aria-pressed={expires === option.value}
                        onClick={() => setExpires(option.value)}
                        className={cn(
                          expires === option.value
                            ? "bg-rm-accent-tint text-rm-accent-ink"
                            : "border-rm-border text-rm-text-secondary",
                        )}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              {shareUrl && (
                <div className="space-y-3">
                  <label
                    htmlFor="message-share-url"
                    className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted"
                  >
                    Public Link
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="message-share-url"
                      value={shareUrl}
                      readOnly
                      className="flex-1"
                      onFocus={(event) => event.target.select()}
                    />
                    <Button onClick={copyLink} className="h-9">
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

            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-rm-border px-5 py-4 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button
                variant={shareUrl ? "ghost" : "secondary"}
                onClick={onClose}
              >
                Close
              </Button>
              {shareUrl ? (
                <>
                  {onManageShares && (
                    <Button variant="secondary" onClick={onManageShares}>
                      Manage Shares
                    </Button>
                  )}
                  <Button asChild variant="secondary">
                    <a href={shareUrl} target="_blank" rel="noreferrer">
                      <Icon name="externalLink" size="sm" />
                      Open
                    </a>
                  </Button>
                </>
              ) : (
                <Button
                  onClick={createShare}
                  disabled={creating}
                  loading={creating}
                >
                  <Icon name="share" size="sm" />
                  Create Link
                </Button>
              )}
            </div>
          </DialogSurface>
        </div>
      </DialogPortal>
    </Dialog>
  );
}
