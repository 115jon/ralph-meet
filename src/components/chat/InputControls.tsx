import EmojiPicker from "./EmojiPicker";
import { Gift, Smile, Sticker } from "./Icons";

export function InputControls({
  showEmoji,
  setLocalState,
  handleEmojiSelect,
}: {
  showEmoji: boolean;
  setLocalState: React.Dispatch<any>;
  handleEmojiSelect: (emoji: string) => void;
}) {
  return (
    <div className="ml-2 mt-[4px] flex items-center gap-4 text-rm-text-muted">
      <Gift className="hidden md:block h-5 w-5 cursor-pointer transition-all hover:scale-110 hover:text-primary" />
      <Sticker className="hidden md:block h-5 w-5 cursor-pointer transition-all hover:scale-110 hover:text-primary" />
      <div className="relative">
        <Smile
          className="h-5 w-5 cursor-pointer transition-all hover:scale-110 hover:text-primary"
          onClick={() => setLocalState((prev: { showEmoji: boolean }) => ({ showEmoji: !prev.showEmoji }))}
        />
        {showEmoji && (
          <EmojiPicker
            onSelect={handleEmojiSelect}
            onClose={() => setLocalState({ showEmoji: false })}
          />
        )}
      </div>
    </div>
  );
}
