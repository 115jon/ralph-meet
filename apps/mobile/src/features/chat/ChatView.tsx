import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { tapHaptic } from "@/lib/haptics";
import { useTheme } from "@/theme";

import { closeChannel, openChannel } from "./actions";
import { AttachTray } from "./attach/AttachTray";
import { useAttach } from "./attach/useAttach";
import { ChatHeader } from "./ChatHeader";
import { Composer, type ComposerHandle } from "./Composer";
import {
  MessageActionsSheet,
  type ComposerIntent,
} from "./MessageActionsSheet";
import { MembersContext } from "./markdown/context";
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
  /**
   * In front of the user: the pager's chat page, not covered by the drawer
   * or another screen. Media plays and back cancels a reply only then.
   */
  attended: boolean;
  /** The header's menu key: slides the chat aside to the drawer. */
  onOpenDrawer: () => void;
}

/**
 * One conversation: header, history, typing line and composer, plus the
 * attach tray and the message sheet. The body follows the keyboard or the
 * tray frame by frame (edge to edge, so the window never resizes), keeping
 * the composer on top of whichever is up.
 */
export function ChatView({
  channelId,
  title,
  subtitle,
  avatar,
  placeholder,
  intro,
  people,
  attended,
  onOpenDrawer,
}: ChatViewProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const composer = useRef<ComposerHandle>(null);
  const attach = useAttach(channelId);
  const { lift, closeTray } = attach;
  const [selected, setSelected] = useState<ChatMessage | null>(null);

  // Open while home is on screen, whichever page is in front: peeking at
  // the drawer keeps the history live instead of reloading it on return.
  useFocusEffect(
    useCallback(() => {
      openChannel(channelId);
      return () => closeChannel(channelId);
    }, [channelId]),
  );

  // The tray belongs to the chat in front; sliding to the drawer puts it away.
  useEffect(() => {
    if (!attended) closeTray();
  }, [attended, closeTray]);

  const bottomInset = insets.bottom;
  const bodyStyle = useAnimatedStyle(() => ({
    paddingBottom:
      Math.max(keyboard.height.value, lift.value, bottomInset) + COMPOSER_GAP,
  }));

  const memberNames = useMemo(
    () => new Set(people.map((person) => person.username.toLowerCase())),
    [people],
  );
  const closeSheet = useCallback(() => setSelected(null), []);
  const openActions = useCallback((message: ChatMessage) => {
    tapHaptic();
    setSelected(message);
  }, []);
  const compose = useCallback((intent: ComposerIntent) => {
    composer.current?.compose(intent);
  }, []);
  const reply = useCallback((message: ChatMessage) => {
    composer.current?.compose({ kind: "reply", message });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.ply0 }}>
      <ChatHeader
        title={title}
        subtitle={subtitle}
        avatar={avatar}
        onMenu={onOpenDrawer}
      />
      <Animated.View style={[{ flex: 1 }, bodyStyle]}>
        <MembersContext value={memberNames}>
          <MessageList
            channelId={channelId}
            title={title}
            intro={intro}
            attended={attended}
            onLongPress={openActions}
            onReply={reply}
          />
        </MembersContext>
        <TypingLine channelId={channelId} people={people} />
        <Composer
          ref={composer}
          channelId={channelId}
          placeholder={placeholder}
          people={people}
          attach={attach}
          attended={attended}
        />
      </Animated.View>
      <AttachTray attach={attach} />
      <MessageActionsSheet
        message={selected}
        onClose={closeSheet}
        onCompose={compose}
      />
    </View>
  );
}
