import { RowError } from "@/components/chat/settings/primitives";
import { Button, Spinner } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DISABLED, HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
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
  "flex min-h-28 flex-col items-center justify-center gap-1 rounded-md border border-line bg-tint-1 px-4 py-4 text-center outline-none pointer-fine:hover:bg-tint-2",
  PRESS,
  DISABLED,
);

/**
 * Avatar (or banner) picker: upload, GIF, or a recent upload. A form-width
 * dialog on desktop, a bottom drawer on phones. Stacks over settings
 * automatically.
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
        size="md"
        placement="top"
        initialFocus="surface"
        dialogClassName="overflow-y-auto"
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
            <Icon name="image" size="xl" className="mb-1 text-ink-2" />
            <span className="text-ui-row font-medium text-ink-1">
              Upload image
            </span>
            <span className="text-ui-xs text-ink-2">From your device</span>
          </button>

          <button
            type="button"
            onClick={() => setShowGifPicker(true)}
            disabled={Boolean(busyId)}
            className={TILE}
          >
            <Icon name="gif" size="xl" className="mb-1 text-ink-2" />
            <span className="text-ui-row font-medium text-ink-1">
              Choose GIF
            </span>
            <span className="text-ui-xs text-ink-2">Search for a GIF</span>
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
                  className="text-ui-sm font-semibold text-ink-1"
                >
                  Recent avatars
                </h3>
                <p className="mt-0.5 text-ui-xs text-ink-3">
                  Your last 6 uploads.
                </p>
              </div>
              {loading ? (
                <span className="text-ink-3">
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
                          "size-14 overflow-hidden rounded-avatar bg-tint-3 outline-none",
                          PRESS,
                          DISABLED,
                          isCurrent &&
                            "ring-2 ring-accent-ink ring-offset-2 ring-offset-ply-3",
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
                            "flex size-6 items-center justify-center rounded-[2px] border border-line-strong bg-ply-3 text-ink-2 outline-none pointer-fine:hover:text-danger-ink",
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
              <p className="text-ui-sm text-ink-2">
                Avatars you upload will show up here.
              </p>
            ) : null}
          </section>
        ) : null}

        {error ? <RowError className="mt-0">{error}</RowError> : null}

        <ResponsiveDialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>

      <Suspense fallback={null}>
        <GifPickerModal
          open={showGifPicker}
          initialExpanded
          lockExpanded
          stacked
          onClose={() => setShowGifPicker(false)}
          onSelect={handleGifSelect}
        />
      </Suspense>
    </ResponsiveDialog>
  );
}
