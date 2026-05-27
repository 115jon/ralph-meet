import { BaseModal } from "@/components/ui/BaseModal";
import type { Message } from "@/lib/types";
import { isPlayableVideo } from "@/lib/media";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Check, Copy, ExternalLink, Loader2, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import ShareSnapshotPreview from "./ShareSnapshotPreview";

type ShareExpiry = "7d" | "30d" | "90d" | "never";

interface MessageShareModalProps {
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

export default function MessageShareModal({ message, onClose, onCreateShare, onManageShares }: MessageShareModalProps) {
  const [expires, setExpires] = useState<ShareExpiry>("30d");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);

  const avatarUrl = message.author?.avatar_url ? getAuthAssetUrl(message.author.avatar_url) : null;
  const omittedAttachmentCount = (message.attachments ?? []).filter(
    (attachment) => !attachment.content_type?.startsWith("image/") && !isPlayableVideo(attachment.content_type)
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
        () => setCopyState("idle")
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
    <BaseModal onClose={onClose}>
      <div
        className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6"
        onClick={onClose}
        role="presentation"
      >
        <div
          className="flex max-h-[calc(100dvh-16px)] w-full max-w-[560px] flex-col overflow-hidden rounded-t-xl border border-rm-border bg-rm-bg-primary shadow-2xl md:max-h-[min(760px,calc(100dvh-48px))] md:rounded-xl"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="message-share-title"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-rm-border px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Share2 className="h-4 w-4" />
              </div>
              <div>
                <h2 id="message-share-title" className="text-base font-bold text-rm-text">
                  Share Message
                </h2>
                <p className="text-xs text-rm-text-muted">Creates a public snapshot link</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-rm-text"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 custom-scrollbar">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-rm-text-muted">
                Snapshot Preview
              </p>
              <ShareSnapshotPreview
                content={message.content}
                author={{
                  username: message.author?.username ?? "Unknown",
                  display_name: message.author?.display_name ?? null,
                  avatar_url: message.author?.avatar_url ?? null,
                }}
                createdAt={message.created_at}
                attachments={message.attachments ?? []}
                omittedAttachmentCount={omittedAttachmentCount}
                embeds={message.embeds ?? []}
                reactions={message.reactions?.map((reaction) => ({ emoji: reaction.emoji, count: reaction.count })) ?? []}
                replyCount={message.reply_count ?? 0}
                avatarUrl={avatarUrl}
                mediaUrlForAttachment={(attachment) => getMediaUrl(attachment.url || `/api/${attachment.file_key}`)}
                compact
                previewMedia
              />
            </div>

            {!shareUrl && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-rm-text-muted">
                  Link Expiry
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {expiryOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setExpires(option.value)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm font-bold transition",
                        expires === option.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-rm-border bg-rm-bg-surface text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
                      )}
                    >
                      {option.label}
                    </button>
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
                <label htmlFor="message-share-url" className="text-xs font-bold uppercase tracking-wider text-rm-text-muted">
                  Public Link
                </label>
                <div className="flex gap-2">
                  <input
                    id="message-share-url"
                    value={shareUrl}
                    readOnly
                    className="min-w-0 flex-1 rounded-lg border border-rm-border bg-rm-bg-surface px-3 py-2 text-sm text-rm-text outline-none"
                    onFocus={(event) => event.target.select()}
                  />
                  <button
                    onClick={copyLink}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition hover:brightness-110"
                  >
                    {copyState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copyState === "copied" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-rm-border px-5 py-4">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-bold text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-rm-text"
            >
              Close
            </button>
            {shareUrl ? (
              <>
                {onManageShares && (
                  <button
                    onClick={onManageShares}
                    className="inline-flex items-center gap-2 rounded-lg border border-rm-border px-4 py-2 text-sm font-bold text-rm-text-secondary transition hover:bg-rm-bg-hover hover:text-rm-text"
                  >
                    Manage Shares
                  </button>
                )}
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-rm-border px-4 py-2 text-sm font-bold text-rm-text-secondary transition hover:bg-rm-bg-hover hover:text-rm-text"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open
                </a>
              </>
            ) : (
              <button
                onClick={createShare}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                {creating ? "Creating..." : "Create Link"}
              </button>
            )}
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
