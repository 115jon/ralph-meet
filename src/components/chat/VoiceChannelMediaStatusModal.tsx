import { BaseModal } from "@/components/ui/BaseModal";
import { apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api-client";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import type { Channel, VoiceChannelStatusMedia, VoiceChannelStatusMediaAsset } from "@/lib/types";
import { voiceChannelStatusMediaFromGifItem } from "@/lib/voice-channel-status";
import { useChatActions } from "@/stores/chat-store";
import { Loader2, Sparkles, Upload, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

const GifPickerModal = lazy(() => import("@/components/chat/GifPickerModal"));

type VoiceStatusMediaListResponse = {
  items: VoiceChannelStatusMediaAsset[];
};

type VoiceStatusMediaUploadResponse = {
  item: VoiceChannelStatusMediaAsset;
};

interface VoiceChannelMediaStatusModalProps {
  channel: Channel;
  voiceSessionId?: string | null;
  onClose: () => void;
}

function dedupeAssets(items: VoiceChannelStatusMediaAsset[]): VoiceChannelStatusMediaAsset[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function readMediaDimensions(file: File): Promise<{ width: number; height: number }> {
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
      className="group block w-full overflow-hidden rounded-[18px] border border-white/8 bg-[#111216] p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-all hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_16px_40px_rgba(0,0,0,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div
        className="w-full overflow-hidden rounded-[14px] bg-black/25"
        style={{ aspectRatio: `${Math.max(1, media.preview_width)} / ${Math.max(1, media.preview_height)}` }}
      >
        {media.preview_content_type.startsWith("video/") ? (
          <video
            src={getMediaUrl(media.preview_url)}
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            autoPlay
            loop
            muted
            playsInline
          />
        ) : (
          <img
            src={getAuthAssetUrl(media.preview_url)}
            alt={media.alt_text ?? "Recent voice channel status media"}
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
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
        : "columns-2 sm:columns-3";

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
  channel,
  voiceSessionId = null,
  onClose,
}: VoiceChannelMediaStatusModalProps) {
  const { dispatch } = useChatActions();
  const [recentItems, setRecentItems] = useState<VoiceChannelStatusMediaAsset[]>([]);
  const [loadingRecents, setLoadingRecents] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceSessionHeaders = useMemo(
    () => (voiceSessionId ? { "X-Voice-Session-Id": voiceSessionId } : undefined),
    [voiceSessionId],
  );

  useEffect(() => {
    let cancelled = false;

    setLoadingRecents(true);
    setError(null);

    void apiGet<VoiceStatusMediaListResponse>(`/api/channels/${channel.id}/voice-status-media`, {
      headers: voiceSessionHeaders,
    })
      .then((response) => {
        if (!cancelled) {
          setRecentItems(response.items);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load recent media");
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
  }, [channel.id, voiceSessionHeaders]);

  const applyMedia = async (media: VoiceChannelStatusMedia) => {
    if (applying) return;
    setApplying(true);
    setError(null);

    try {
      const updatedChannel = await apiPatch<Channel>(`/api/channels/${channel.id}/voice-status`, {
        voice_status: {
          text: channel.voice_status?.text ?? null,
          media,
        },
      }, { headers: voiceSessionHeaders });
      dispatch({ type: "UPSERT_CHANNEL", channel: updatedChannel });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update channel media");
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
      setError(err instanceof Error ? err.message : "Failed to upload media");
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
      const response = await apiPost<VoiceStatusMediaUploadResponse, { media: VoiceChannelStatusMedia }>(
        `/api/channels/${channel.id}/voice-status-media`,
        { media },
        { headers: voiceSessionHeaders },
      );

      setRecentItems((current) => dedupeAssets([response.item, ...current]));
      setShowGifPicker(false);
      const updatedChannel = await apiPatch<Channel>(`/api/channels/${channel.id}/voice-status`, {
        voice_status: {
          text: channel.voice_status?.text ?? null,
          media: response.item.media,
        },
      }, { headers: voiceSessionHeaders });
      dispatch({ type: "UPSERT_CHANNEL", channel: updatedChannel });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update channel media");
      setShowGifPicker(false);
    } finally {
      setApplying(false);
    }
  };

  const hasRecents = recentItems.length > 0;
  const isBusy = uploading || applying;

  return (
    <BaseModal onClose={onClose}>
      <>
        <div
          className="fixed inset-0 z-1000 bg-black/68 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
        <div className="fixed inset-0 z-1001 flex items-center justify-center p-4">
          <div
            className="w-full max-w-[520px] rounded-[22px] border border-white/10 bg-[#18191d] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-channel-media-status-title"
          >
            <div className="flex items-start justify-between gap-4 px-6 py-5">
              <div>
                <h2 id="voice-channel-media-status-title" className="text-[32px] font-black tracking-tight text-rm-text">
                  Set the vibe
                </h2>
                <p className="mt-2 text-sm text-rm-text-muted">
                  Pick something and it will be set right away.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-full text-rm-text-muted transition-colors hover:bg-white/6 hover:text-rm-text"
                aria-label="Close media status editor"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 px-6 pb-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isBusy}
                  className="group flex min-h-[138px] flex-col items-center justify-center rounded-[20px] border border-white/8 bg-white/5 px-4 py-5 text-center transition-colors hover:bg-white/7 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploading ? <Loader2 className="mb-4 h-8 w-8 animate-spin text-rm-text" /> : <Upload className="mb-4 h-8 w-8 text-rm-text-muted group-hover:text-rm-text" />}
                  <span className="text-[18px] font-bold text-rm-text">Server Uploads</span>
                  <span className="mt-1 text-xs text-rm-text-muted">Upload your own image or clip</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowGifPicker(true)}
                  disabled={isBusy}
                  className="group relative min-h-[138px] overflow-hidden rounded-[20px] border border-white/8 bg-linear-to-br from-[#2b2e37] via-[#24262d] to-[#1a1b20] px-4 py-5 text-left transition-colors hover:from-[#323542] hover:to-[#1d1f24] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="absolute right-3 top-3 h-12 w-12 rounded-2xl bg-white/8" />
                  <div className="absolute bottom-3 right-10 h-8 w-8 rounded-xl bg-white/10" />
                  <div className="relative z-10 flex h-full flex-col justify-end">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/8 text-rm-text">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <span className="text-[18px] font-bold text-rm-text">Choose GIF</span>
                    <span className="mt-1 text-xs text-rm-text-muted">Open the GIF picker</span>
                  </div>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/gif,image/png,image/jpeg,image/webp,video/mp4,video/webm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleUpload(file);
                  }
                }}
              />

              {(loadingRecents || hasRecents) ? (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-rm-text">Recents</h3>
                    {loadingRecents ? (
                      <span className="text-xs text-rm-text-muted">Loading...</span>
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

              {error ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {showGifPicker ? (
          <Suspense fallback={null}>
            <GifPickerModal
              initialExpanded
              lockExpanded
              overlayZIndexClassName="z-[1100]"
              onClose={() => setShowGifPicker(false)}
              onSelect={async (gif) => {
                await handleGifSelect(voiceChannelStatusMediaFromGifItem(gif));
              }}
            />
          </Suspense>
        ) : null}
      </>
    </BaseModal>
  );
}
