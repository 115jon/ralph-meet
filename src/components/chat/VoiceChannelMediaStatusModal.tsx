import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Spinner } from "@/components/ui/button";
import { describeApiError } from "@/lib/api-errors";
import { RowError } from "@/components/chat/settings/primitives";
import { apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api-client";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import type {
  Channel,
  VoiceChannelStatusMedia,
  VoiceChannelStatusMediaAsset,
} from "@/lib/types";
import { voiceChannelStatusMediaFromGifItem } from "@/lib/voice-channel-status";
import { useChatActions } from "@/stores/chat-store";
import { Icon } from "@/components/ui/icon";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

const GifPickerModal = lazy(() => import("@/components/chat/GifPickerModal"));

type VoiceStatusMediaListResponse = {
  items: VoiceChannelStatusMediaAsset[];
};

type VoiceStatusMediaUploadResponse = {
  item: VoiceChannelStatusMediaAsset;
};

interface VoiceChannelMediaStatusModalProps {
  open: boolean;
  channel: Channel;
  voiceSessionId?: string | null;
  onClose: () => void;
}

function dedupeAssets(
  items: VoiceChannelStatusMediaAsset[],
): VoiceChannelStatusMediaAsset[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function readMediaDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const cleanup = () => URL.revokeObjectURL(objectUrl);

    if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        cleanup();
        resolve({
          width: video.videoWidth || 1,
          height: video.videoHeight || 1,
        });
      };
      video.onerror = () => {
        cleanup();
        reject(new Error("Could not read that video file."));
      };
      video.src = objectUrl;
      return;
    }

    const image = new Image();
    image.onload = () => {
      cleanup();
      resolve({
        width: image.naturalWidth || 1,
        height: image.naturalHeight || 1,
      });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Could not read that image file."));
    };
    image.src = objectUrl;
  });
}

function VoiceStatusMediaTile({
  media,
  onClick,
  disabled,
}: {
  media: VoiceChannelStatusMedia;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="block w-full overflow-hidden rounded-lg border border-rm-border bg-rm-bg-surface p-1 transition-colors pointer-fine:hover:bg-rm-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div
        className="w-full overflow-hidden rounded-md bg-rm-bg-hover"
        style={{
          aspectRatio: `${Math.max(1, media.preview_width)} / ${Math.max(1, media.preview_height)}`,
        }}
      >
        {media.preview_content_type.startsWith("video/") ? (
          <video
            src={getMediaUrl(media.preview_url)}
            className="h-full w-full object-contain"
            autoPlay
            loop
            muted
            playsInline
            aria-label="Media preview"
          />
        ) : (
          <img
            src={getAuthAssetUrl(media.preview_url)}
            alt={media.alt_text ?? "Recent voice channel status media"}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        )}
      </div>
    </button>
  );
}

function VoiceStatusMediaMasonry({
  items,
  disabled,
  onSelect,
}: {
  items: VoiceChannelStatusMediaAsset[];
  disabled: boolean;
  onSelect: (media: VoiceChannelStatusMedia) => void;
}) {
  const columnsClassName =
    items.length <= 1
      ? "columns-1"
      : items.length === 2
        ? "columns-2"
        : "columns-2 md:columns-3";

  return (
    <div className={`${columnsClassName} [column-gap:0.75rem]`}>
      {items.map((item) => (
        <div key={item.id} className="mb-3 break-inside-avoid">
          <VoiceStatusMediaTile
            media={item.media}
            disabled={disabled}
            onClick={() => onSelect(item.media)}
          />
        </div>
      ))}
    </div>
  );
}

