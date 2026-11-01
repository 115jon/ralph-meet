import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  useWindowDimensions,
  View,
  type TextInputInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RADIUS, useTheme } from "@/theme";
import { Text } from "@/ui";

import { SlotGrabber, SlotHandle, Stowed } from "../slot/SlotPanel";
import type { ComposerSlot } from "../slot/useComposerSlot";
import type { Gif } from "./api";
import { EmojiGrid } from "./EmojiGrid";
import { GifTab } from "./GifTab";
import { loadCreations } from "./library";
import { PickerSearch } from "./PickerSearch";
import { setPickerTab, usePickerTab, type PickerTab } from "./recents";

/** Grab bar and the tabs-and-search row. */
const HEADER = 58;
/** With the search keyboard up: the header and one row of results. */
const SEARCH_STRIP: Readonly<Record<PickerTab, number>> = {
  emoji: HEADER + 52,
  gif: HEADER + 38 + 132,
};

/** EMOJI | GIF, silkscreen in a ruled box; the lit one is inverted. */
function TabSwitch({
  value,
  onChange,
}: {
  value: PickerTab;
  onChange: (tab: PickerTab) => void;
}) {
  const theme = useTheme();
  const tabs: readonly { id: PickerTab; label: string }[] = [
    { id: "emoji", label: "Emoji" },
    { id: "gif", label: "GIF" },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={{
        height: 32,
        flexDirection: "row",
        borderWidth: 2,
        borderColor: theme.ink1,
        borderRadius: RADIUS,
        overflow: "hidden",
      }}
    >
      {tabs.map((tab, index) => {
        const on = tab.id === value;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.id)}
            hitSlop={{ top: 8, bottom: 8 }}
            style={{
              paddingHorizontal: 12,
              justifyContent: "center",
              backgroundColor: on ? theme.ink1 : "transparent",
              borderLeftWidth: index > 0 ? 2 : 0,
              borderLeftColor: theme.ink1,
            }}
          >
            <Text
              variant="silk"
              style={{ color: on ? theme.ply0 : theme.ink2 }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface PickerPanelProps {
  slot: ComposerSlot;
  /** This panel holds the slot. */
  open: boolean;
  /** Typed at the composer's caret; the panel stays. */
  onInsert: (value: string) => void;
  onSendGif: (gif: Gif) => void;
}

/**
 * The composer's emoji and GIF panel, in the keyboard's slot. The tab it
 * shows is remembered. Its search field raises the keyboard, and the panel
 * keeps the field and a row of results above it.
 */
export function PickerPanel({
  slot,
  open,
  onInsert,
  onSendGif,
}: PickerPanelProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tab = usePickerTab();
  const [emojiQuery, setEmojiQuery] = useState("");
  const [gifQuery, setGifQuery] = useState("");
  const search = useRef<TextInputInstance>(null);
  const { searchStrip } = slot;

  // Put away: the next open starts on a clean grid.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setEmojiQuery("");
      setGifQuery("");
    }
  }
  useEffect(() => {
    if (open) {
      void loadCreations();
      return;
    }
    search.current?.blur();
    searchStrip.set(0);
  }, [open, searchStrip]);

  const query = tab === "emoji" ? emojiQuery : gifQuery;
  const setQuery = tab === "emoji" ? setEmojiQuery : setGifQuery;

  return (
    <View style={{ flex: 1 }}>
      <SlotHandle>
        <View
          style={{
            height: HEADER,
            paddingTop: 8,
            paddingHorizontal: 10,
            gap: 7,
          }}
        >
          <SlotGrabber />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TabSwitch
              value={tab}
              onChange={(next) => {
                setPickerTab(next);
                if (searchStrip.get() > 0) searchStrip.set(SEARCH_STRIP[next]);
              }}
            />
            <PickerSearch
              ref={search}
              value={query}
              onChange={setQuery}
              placeholder={tab === "emoji" ? "Search emoji" : "Search KLIPY"}
              onFocus={() => searchStrip.set(SEARCH_STRIP[tab])}
              onBlur={() => searchStrip.set(0)}
            />
          </View>
        </View>
      </SlotHandle>
      <View style={{ flex: 1 }}>
        <Stowed shown={tab === "emoji"}>
          <EmojiGrid
            query={emojiQuery}
            width={width}
            onPick={onInsert}
            surface={theme.ply1}
            bottomInset={insets.bottom}
            open={open && tab === "emoji"}
          />
        </Stowed>
        <Stowed shown={tab === "gif"}>
          <GifTab
            query={gifQuery}
            onQuery={setGifQuery}
            width={width}
            active={open && tab === "gif"}
            onSend={onSendGif}
            bottomInset={insets.bottom}
          />
        </Stowed>
      </View>
    </View>
  );
}
