
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const EMOJI_CATEGORIES = [
  {
    name: "Smileys",
    icon: "😀",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂",
      "🙂", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘",
      "😗", "😚", "😋", "😛", "😜", "🤪", "😝", "🤑",
      "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑",
      "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔",
      "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮",
      "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳",
      "🥸", "😎", "🤓", "🧐", "😕", "😟", "🙁", "😮",
      "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰",
      "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😩",
      "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "☠️",
    ],
  },
  {
    name: "People",
    icon: "👋",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏",
      "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆",
      "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛",
      "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🙏", "💪",
    ],
  },
  {
    name: "Nature",
    icon: "🐶",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼",
      "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔",
      "🐧", "🐦", "🦅", "🦆", "🦉", "🐺", "🐗", "🐴",
      "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🌸", "🌺",
    ],
  },
  {
    name: "Food",
    icon: "🍕",
    emojis: [
      "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓",
      "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝",
      "🍅", "🍔", "🍟", "🍕", "🌭", "🥪", "🌮", "🌯",
      "🥙", "🧆", "🍣", "🍱", "🍦", "🍩", "🍪", "🎂",
    ],
  },
  {
    name: "Objects",
    icon: "💡",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
      "💯", "💢", "💥", "💫", "💦", "💨", "🕳️", "💣",
      "💬", "💭", "💤", "💮", "♨️", "💈", "🛑", "🕐",
      "🌀", "♠️", "♥️", "♦️", "♣️", "🃏", "🀄", "🎴",
      "🔇", "🔈", "🔉", "🔊", "📢", "📣", "📯", "🔔",
      "🎵", "🎶", "🎙️", "🎚️", "🎛️", "🎤", "🎧", "📻",
      "🔑", "🗝️", "🔨", "🪓", "⛏️", "🔧", "🔩", "⚙️",
      "💡", "🔦", "🕯️", "📝", "✏️", "🖊️", "🖋️", "📌",
    ],
  },
  {
    name: "Symbols",
    icon: "🚀",
    emojis: [
      "🚀", "⭐", "🌟", "✨", "⚡", "🔥", "💧", "🌈",
      "☀️", "🌙", "💎", "🏆", "🥇", "🥈", "🥉", "🎯",
      "🎮", "🎲", "🧩", "♟️", "🎭", "🎨", "🎬", "🎤",
      "✅", "❌", "⭕", "❗", "❓", "‼️", "⁉️", "💲",
    ],
  },
];

export default function EmojiPicker({ onSelect, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSelect = useCallback(
    (emoji: string) => {
      onSelect(emoji);
      onClose();
    },
    [onSelect, onClose]
  );

  const displayEmojis = search.trim()
    ? EMOJI_CATEGORIES.flatMap((cat) => cat.emojis)
    : EMOJI_CATEGORIES[activeCategory].emojis;

  return (
    <div
      ref={pickerRef}
      className="absolute bottom-full right-0 z-50 mb-2 flex w-[340px] origin-bottom-right animate-in fade-in zoom-in flex-col overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary shadow-2xl duration-200"
    >
      {/* Search */}
      <div className="border-b border-rm-border p-2">
        <input
          type="text"
          className="w-full rounded-lg border border-rm-border bg-rm-bg-surface px-3 py-1.5 text-xs text-rm-text outline-none transition-all placeholder:text-rm-text-muted/30 focus:border-primary/30 focus:ring-2 focus:ring-primary/20"
          placeholder="Search emoji…"
          ref={searchInputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Category tabs */}
      {!search.trim() && (
        <div className="flex gap-0.5 border-b border-rm-border px-2 py-1 bg-rm-bg-elevated/40">
          {EMOJI_CATEGORIES.map((cat, idx) => (
            <button
              key={cat.name}
              className={cn(
                "cursor-pointer rounded-lg px-2 py-1.5 text-sm transition-all outline-none",
                activeCategory === idx
                  ? "bg-rm-bg-active text-rm-text"
                  : "text-rm-text-muted/60 hover:bg-rm-bg-hover hover:text-rm-text-secondary"
              )}
              onClick={() => setActiveCategory(idx)}
              title={cat.name}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto p-2 custom-scrollbar">
        {displayEmojis.map((emoji) => (
          <button
            key={emoji}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-lg transition-all hover:scale-110 hover:bg-rm-bg-hover outline-none"
            onClick={() => handleSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
