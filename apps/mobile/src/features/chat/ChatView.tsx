import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";

import { closeChannel, openChannel } from "./actions";
import { ChatHeader } from "./ChatHeader";
import { Composer, type ComposerHandle } from "./Composer";
import {
  MessageActionsSheet,
  type ComposerIntent,
} from "./MessageActionsSheet";
import { MessageList } from "./MessageList";
import type { Author } from "./schema";
import type { ChatMessage } from "./store";
import { TypingLine } from "./TypingLine";

const COMPOSER_GAP = 8;

export interface ChatViewProps {
  /** A server text channel or a DM: both are channels to the API. */
  channelId: string;
  title: string;
  subtitle: string;
  avatar?: { name: string; uri: string | null };
  placeholder: string;
  /** The first line above the oldest message. */
  intro: string;
  /** Who can be mentioned and named in the typing line. */
  people: readonly Author[];
}

/**
 * One conversation: header, history, typing line and composer, plus the
 * message sheet. The body follows the keyboard frame by frame (edge to
 * edge, so the window never resizes), keeping the composer on top of it.
 */
export function ChatView({
  channelId,
  title,
  subtitle,
  avatar,
  placeholder,
  intro,
  people,
}: ChatViewProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const composer = useRef<ComposerHandle>(null);
  const [selected, setSelected] = useState<ChatMessage | null>(null);

  useFocusEffect(
    useCallback(() => {
      openChannel(channelId);
      return () => closeChannel(channelId);
    }, [channelId]),
  );

  const bottomInset = insets.bottom;
  const bodyStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value, bottomInset) + COMPOSER_GAP,
  }));

  const closeSheet = useCallback(() => setSelected(null), []);
  const compose = useCallback((intent: ComposerIntent) => {
    composer.current?.compose(intent);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.ply0 }}>
      <ChatHeader title={title} subtitle={subtitle} avatar={avatar} />
      <Animated.View style={[{ flex: 1 }, bodyStyle]}>
        <MessageList
          channelId={channelId}
          title={title}
          intro={intro}
          onLongPress={setSelected}
        />
        <TypingLine channelId={channelId} people={people} />
        <Composer
          ref={composer}
          channelId={channelId}
          placeholder={placeholder}
          people={people}
        />
      </Animated.View>
      <MessageActionsSheet
        message={selected}
        onClose={closeSheet}
        onCompose={compose}
      />
    </View>
  );
}
