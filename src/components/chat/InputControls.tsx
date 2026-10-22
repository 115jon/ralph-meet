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
    <div className="ml-2 mt-0.5 flex items-center gap-0.5 text-rm-text-muted md:gap-1">
      <div className="relative">
        {showFavoriteNotice && (
          <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-yellow-500/30 dark:border-yellow-300/20 bg-rm-bg-floating px-3 py-1.5 text-xs font-bold text-yellow-800 dark:text-yellow-200 shadow-2xl animate-in fade-in slide-in-from-bottom-1">
            Added to Favorites
          </div>
        )}
        <Button
          ref={gifBtnRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open GIF picker"
          aria-expanded={activeMediaButton === "gifs"}
          title={showFavoriteNotice ? "Added to Favorites" : "GIFs"}
          className={cn(
            mediaButtonClassName(activeMediaButton === "gifs"),
            showFavoriteNotice &&
              "animate-pulse bg-rm-tint-2 text-rm-warning-ink ring-2 ring-yellow-500/60 dark:ring-yellow-300/60",
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
      <div
        className={cn(
          "flex items-center overflow-hidden transition-ui ease-out md:hidden",
          canSend
            ? "w-8 opacity-100"
            : "w-0 opacity-0 -ml-2 pointer-events-none",
        )}
      >
        <Button
          type="button"
          size="icon"
          aria-label="Send message"
          onClick={onSend}
        >
          <Icon name="send" size="sm" className="ml-0.5" />
        </Button>
      </div>
    </div>
  );
}
