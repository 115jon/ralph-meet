import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { apiDelete, apiGet } from "@/lib/api-client";
import { getApiBaseUrl, getAuthAssetUrl } from "@/lib/platform";
import { buildProxyMediaUrl } from "@/lib/proxy-media-url";
import { cn } from "@/lib/utils";
import type { GifPickerItem } from "@/lib/gif-picker";
import { Icon } from "@/components/ui/icon";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

const GifPickerModal = lazy(() => import("@/components/chat/GifPickerModal"));

export interface AvatarUploadItem {
  id: string;
  avatar_url: string;
  content_type: string;
  created_at: string;
}

interface AvatarPickerModalProps {
  open: boolean;
  displayName: string;
  currentAvatarUrl?: string | null;
  onClose: () => void;
  onUpload: (file: File) => void | Promise<void>;
  onSelectRecent?: (item: AvatarUploadItem) => void;
  showRecent?: boolean;
  title?: string;
  description?: string;
  closeLabel?: string;
}

function extensionForContentType(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/avif") return "avif";
  return "gif";
}

async function gifToFile(item: GifPickerItem): Promise<File> {
  const downloadUrl = (() => {
    if (item.send.url.startsWith("attachments/")) {
      return getAuthAssetUrl(`/api/attachments/${item.send.url.slice(11)}`);
    }

    try {
      const parsed = new URL(item.send.url, window.location.origin);
      const apiOrigin = getApiBaseUrl()
        ? new URL(getApiBaseUrl()).origin
        : window.location.origin;
      const isTrustedInternalUrl =
        parsed.pathname.startsWith("/api/") &&
        (parsed.origin === window.location.origin ||
          parsed.origin === apiOrigin);
      return isTrustedInternalUrl
        ? getAuthAssetUrl(item.send.url)
        : buildProxyMediaUrl(item.send.url, item.sourceUrl);
    } catch {
      return getAuthAssetUrl(item.send.url);
    }
  })();
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error("Unable to download that GIF.");

  const blob = await response.blob();
  const contentType = blob.type.startsWith("image/")
    ? blob.type
    : item.send.contentType;
  if (!contentType.startsWith("image/")) {
    throw new Error("Choose an image or GIF for your avatar.");
  }

  return new File(
    [blob],
    `avatar-${item.id}.${extensionForContentType(contentType)}`,
    { type: contentType },
  );
}