export default function VoiceChannelMediaStatusModal({
  open,
  channel,
  voiceSessionId = null,
  onClose,
}: VoiceChannelMediaStatusModalProps) {
  const { dispatch } = useChatActions();
  const [recentItems, setRecentItems] = useState<
    VoiceChannelStatusMediaAsset[]
  >([]);
  const [loadingRecents, setLoadingRecents] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const shouldRenderGifPicker = showGifPicker;
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceSessionHeaders = useMemo(
    () =>
      voiceSessionId ? { "X-Voice-Session-Id": voiceSessionId } : undefined,
    [voiceSessionId],
  );

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;

    setLoadingRecents(true);
    setError(null);

    void apiGet<VoiceStatusMediaListResponse>(
      `/api/channels/${channel.id}/voice-status-media`,
      {
        headers: voiceSessionHeaders,
      },
    )
      .then((response) => {
        if (!cancelled) {
          setRecentItems(response.items);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(describeApiError(err, "load recent media"));
          setRecentItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRecents(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [channel.id, open, voiceSessionHeaders]);

  const applyMedia = async (media: VoiceChannelStatusMedia) => {
    if (applying) return;
    setApplying(true);
    setError(null);

    try {
      const updatedChannel = await apiPatch<Channel>(
        `/api/channels/${channel.id}/voice-status`,
        {
          voice_status: {
            text: channel.voice_status?.text ?? null,
            media,
          },
        },
        { headers: voiceSessionHeaders },
      );
      dispatch({ type: "UPSERT_CHANNEL", channel: updatedChannel });
      onClose();
    } catch (err) {
      setError(describeApiError(err, "update the channel media"));
    } finally {
      setApplying(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);

    try {
      const dimensions = await readMediaDimensions(file);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("preview_width", String(dimensions.width));
      formData.append("preview_height", String(dimensions.height));

      const response = await apiUpload<VoiceStatusMediaUploadResponse>(
        `/api/channels/${channel.id}/voice-status-media`,
        formData,
        { headers: voiceSessionHeaders },
      );

      setRecentItems((current) => dedupeAssets([response.item, ...current]));
      await applyMedia(response.item.media);
    } catch (err) {
      setError(describeApiError(err, "upload that media"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleGifSelect = async (media: VoiceChannelStatusMedia) => {
    setApplying(true);
    setError(null);

    try {
      const response = await apiPost<
        VoiceStatusMediaUploadResponse,
        { media: VoiceChannelStatusMedia }
      >(
        `/api/channels/${channel.id}/voice-status-media`,
        { media },
        { headers: voiceSessionHeaders },
      );

      setRecentItems((current) => dedupeAssets([response.item, ...current]));
      setShowGifPicker(false);
      const updatedChannel = await apiPatch<Channel>(
        `/api/channels/${channel.id}/voice-status`,
        {
          voice_status: {
            text: channel.voice_status?.text ?? null,
            media: response.item.media,
          },
        },
        { headers: voiceSessionHeaders },
      );
      dispatch({ type: "UPSERT_CHANNEL", channel: updatedChannel });
      onClose();
    } catch (err) {
      setError(describeApiError(err, "update the channel media"));
      setShowGifPicker(false);
    } finally {
      setApplying(false);
    }
  };

  const hasRecents = recentItems.length > 0;
  const isBusy = uploading || applying;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent dialogClassName="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Set the vibe</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Pick something and it will be set right away.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className="group flex min-h-36 flex-col items-center justify-center rounded-lg border border-rm-border bg-rm-bg-surface px-4 py-5 text-center transition-colors pointer-fine:hover:bg-rm-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? (
              <span role="status" className="mb-4 text-rm-text">
                <Spinner className="size-8" />
                <span className="sr-only">Uploading</span>
              </span>
            ) : (
              <Icon
                name="upload"
                size="2xl"
                className="mb-4 text-rm-text-muted pointer-fine:group-hover:text-rm-text"
              />
            )}
            <span className="text-ui-lg font-semibold text-rm-text">
              Server Uploads
            </span>
            <span className="mt-1 text-ui-xs text-rm-text-muted">
              Upload your own image or clip
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowGifPicker(true)}
            disabled={isBusy}
            className="relative min-h-36 overflow-hidden rounded-lg border border-rm-border bg-rm-bg-surface px-4 py-5 text-left transition-colors pointer-fine:hover:bg-rm-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="absolute right-3 top-3 size-12 rounded-lg bg-rm-bg-hover" />
            <div className="absolute bottom-3 right-10 size-8 rounded-md bg-rm-bg-hover" />
            <div className="relative z-10 flex h-full flex-col justify-end">
              <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-rm-bg-hover text-rm-text">
                <Icon name="sparkle" size="lg" />
              </div>
              <span className="text-ui-lg font-semibold text-rm-text">
                Choose GIF
              </span>
              <span className="mt-1 text-ui-xs text-rm-text-muted">
                Open the GIF picker
              </span>
            </div>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/gif,image/png,image/jpeg,image/webp,video/mp4,video/webm"
          aria-label="Upload media status"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleUpload(file);
            }
          }}
        />

        {loadingRecents || hasRecents ? (
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-ui-sm font-semibold text-rm-text">Recents</h3>
              {loadingRecents ? (
                <span className="text-ui-xs text-rm-text-muted">
                  Loading...
                </span>
              ) : null}
            </div>

            {hasRecents ? (
              <VoiceStatusMediaMasonry
                items={recentItems}
                disabled={isBusy}
                onSelect={(media) => {
                  void applyMedia(media);
                }}
              />
            ) : null}
          </div>
        ) : null}

        {error ? <RowError>{error}</RowError> : null}

        {/* Opened from this dialog: GifPickerModal's default overlay layer is
            z-60, the stacked layer (11.1), above this dialog's z-50. */}
        <Suspense fallback={null}>
          <GifPickerModal
            open={shouldRenderGifPicker}
            initialExpanded
            lockExpanded
            onClose={() => setShowGifPicker(false)}
            onSelect={async (gif) => {
              await handleGifSelect(voiceChannelStatusMediaFromGifItem(gif));
            }}
          />
        </Suspense>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
