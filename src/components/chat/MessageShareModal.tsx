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
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import { Icon } from "@/components/ui/icon";
import { useEffect, useId, useState } from "react";
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
  const expiryLabelId = useId();
  const expiryName = useId();
  const shareUrlId = useId();

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
      <ResponsiveDialogContent dialogClassName="flex max-h-[min(760px,calc(100dvh-48px))] flex-col">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Share message</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Creates a public snapshot link
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain md:-mx-6 md:px-6">
          <div>
            <p className="mb-2 text-ui-sm font-medium text-rm-text">
              Snapshot preview
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
              <p
                id={expiryLabelId}
                className="mb-2 text-ui-sm font-medium text-rm-text"
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
                className="text-ui-sm font-medium text-rm-text"
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

        <ResponsiveDialogFooter>
          <Button variant={shareUrl ? "ghost" : "secondary"} onClick={onClose}>
            Close
          </Button>
          {shareUrl ? (
            <>
              {onManageShares && (
                <Button variant="secondary" onClick={onManageShares}>
                  Manage shares
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
              Create link
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