export function AvatarPickerModal({
  open,
  displayName,
  currentAvatarUrl,
  onClose,
  onUpload,
  onSelectRecent,
  showRecent = true,
  title = "Select an Image",
  description = "Choose a new avatar or use one of your recent uploads.",
  closeLabel = "Close avatar picker",
}: AvatarPickerModalProps) {
  const [items, setItems] = useState<AvatarUploadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!showRecent) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void apiGet<{ items: AvatarUploadItem[] }>("/api/avatars/history")
      .then((response) => {
        if (!cancelled) setItems(response.items.slice(0, 6));
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load recent avatars.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showRecent]);

  const handleUpload = async (file: File) => {
    setError(null);
    await onUpload(file);
    onClose();
  };

  const handleGifSelect = async (item: GifPickerItem) => {
    setBusyId(item.id);
    setError(null);
    try {
      await handleUpload(await gifToFile(item));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to use that GIF.",
      );
    } finally {
      setBusyId(null);
      setShowGifPicker(false);
    }
  };

  const handleDelete = async (item: AvatarUploadItem) => {
    if (item.avatar_url === currentAvatarUrl) return;
    setBusyId(item.id);
    setError(null);
    try {
      await apiDelete<{ ok: true }, { id: string }>("/api/avatars/history", {
        id: item.id,
      });
      setItems((current) => current.filter(({ id }) => id !== item.id));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to delete that avatar.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <div className="fixed inset-0 z-50 bg-black/65" />
        <div className="fixed inset-0 z-60 flex items-center justify-center overflow-y-auto p-4">
          <DialogSurface
            showCloseButton={false}
            className="relative my-auto w-full max-w-[520px] overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary text-rm-text shadow-[0_28px_90px_rgba(0,0,0,0.55)] outline-none animate-in fade-in zoom-in-95 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
          >
            <header className="flex items-start justify-between gap-4 border-b border-rm-border px-6 py-5">
              <div>
                <h2
                  id="avatar-picker-title"
                  className="text-[24px] font-semibold tracking-tight"
                >
                  {title}
                </h2>
                <p className="mt-1 text-sm text-rm-text-muted">{description}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-rm-text-muted transition-[background-color,color,transform] pointer-fine:hover:bg-rm-bg-hover pointer-fine:hover:text-rm-text active:scale-[0.96]"
                aria-label={closeLabel}
              >
                <Icon name="close" size="lg" />
              </button>
            </header>

            <div className="space-y-5 px-6 pb-6 pt-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={Boolean(busyId)}
                  className="group flex min-h-[150px] flex-col items-center justify-center rounded-xl border border-rm-border bg-rm-bg-surface px-4 py-5 transition-[background-color,border-color,transform] pointer-fine:hover:border-primary/45 pointer-fine:hover:bg-rm-bg-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Icon
                    name="image"
                    size="2xl"
                    className="mb-4 text-rm-text-muted transition-colors group-hover:text-rm-text"
                  />
                  <span className="text-base font-bold">Upload Image</span>
                  <span className="mt-1 text-xs text-rm-text-muted">
                    Choose an image from your device
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowGifPicker(true)}
                  disabled={Boolean(busyId)}
                  className="group relative flex min-h-[150px] overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface px-4 py-5 text-left transition-[background-color,border-color,transform] pointer-fine:hover:border-primary/45 pointer-fine:hover:bg-rm-bg-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="absolute right-3 top-3 h-16 w-16 rounded-2xl bg-primary/10 transition-transform duration-200 group-hover:rotate-6" />
                  <div className="absolute bottom-5 right-9 h-10 w-10 rounded-xl bg-rm-bg-hover" />
                  <div className="relative z-10 mt-auto">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-rm-bg-hover text-rm-text">
                      <Icon name="sparkle" size="sm" />
                    </div>
                    <span className="block text-base font-bold">
                      Choose GIF
                    </span>
                    <span className="mt-1 block text-xs text-rm-text-muted">
                      Open the GIF picker
                    </span>
                  </div>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Upload avatar image"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (!file.type.startsWith("image/")) {
                    setError("Please choose an image file for your avatar.");
                    return;
                  }
                  void handleUpload(file);
                }}
              />

              {showRecent ? (
                <section>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold">Recent Avatars</h3>
                      <p className="mt-1 text-xs text-rm-text-muted">
                        Access your 6 most recent avatar uploads.
                      </p>
                    </div>
                    {loading ? (
                      <Icon
                        name="loader"
                        size="sm"
                        className="animate-spin text-rm-text-muted"
                      />
                    ) : null}
                  </div>

                  {items.length > 0 ? (
                    <div className="flex flex-wrap gap-3">
                      {items.map((item) => {
                        const isCurrent = item.avatar_url === currentAvatarUrl;
                        const isBusy = busyId === item.id;
                        return (
                          <div key={item.id} className="group/recent relative">
                            <button
                              type="button"
                              onClick={() => onSelectRecent?.(item)}
                              disabled={Boolean(busyId)}
                              className="relative h-[58px] w-[58px] cursor-pointer overflow-hidden rounded-full border border-rm-border bg-rm-bg-elevated outline-none transition-[transform,box-shadow] pointer-fine:hover:shadow-[0_0_0_4px_rgba(88,101,242,0.28),0_12px_24px_rgba(0,0,0,0.28)] focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                              aria-label={`Use ${displayName}'s recent avatar`}
                            >
                              <img
                                src={getAuthAssetUrl(item.avatar_url)}
                                alt=""
                                className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-white/10"
                                loading="lazy"
                              />
                              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover/recent:opacity-100">
                                {isBusy ? (
                                  <Icon
                                    name="loader"
                                    size="sm"
                                    className="animate-spin"
                                  />
                                ) : (
                                  <Icon name="upload" size="sm" />
                                )}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(item)}
                              disabled={isCurrent || Boolean(busyId)}
                              className={cn(
                                "absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-rm-border bg-rm-bg-floating text-rm-text-muted opacity-0 shadow-lg transition-[opacity,background-color,color,transform] pointer-fine:hover:bg-rm-badge pointer-fine:hover:text-white group-hover/recent:opacity-100 focus-visible:opacity-100 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35",
                              )}
                              aria-label={
                                isCurrent
                                  ? "Change active avatar before deleting it"
                                  : "Delete recent avatar"
                              }
                            >
                              <Icon name="trash" size="xs" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : !loading ? (
                    <p className="rounded-xl border border-dashed border-rm-border px-4 py-5 text-center text-sm text-rm-text-muted">
                      Your uploaded avatars will appear here.
                    </p>
                  ) : null}
                </section>
              ) : null}

              {error ? (
                <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogSurface>
        </div>
      </DialogPortal>

      <Suspense fallback={null}>
        <GifPickerModal
          open={showGifPicker}
          initialExpanded
          lockExpanded
          overlayZIndexClassName="z-70"
          onClose={() => setShowGifPicker(false)}
          onSelect={handleGifSelect}
        />
      </Suspense>
    </Dialog>
  );
}
