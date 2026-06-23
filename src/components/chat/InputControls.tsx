import type { GifPickerItem } from "@/lib/gif-picker";
import { cn } from "@/lib/utils";
import { GIF_FAVORITE_ADDED_EVENT } from "@/stores/useGifFavoritesStore";
import { useEffect, useRef, useState } from "react";
import GifPickerModal from "./GifPickerModal";
import EmojiPicker from "./EmojiPicker";
import { Gif, Smile, Sticker } from "./Icons";
import { Send } from "lucide-react";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";

export function InputControls({
  showEmoji,
  showGifPicker,
  setLocalState,
  handleEmojiSelect,
  handleGifSelect,
  canSend,
  onSend,
}: {
  showEmoji: boolean;
  showGifPicker: boolean;
  setLocalState: React.Dispatch<any>;
  handleEmojiSelect: (emoji: string) => void;
  handleGifSelect: (gif: GifPickerItem) => Promise<void>;
  canSend: boolean;
  onSend: () => void;
}) {
  const [showFavoriteNotice, setShowFavoriteNotice] = useState(false);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gifBtnRef = useRef<HTMLButtonElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);

  const renderEmojiPicker = useDelayUnmount(showEmoji, 150);
  const renderGifPicker = useDelayUnmount(showGifPicker, 150);

  useEffect(() => {
    const handleFavoriteAdded = () => {
      setShowFavoriteNotice(true);
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = setTimeout(() => setShowFavoriteNotice(false), 1800);
    };

    window.addEventListener(GIF_FAVORITE_ADDED_EVENT, handleFavoriteAdded);
    return () => {
      window.removeEventListener(GIF_FAVORITE_ADDED_EVENT, handleFavoriteAdded);
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    };
  }, []);

  return (
    <div className="ml-2 mt-[4px] flex items-center gap-2 text-rm-text-muted md:gap-4">
      <div className="relative">
        {showFavoriteNotice && (
          <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-yellow-300/20 bg-rm-bg-floating px-3 py-1.5 text-xs font-bold text-yellow-200 shadow-2xl animate-in fade-in slide-in-from-bottom-1">
            Added to Favorites
          </div>
        )}
        <button
          ref={gifBtnRef}
          type="button"
          aria-label="Open GIF picker"
          title={showFavoriteNotice ? "Added to Favorites" : "GIFs"}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:scale-105 hover:bg-rm-bg-hover hover:text-primary",
            showFavoriteNotice && "animate-pulse bg-yellow-400/15 text-yellow-300 ring-2 ring-yellow-300/60"
          )}
          onClick={() => setLocalState((prev: { showGifPicker: boolean; showEmoji: boolean }) => ({ showGifPicker: !prev.showGifPicker, showEmoji: false }))}
        >
          <Gif className="h-5 w-5" />
        </button>
      </div>
      <Sticker className="hidden md:block h-5 w-5 cursor-pointer transition-all hover:scale-110 hover:text-primary" />
      <div className="relative">
        <button
          ref={emojiBtnRef}
          type="button"
          aria-label="Open emoji picker"
          onClick={() => setLocalState((prev: { showEmoji: boolean; showGifPicker: boolean }) => ({ showEmoji: !prev.showEmoji, showGifPicker: false }))}
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-rm-bg-hover hover:text-primary"
        >
          <Smile className="h-5 w-5" />
        </button>
        {renderEmojiPicker && (
          <EmojiPicker
            onSelect={handleEmojiSelect}
            onClose={() => setLocalState({ showEmoji: false })}
            markerRef={emojiBtnRef}
            isClosing={!showEmoji}
          />
        )}
      </div>
      {renderGifPicker && (
        <GifPickerModal
          onClose={() => setLocalState({ showGifPicker: false })}
          onSelect={handleGifSelect}
          markerRef={gifBtnRef}
          isClosing={!showGifPicker}
        />
      )}
      <div
        className={cn(
          "flex items-center overflow-hidden transition-all duration-300 ease-out md:hidden",
          canSend ? "w-8 opacity-100" : "w-0 opacity-0 -ml-2 pointer-events-none"
        )}
      >
        <button
          type="button"
          aria-label="Send message"
          onClick={onSend}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all hover:scale-105 bg-primary/10 text-primary hover:bg-primary/20"
        >
          <Send className="h-4 w-4 ml-0.5" />
        </button>
      </div>
    </div>
  );
}
