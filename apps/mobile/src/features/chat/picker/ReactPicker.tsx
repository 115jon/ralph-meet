import { X } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RADIUS, useTheme } from "@/theme";
import { Icon, Sheet, Text } from "@/ui";

import { authorName } from "../authors";
import type { ChatMessage } from "../store";
import { EmojiGrid } from "./EmojiGrid";
import { loadCreations } from "./library";
import { PickerSearch } from "./PickerSearch";

/** The mockup's 560 tall sheet, less on a short screen. */
const MAX_HEIGHT = 560;
const SCREEN_SHARE = 0.78;

/** Tracks the keyboard's height inside a Modal, where the window never resizes. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) =>
      setHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

function Body({
  message,
  onPick,
  onClose,
}: {
  message: ChatMessage;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height: screen } = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  const [query, setQuery] = useState("");
  // With the keyboard up the sheet shrinks to stay on screen.
  const height = Math.min(
    MAX_HEIGHT,
    Math.round(screen * SCREEN_SHARE),
    screen - keyboard - insets.top - 40,
  );

  useEffect(() => {
    void loadCreations();
  }, []);

  return (
    <View style={{ height }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 16,
          paddingRight: 12,
          paddingBottom: 4,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="silk" tone="ink3" numberOfLines={1}>
            React · {authorName(message.author)}
          </Text>
          <Text
            variant="display"
            numberOfLines={1}
            style={{ fontSize: 22, lineHeight: 26, letterSpacing: -0.4 }}
          >
            Add a reaction
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: RADIUS,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? theme.tint3 : theme.tint2,
          })}
        >
          <Icon icon={X} size={18} />
        </Pressable>
      </View>
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 10,
          paddingTop: 8,
          paddingBottom: 2,
        }}
      >
        <PickerSearch
          value={query}
          onChange={setQuery}
          placeholder="Search emoji and your creations"
          height={44}
        />
      </View>
      <EmojiGrid
        query={query}
        width={width}
        onPick={onPick}
        surface={theme.ply3}
        bottomInset={0}
      />
    </View>
  );
}

/**
 * The full emoji picker in react mode, from the message sheet's "more" key:
 * the composer's grid without the GIF tab, a kicker naming the author, and
 * it closes on a pick.
 */
export function ReactPicker({
  message,
  onPick,
  onClose,
}: {
  message: ChatMessage | null;
  onPick: (message: ChatMessage, value: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={message !== null} onClose={onClose} label="Add a reaction">
      {message ? (
        <Body
          key={message.id}
          message={message}
          onClose={onClose}
          onPick={(value) => {
            onClose();
            onPick(message, value);
          }}
        />
      ) : null}
    </Sheet>
  );
}
