import { getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { getWebOrigin } from "@/lib/platform";
import { formatRelative } from "date-fns";
import { enUS } from "date-fns/locale";
import { Icon } from "@/components/ui/icon";
import { HIT, PRESS } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";

/** Icon control in the viewer's floating pills: 36px, 44 on touch. */
export const VIEWER_BUTTON = cn(
  "flex size-9 items-center justify-center rounded-lg text-rm-text-muted pointer-fine:hover:text-rm-text",
  PRESS,
  HIT,
);
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
import { AvatarImage } from "./AvatarImage";
import { UserDisplayName } from "./UserDisplayName";

const formatRelativeLocale: Record<string, string> = {
  lastWeek: "eeee 'at' p",
  yesterday: "'Yesterday at' p",
  today: "'Today at' p",
  tomorrow: "'Tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: "P",
};

const locale = {
  ...enUS,
  formatRelative: (token: string) =>
    formatRelativeLocale[token] || formatRelativeLocale.other,
};

export function formatFriendlyDate(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return formatRelative(date, new Date(), { locale });
}

export const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
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

const MORE_BUTTON =
  "p-2 text-rm-text-muted pointer-fine:hover:text-rm-text pointer-fine:hover:bg-rm-bg-hover rounded-lg transition-ui outline-none data-popup-open:bg-rm-bg-hover data-popup-open:text-rm-text";

const DETAIL_LABEL = "mb-1 text-ui-xs font-medium text-rm-text-muted";

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
      danger: true,
    },
  ];

  const detailsPanel = (
    <section
      aria-label="Image details panel"
      className="flex flex-col gap-3 text-left"
    >
      <h3 className="text-ui-sm font-semibold text-rm-text">
        {isAnimatedMedia
          ? "GIF details"
          : isVideo
            ? "Video details"
            : "Image details"}
      </h3>
      <div>
        <div className={DETAIL_LABEL}>Filename</div>
        <div className="break-all rounded-sm border border-rm-border bg-rm-bg-surface/40 p-2 font-mono text-ui-xs text-rm-text">
          {currentImage.filename}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={DETAIL_LABEL}>Dimensions</div>
          <div className="text-ui-sm font-medium text-rm-text">
            {dimensions ? `${dimensions.width}×${dimensions.height}` : "—"}
          </div>
        </div>
        <div>
          <div className={DETAIL_LABEL}>Size</div>
          <div className="text-ui-sm font-medium text-rm-text">
            {formatBytes(currentImage.size_bytes)}
          </div>
        </div>
      </div>
      <div>
        <div className={DETAIL_LABEL}>Type</div>
        <div className="font-mono text-ui-xs text-rm-text-muted">
          {currentImage.content_type}
        </div>
      </div>
    </section>
  );

  const formattedDate = context?.created_at
    ? formatFriendlyDate(context.created_at)
    : "";
  const displayName = getDisplayName(context, "Unknown user");

  return (
    <div className="absolute top-0 left-0 right-0 z-50 flex items-start justify-between gap-2 bg-linear-to-b from-rm-bg-primary/80 to-transparent p-2 pt-[calc(8px+var(--safe-area-top,0px))] pointer-events-none md:items-center md:p-4 md:pt-[calc(16px+var(--safe-area-top,0px))]">
      {/* Left: User Info */}
      <div className="flex min-w-0 items-center gap-3 pointer-events-auto">
        {context?.avatar_url && (
          <div className="h-7 w-7 overflow-visible rounded-full md:h-8 md:w-8">
            <AvatarImage
              src={getAuthAssetUrl(context.avatar_url)}
              alt={displayName}
              display={context.avatar_display}
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        <div className="flex min-w-0 flex-col">
          <UserDisplayName
            user={context}
            fallback="Unknown user"
            className="block truncate text-ui-sm font-semibold leading-none text-rm-text drop-shadow-md"
          />
          {formattedDate && (
            <span className="truncate text-ui-2xs font-medium text-rm-text-muted drop-shadow-md">
              {formattedDate}
            </span>
          )}
        </div>
      </div>

      {/* Right: Tool groups */}
      <div className="flex shrink-0 items-center gap-2 pointer-events-auto">
        {/* Action buttons pill group */}
        <div className="flex items-center gap-0.5 bg-rm-bg-elevated/80 border border-rm-border rounded-xl px-1 py-1 shadow-lg">
          {!isVideo && (
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

          {/* More menu: Base UI menu on desktop, action sheet on phones */}
          {isMobile ? (
            <>
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className={MORE_BUTTON}
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
                items={moreItems.map(
                  (item): ActionSheetItem => ({
                    key: item.key,
                    label: item.label,
                    rightIcon: item.icon,
                    onClick: item.onSelect ?? (() => {}),
                    variant: item.danger ? "danger" : "default",
                    divider: item.divider,
                    submenu: item.key === "details" ? detailsPanel : undefined,
                    closeOnClick: item.key === "details" ? false : undefined,
                  }),
                )}
              />
            </>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className={MORE_BUTTON}
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
          )}
        </div>

        {/* Close button – own pill group */}
        <div className="bg-rm-bg-elevated/80 border border-rm-border rounded-xl p-1 shadow-lg">
          <button
            type="button"
            onClick={close}
            className={VIEWER_BUTTON}
            aria-label="Close media viewer"
          >
            <Icon name="close" size="md" />
          </button>
        </div>
      </div>
    </div>
  );
}
