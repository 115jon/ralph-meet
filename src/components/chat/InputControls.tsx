import type { GifPickerItem, GifPickerMediaType } from "@/lib/gif-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GIF_FAVORITE_ADDED_EVENT } from "@/stores/useGifFavoritesStore";
import { useEffect, useRef, useState } from "react";
import GifPickerModal from "./GifPickerModal";
import EmojiPicker from "./EmojiPicker";
import { Icon } from "@/components/ui/icon";

export function InputControls({
  showEmoji,
  showGifPicker,
  gifPickerMediaType,
  setLocalState,
  handleEmojiSelect,
  handleGifSelect,
  canSend,
  onSend,
}: {
  showEmoji: boolean;
  showGifPicker: boolean;
  gifPickerMediaType: GifPickerMediaType;
  setLocalState: React.Dispatch<any>;
  handleEmojiSelect: (emoji: string) => void;
  handleGifSelect: (gif: GifPickerItem) => Promise<void>;
  canSend: boolean;
  onSend: () => void;
}) {
  const [showFavoriteNotice, setShowFavoriteNotice] = useState(false);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gifBtnRef = useRef<HTMLButtonElement>(null);
  const stickerBtnRef = useRef<HTMLButtonElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleFavoriteAdded = () => {
      setShowFavoriteNotice(true);
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = setTimeout(
        () => setShowFavoriteNotice(false),
        1800,
      );
    };

    window.addEventListener(GIF_FAVORITE_ADDED_EVENT, handleFavoriteAdded);
    return () => {
      window.removeEventListener(GIF_FAVORITE_ADDED_EVENT, handleFavoriteAdded);
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    };
  }, []);

  const openGifPicker = (nextMediaType: GifPickerMediaType) => {
    setLocalState(
      (prev: {
        gifPickerMediaType: GifPickerMediaType;
        showGifPicker: boolean;
        showEmoji: boolean;
      }) => ({
        gifPickerMediaType: nextMediaType,
        showGifPicker: !(
          prev.showGifPicker && prev.gifPickerMediaType === nextMediaType
        ),
        showEmoji: false,
      }),
    );
  };

  const activeMediaButton = showGifPicker ? gifPickerMediaType : null;
  const mediaButtonClassName = (isActive: boolean, hiddenClassName = "") =>
    cn(
      hiddenClassName,
      isActive
        ? "bg-rm-tint-2 text-rm-text"
        : "text-rm-text-muted pointer-fine:hover:text-rm-text",
    );

  const gifPickerMarkerRef =
    gifPickerMediaType === "stickers" ? stickerBtnRef : gifBtnRef;

  return (
    <div className="ml-2 flex items-center gap-2 text-rm-text-muted">
      <div className="relative">
        {showFavoriteNotice && (
          <div
            role="status"
            className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-rm-border bg-rm-bg-surface px-3 py-1.5 text-ui-xs font-medium text-rm-warning-ink shadow-lg animate-in fade-in-0 zoom-in-[0.97] dark:bg-rm-bg-elevated"
          >
            Added to favorites
          </div>
        )}
        <Button
          ref={gifBtnRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open GIF picker"
          aria-expanded={activeMediaButton === "gifs"}
          title={showFavoriteNotice ? "Added to favorites" : "GIFs"}
          className={cn(
            mediaButtonClassName(activeMediaButton === "gifs"),
            showFavoriteNotice && "bg-rm-tint-2 text-rm-warning-ink",
          )}
          onClick={() => openGifPicker("gifs")}
        >
          <Icon name="gif" size="lg" />
        </Button>
      </div>
      <Button
        ref={stickerBtnRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open sticker picker"
        aria-expanded={activeMediaButton === "stickers"}
        title="Stickers"
        onClick={() => openGifPicker("stickers")}
        className={mediaButtonClassName(
          activeMediaButton === "stickers",
          "hidden md:flex",
        )}
      >
        <Icon name="sticker" size="lg" />
      </Button>
      <div className="relative">
        <Button
          ref={emojiBtnRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open emoji picker"
          aria-expanded={showEmoji}
          onClick={() =>
            setLocalState(
              (prev: { showEmoji: boolean; showGifPicker: boolean }) => ({
                showEmoji: !prev.showEmoji,
                showGifPicker: false,
              }),
            )
          }
          className={mediaButtonClassName(showEmoji)}
        >
          <Icon name="emoji" size="lg" />
        </Button>
        <EmojiPicker
          open={showEmoji}
          onSelect={handleEmojiSelect}
          onClose={() => setLocalState({ showEmoji: false })}
          markerRef={emojiBtnRef}
          isClosing={!showEmoji}
        />
      </div>
      {showGifPicker ? (
        <GifPickerModal
          open
          onClose={() => setLocalState({ showGifPicker: false })}
          onSelect={handleGifSelect}
          defaultMediaType={gifPickerMediaType}
          markerRef={gifPickerMarkerRef}
        />
      ) : null}
      {/* Phone send: its 32px slot is always reserved, so revealing it
          animates opacity and scale only, never the row's width. */}
      <Button
        type="button"
        size="icon"
        aria-label="Send message"
        aria-hidden={!canSend || undefined}
        tabIndex={canSend ? undefined : -1}
        onClick={onSend}
        className={cn(
          "transition-[opacity,scale] duration-150 ease-(--rm-ease-out) md:hidden motion-reduce:transition-opacity",
          canSend
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-90 opacity-0",
        )}
      >
        <Icon name="send" size="lg" />
      </Button>
    </div>
  );
}
