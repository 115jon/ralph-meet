import type { GifPickerItem } from "@/lib/gif-picker";
import GifPickerModal from "./GifPickerModal";
import EmojiPicker from "./EmojiPicker";
import { Gif, Smile, Sticker } from "./Icons";

export function InputControls({
  showEmoji,
  showGifPicker,
  setLocalState,
  handleEmojiSelect,
  handleGifSelect,
}: {
  showEmoji: boolean;
  showGifPicker: boolean;
  setLocalState: React.Dispatch<any>;
  handleEmojiSelect: (emoji: string) => void;
  handleGifSelect: (gif: GifPickerItem) => Promise<void>;
}) {
  return (
    <div className="ml-2 mt-[4px] flex items-center gap-2 text-rm-text-muted md:gap-4">
      <button
        type="button"
        aria-label="Open GIF picker"
        title="GIFs"
        className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:scale-105 hover:bg-rm-bg-hover hover:text-primary"
        onClick={() => setLocalState((prev: { showGifPicker: boolean; showEmoji: boolean }) => ({ showGifPicker: !prev.showGifPicker, showEmoji: false }))}
      >
        <Gif className="h-5 w-5" />
      </button>
      <Sticker className="hidden md:block h-5 w-5 cursor-pointer transition-all hover:scale-110 hover:text-primary" />
      <div className="relative">
        <Smile
          className="h-5 w-5 cursor-pointer transition-all hover:scale-110 hover:text-primary"
          onClick={() => setLocalState((prev: { showEmoji: boolean; showGifPicker: boolean }) => ({ showEmoji: !prev.showEmoji, showGifPicker: false }))}
        />
        {showEmoji && (
          <EmojiPicker
            onSelect={handleEmojiSelect}
            onClose={() => setLocalState({ showEmoji: false })}
          />
        )}
      </div>
      {showGifPicker && (
        <GifPickerModal
          onClose={() => setLocalState({ showGifPicker: false })}
          onSelect={handleGifSelect}
        />
      )}
    </div>
  );
}
