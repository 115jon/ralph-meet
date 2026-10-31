import { getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { getWebOrigin } from "@/lib/platform";
import { Icon } from "@/components/ui/icon";
import { HIT, PRESS, PRESS_ICON } from "@/components/ui/interaction";
import { Num } from "@/components/ui/num";
import { cn } from "@/lib/utils";

/**
 * Icon control in the viewer's one toolbar group: 32px ghost keys on the
 * ply-3 bar on desktop; full 44px keys in the phone header bar.
 */
export const VIEWER_BUTTON = cn(
  "flex size-8 shrink-0 max-md:size-11 items-center justify-center rounded-md text-ink-2 pointer-fine:hover:text-ink-1 data-popup-open:bg-tint-2 data-popup-open:text-ink-1 aria-expanded:bg-tint-2 aria-expanded:text-ink-1",
  PRESS,
  PRESS_ICON,
  HIT,
);

/**
 * The bar the viewer's controls sit in: one floating group (ply-3, line,
 * shadow) on desktop. On phones the whole header is one flat ply-0 bar, so
 * the group drops its plate.
 */
export const VIEWER_BAR =
  "flex items-center gap-0.5 rounded-lg border border-line bg-ply-3 p-1 shadow-float max-md:gap-0 max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none";
import {
  ActionSheet,
  type ActionSheetItem,
} from "@/components/ui/action-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { Fragment, useState } from "react";
import InlineEmojiText from "./InlineEmojiText";
import { PreviewAvatar } from "./MessagePreviewCard";
import { useMessageTimeFormat } from "./message-time";

/** `182 KB`, `1.4 MB`: one decimal from MB up. */
export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  return `${i >= 2 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
};

interface ImageViewerToolbarProps {
  context: any;
  currentImage: any;
  dimensions: { width: number; height: number } | null;
  viewDispatch: (action: any) => void;
  close: () => void;
  getUrl: (img: any) => string;
  isVideo?: boolean;
  isAnimatedMedia?: boolean;
}

type MoreItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  divider?: boolean;
};

const DETAIL_LABEL = "mb-1 text-ui-xs text-ink-3";

export function ImageViewerToolbar({
  context,
  currentImage,
  dimensions,
  viewDispatch,
  close,
  getUrl,
  isVideo,
  isAnimatedMedia,
}: ImageViewerToolbarProps) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleCopyLink = () => {
    if (currentImage) {
      const url = currentImage.downloadUrl || getUrl(currentImage);
      const shareableUrl = /^https?:\/\//i.test(url)
        ? url
        : `${getWebOrigin()}${url}`;
      navigator.clipboard.writeText(shareableUrl);
    }
  };

  const handleCopyId = () => {
    if (currentImage) {
      navigator.clipboard.writeText(currentImage.id);
    }
  };

  const handleCopyImage = async () => {
    if (!currentImage) return;
    try {
      const response = await fetch(
        currentImage.downloadUrl || getUrl(currentImage),
      );
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    } catch (err) {
      console.error("Failed to copy image", err);
    }
  };

  const handleForward = () => {
    const messageId = currentImage?.message_id;
    if (!messageId || typeof context?.onJumpToMessage !== "function") return;

    close();
    setTimeout(() => {
      context.onJumpToMessage?.(messageId);
    }, 0);
  };

  const moreItems: MoreItem[] = [
    ...(!isVideo
      ? [
          {
            key: "copy-image",
            label: "Copy image",
            icon: <Icon name="copy" size="sm" />,
            onSelect: handleCopyImage,
          },
        ]
      : []),
    {
      key: "copy-link",
      label: "Copy link",
      icon: <Icon name="link" size="sm" />,
      onSelect: handleCopyLink,
    },
    {
      key: "details",
      label: "View details",
      icon: <Icon name="info" size="sm" />,
      divider: true,
    },
    {
      key: "copy-id",
      label: "Copy attachment ID",
      icon: <Icon name="copyId" size="sm" />,
      onSelect: handleCopyId,
    },
  ];

  const detailsPanel = (
    <section
      aria-label="Image details panel"
      className="flex flex-col gap-3 text-left"
    >
      <h3 className="text-ui-sm font-semibold text-ink-1">
        {isAnimatedMedia
          ? "GIF details"
          : isVideo
            ? "Video details"
            : "Image details"}
      </h3>
      <div>
        <div className={DETAIL_LABEL}>Filename</div>
        <div className="rounded-sm bg-tint-1 px-2 py-1.5 text-ui-xs break-all text-ink-1">
          {currentImage.filename}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={DETAIL_LABEL}>Dimensions</div>
          <Num size="sm" className="text-ink-1">
            {dimensions ? `${dimensions.width}×${dimensions.height}` : "—"}
          </Num>
        </div>
        <div>
          <div className={DETAIL_LABEL}>Size</div>
          <Num size="sm" className="text-ink-1">
            {formatBytes(currentImage.size_bytes)}
          </Num>
        </div>
      </div>
      <div>
        <div className={DETAIL_LABEL}>Type</div>
        <div className="text-ui-xs break-all text-ink-2">
          {currentImage.content_type}
        </div>
      </div>
    </section>
  );

  const hasAuthor = Boolean(
    context?.display_name?.trim() || context?.username?.trim(),
  );
  const displayName = hasAuthor ? getDisplayName(context) : "";
  const createdAt: string | undefined = context?.created_at;
  const sizeLabel =
    typeof currentImage.size_bytes === "number" && currentImage.size_bytes > 0
      ? formatBytes(currentImage.size_bytes)
      : null;
  const metaLabel = [
    sizeLabel,
    dimensions ? `${dimensions.width}×${dimensions.height}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const moreTrigger = isMobile ? (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={VIEWER_BUTTON}
        aria-expanded={sheetOpen}
        aria-haspopup="menu"
        aria-label="More attachment actions"
      >
        <Icon name="more" size="md" />
      </button>
      <ActionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Attachment actions"
        items={moreItems.map((item): ActionSheetItem => ({
          key: item.key,
          label: item.label,
          rightIcon: item.icon,
          onClick: item.onSelect ?? (() => {}),
          variant: item.danger ? "danger" : "default",
          divider: item.divider,
          submenu: item.key === "details" ? detailsPanel : undefined,
          closeOnClick: item.key === "details" ? false : undefined,
        }))}
      />
    </>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={VIEWER_BUTTON}
            aria-label="More attachment actions"
          />
        }
      >
        <Icon name="more" size="md" />
      </DropdownMenuTrigger>
      {/* The viewer is a z-50 dialog: the menu goes on the stacked layer. */}
      <DropdownMenuContent align="end" sideOffset={8} stacked>
        {moreItems.map((item) =>
          item.key === "details" ? (
            <DropdownMenuSub key={item.key}>
              <DropdownMenuSubTrigger icon={item.icon}>
                {item.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                stacked
                side="inline-start"
                className="w-64 p-3"
              >
                {detailsPanel}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <Fragment key={item.key}>
              <DropdownMenuItem
                icon={item.icon}
                variant={item.danger ? "danger" : "default"}
                onClick={item.onSelect}
              >
                {item.label}
              </DropdownMenuItem>
              {item.divider ? <DropdownMenuSeparator /> : null}
            </Fragment>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div
      data-slot="image-viewer-toolbar"
      className={cn(
        "absolute inset-x-0 top-0 z-50 flex justify-between",
        // Phone: one opaque 52px bar under the status bar, author left
        // (truncating), keys right. Nothing from the page shows through.
        "items-center gap-1 border-b border-line bg-ply-0 py-1 pr-1 pl-3 pt-[calc(4px+var(--safe-area-top,0px))]",
        // Desktop: two floating groups over the scrim.
        "md:pointer-events-none md:items-start md:gap-3 md:border-0 md:bg-transparent md:p-4 md:pt-[calc(16px+var(--safe-area-top,0px))]",
      )}
    >
      {/* Left: who posted it and when. Hidden when the viewer has no author. */}
      {hasAuthor ? (
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2.5 md:h-10 md:flex-initial md:rounded-lg md:border md:border-line md:bg-ply-3 md:py-1 md:pr-3 md:pl-2 md:shadow-float">
          <PreviewAvatar
            name={displayName}
            src={
              context?.avatar_url ? getAuthAssetUrl(context.avatar_url) : null
            }
            display={context?.avatar_display}
            size={isMobile ? 32 : 24}
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-ui-sm leading-tight font-semibold text-ink-1">
              <InlineEmojiText text={displayName} />
            </span>
            {createdAt ? <ViewerTime value={createdAt} /> : null}
          </div>
        </div>
      ) : (
        <span aria-hidden="true" className="flex-1 md:flex-initial" />
      )}

      {/* Right: one toolbar group. File, view, actions, then close. */}
      <div
        role="toolbar"
        aria-label="Media actions"
        className={cn(VIEWER_BAR, "pointer-events-auto min-w-0 shrink-0")}
      >
        <div className="hidden min-w-0 flex-col justify-center px-2 md:flex md:max-w-60">
          <span
            className="truncate text-ui-sm font-medium text-ink-1"
            title={currentImage.filename}
          >
            {currentImage.filename}
          </span>
          {metaLabel ? (
            <Num className="truncate text-ink-3">{metaLabel}</Num>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="mx-1 hidden h-5 w-px bg-line md:block"
        />

        {/* Phones zoom with a tap on the image; the keys would crowd out
            the author. */}
        {!isVideo && !isMobile && (
          <>
            <button
              type="button"
              onClick={() => viewDispatch({ type: "ZOOM_OUT" })}
              className={VIEWER_BUTTON}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Icon name="zoomOut" size="md" />
            </button>
            <button
              type="button"
              onClick={() => viewDispatch({ type: "ZOOM_IN" })}
              className={VIEWER_BUTTON}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <Icon name="zoomIn" size="md" />
            </button>
          </>
        )}

        {currentImage?.message_id &&
          typeof context?.onJumpToMessage === "function" && (
            <button
              type="button"
              onClick={handleForward}
              className={VIEWER_BUTTON}
              aria-label="Jump to message"
              title="Jump to message"
            >
              <Icon name="chat" size="md" />
            </button>
          )}

        <a
          href={currentImage.downloadUrl || getUrl(currentImage)}
          download={currentImage.filename}
          target="_blank"
          rel="noopener noreferrer"
          className={VIEWER_BUTTON}
          aria-label="Download attachment"
          title="Download"
        >
          <Icon name="download" size="md" />
        </a>

        {moreTrigger}

        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />

        <button
          type="button"
          onClick={close}
          className={VIEWER_BUTTON}
          aria-label="Close media viewer"
          title="Close (Esc)"
        >
          <Icon name="close" size="md" />
        </button>
      </div>
    </div>
  );
}

/** Time-only in `Num` today; the short day before it otherwise. */
function ViewerTime({ value }: { value: string }) {
  const { time, shortDate, full } = useMessageTimeFormat();
  const t = time(value);
  const day = shortDate(value);
  return (
    <time
      dateTime={value}
      title={full(value)}
      className="truncate text-ui-xs leading-tight whitespace-nowrap text-ink-3"
    >
      {day === t ? (
        <Num>{t}</Num>
      ) : (
        <>
          {day} <Num>{t}</Num>
        </>
      )}
    </time>
  );
}
