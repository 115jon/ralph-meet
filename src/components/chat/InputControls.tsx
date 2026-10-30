import type { GifPickerItem, GifPickerMediaType } from "@/lib/gif-picker";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";
import { GIF_FAVORITE_ADDED_EVENT } from "@/stores/useGifFavoritesStore";
import { useEffect, useRef, useState } from "react";
import GifPickerModal from "./GifPickerModal";
import EmojiPicker from "./EmojiPicker";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PRESS } from "@/components/ui/interaction";

/** A 48px slot key inside the composer plate; the ring draws inside it. */
const SLOT = "rounded-none focus-visible:outline-offset-[-2px]";

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

  const gifPickerMarkerRef =
    gifPickerMediaType === "stickers" ? stickerBtnRef : gifBtnRef;

  // Flush 48px slot keys. An open picker shows the toggled tint (and the
  // Fill glyph where the concept ships one). GIF is a silkscreen word.
  const toggleTone = (active: boolean) => (active ? "toggled" : "idle");

  return (
    <div className="flex items-center text-ink-2">
      <div className="relative">
        {showFavoriteNotice && (
          <div
            role="status"
            className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 rounded-sm bg-ink-1 px-2 py-1 text-ui-xs font-medium whitespace-nowrap text-ply-0 animate-in fade-in-0 zoom-in-[0.97] duration-(--dur-2)"
          >
            Added to favorites
          </div>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={gifBtnRef}
              type="button"
              aria-label="Open GIF picker"
              aria-expanded={activeMediaButton === "gifs"}
              data-tone={
                activeMediaButton === "gifs" || showFavoriteNotice
                  ? "toggled"
                  : "idle"
              }
              className={cn(
                "silkscreen relative inline-flex h-12 min-w-11 shrink-0 items-center justify-center px-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus max-md:w-12",
                PRESS,
                // Phones: once there is something to send, the send key
                // takes this slot's width at the end of the row.
                canSend && "max-md:hidden",
                activeMediaButton === "gifs" || showFavoriteNotice
                  ? "bg-tint-2 text-ink-1"
                  : "text-ink-2 pointer-fine:hover:text-ink-1",
                showFavoriteNotice && "text-warning-ink",
              )}
              onClick={() => openGifPicker("gifs")}
            >
              GIF
            </button>
          </TooltipTrigger>
          {!showFavoriteNotice && (
            <TooltipContent side="top" sideOffset={8}>
              GIFs
            </TooltipContent>
          )}
        </Tooltip>
      </div>
      <IconButton
        ref={stickerBtnRef}
        icon="sticker"
        size="lg"
        tone={toggleTone(activeMediaButton === "stickers")}
        aria-label="Open sticker picker"
        aria-expanded={activeMediaButton === "stickers"}
        tooltip="Stickers"
        onClick={() => openGifPicker("stickers")}
        className={cn(SLOT, "max-md:hidden")}
      />
      <div className="relative">
        <IconButton
          ref={emojiBtnRef}
          icon="emoji"
          iconState={showEmoji ? "active" : "idle"}
          size="lg"
          className={SLOT}
          tone={toggleTone(showEmoji)}
          aria-label="Open emoji picker"
          aria-expanded={showEmoji}
          tooltip="Emoji"
          onClick={() =>
            setLocalState(
              (prev: { showEmoji: boolean; showGifPicker: boolean }) => ({
                showEmoji: !prev.showEmoji,
                showGifPicker: false,
              }),
            )
          }
        />
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
      {/* Phone send: absent until there is something to send (no dead slot
          at the row's end), then a 40px primary key in the 48px slot the
          GIF key gives up, so the text column keeps its width. */}
      {canSend ? (
        <Button
          type="button"
          size="icon"
          aria-label="Send message"
          // Keep focus (and the phone keyboard) on the textarea: a pointer
          // press would otherwise move focus onto this button, which then
          // unmounts the moment the send clears the field.
          onPointerDown={(e) => e.preventDefault()}
          onClick={onSend}
          className="m-1 animate-in fade-in-0 zoom-in-90 duration-(--dur-2) ease-out md:hidden"
        >
          <Icon name="send" size="lg" />
        </Button>
      ) : null}
    </div>
  );
}
