import { RowError } from "@/components/chat/settings/primitives";
import { Spinner } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DISABLED, HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { apiDelete, apiGet } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import type { GifPickerItem } from "@/lib/gif-picker";
import { getApiBaseUrl, getAuthAssetUrl } from "@/lib/platform";
import { buildProxyMediaUrl } from "@/lib/proxy-media-url";
import { cn } from "@/lib/utils";
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
  /** @deprecated The dialog's own close button names itself; kept for callers. */
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

/** A large choice tile (upload / GIF). */
const TILE = cn(
  "flex min-h-36 flex-col items-center justify-center gap-1 rounded-lg border border-rm-border bg-rm-tint-1 px-4 py-6 text-center outline-none",
  PRESS,
  DISABLED,
);

/**
 * Avatar (or banner) picker: upload, GIF, or a recent upload. A form-width
 * dialog on desktop, a bottom drawer on phones; opened from settings, so the
 * dialog sits on the stacked layer.
 */
export function AvatarPickerModal({
  open,
  displayName,
  currentAvatarUrl,
  onClose,
  onUpload,
  onSelectRecent,
  showRecent = true,
  title = "Choose an image",
  description = "Upload a new avatar or reuse one of your recent uploads.",
}: AvatarPickerModalProps) {
  const [items, setItems] = useState<AvatarUploadItem[]>([]);
  const [loading, setLoading] = useState(showRecent);
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
          setError(describeApiError(cause, "load your recent avatars"));
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
    try {
      await onUpload(file);
      onClose();
    } catch (cause) {
      setError(describeApiError(cause, "upload that image"));
    }
  };

  const handleGifSelect = async (item: GifPickerItem) => {
    setBusyId(item.id);
    setError(null);
    try {
      await handleUpload(await gifToFile(item));
    } catch {
      setError("Unable to use that GIF. Choose another one and try again.");
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
      setError(describeApiError(cause, "delete that avatar"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <ResponsiveDialogContent
        // Opened from settings: the stacked layer (11.1).
        dialogClassName="z-60 max-h-[calc(100dvh-32px)] overflow-y-auto overscroll-contain md:max-w-md"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {description}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(busyId)}
            className={TILE}
          >
            <Icon
              name="image"
              size="xl"
              className="mb-2 text-rm-text-secondary"
            />
            <span className="text-ui-base font-medium text-rm-text">
              Upload image
            </span>
            <span className="text-ui-xs text-rm-text-secondary">
              From your device
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowGifPicker(true)}
            disabled={Boolean(busyId)}
            className={TILE}
          >
            <Icon
              name="gif"
              size="xl"
              className="mb-2 text-rm-text-secondary"
            />
            <span className="text-ui-base font-medium text-rm-text">
              Choose GIF
            </span>
            <span className="text-ui-xs text-rm-text-secondary">
              Search for a GIF
            </span>
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
              setError("Choose an image file, such as a PNG, JPG or GIF.");
              return;
            }
            void handleUpload(file);
          }}
        />

        {showRecent ? (
          <section
            aria-labelledby="avatar-picker-recent"
            className="flex flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3
                  id="avatar-picker-recent"
                  className="text-ui-md font-semibold text-rm-text"
                >
                  Recent avatars
                </h3>
                <p className="mt-1 text-ui-sm text-rm-text-secondary">
                  Your last 6 uploads.
                </p>
              </div>
              {loading ? (
                <span className="text-rm-text-muted">
                  <Spinner />
                  <span className="sr-only">Loading</span>
                </span>
              ) : null}
            </div>

            {items.length > 0 ? (
              <ul className="flex flex-wrap gap-3">
                {items.map((item) => {
                  const isCurrent = item.avatar_url === currentAvatarUrl;
                  const isBusy = busyId === item.id;
                  return (
                    <li key={item.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onSelectRecent?.(item)}
                        disabled={Boolean(busyId)}
                        aria-current={isCurrent || undefined}
                        aria-label={
                          isCurrent
                            ? `${displayName}'s current avatar`
                            : "Use this recent avatar"
                        }
                        className={cn(
                          "size-14 overflow-hidden rounded-full bg-rm-tint-2 outline-none",
                          PRESS,
                          DISABLED,
                          isCurrent &&
                            "ring-2 ring-rm-accent-ink ring-offset-2 ring-offset-rm-bg-surface dark:ring-offset-rm-bg-elevated",
                        )}
                      >
                        <img
                          src={getAuthAssetUrl(item.avatar_url)}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                        {isBusy ? (
                          // Media overlay over a photo (6.5).
                          <span className="absolute inset-0 grid place-items-center bg-black/60 text-white">
                            <Spinner />
                          </span>
                        ) : null}
                      </button>
                      {!isCurrent ? (
                        <button
                          type="button"
                          onClick={() => void handleDelete(item)}
                          disabled={Boolean(busyId)}
                          aria-label="Delete this recent avatar"
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full border border-rm-border bg-rm-bg-surface text-rm-text-secondary outline-none pointer-fine:hover:text-rm-danger-ink dark:bg-rm-bg-elevated",
                            PRESS,
                            HIT,
                            DISABLED,
                            REVEAL,
                            // After PRESS (`relative`): pin to the corner.
                            "absolute -top-1 -right-1",
                          )}
                        >
                          <Icon name="trash" size="xs" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : !loading && !error ? (
              <p className="text-ui-sm text-rm-text-secondary">
                Avatars you upload will show up here.
              </p>
            ) : null}
          </section>
        ) : null}

        {error ? <RowError className="mt-0">{error}</RowError> : null}
      </ResponsiveDialogContent>

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
    </ResponsiveDialog>
  );
}
