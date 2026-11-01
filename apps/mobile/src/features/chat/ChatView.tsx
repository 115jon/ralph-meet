import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { openProfile } from "@/features/profile/store";
import { tapHaptic } from "@/lib/haptics";
import { useTheme } from "@/theme";

import { closeChannel, openChannel } from "./actions";
import { AttachTray } from "./attach/AttachTray";
import { useAttach } from "./attach/useAttach";
import { ChatHeader } from "./ChatHeader";
import { Composer, type ComposerHandle } from "./Composer";
import { registerComposerInsert } from "./composer-bus";
import {
  MessageActionsSheet,
  type ComposerIntent,
} from "./MessageActionsSheet";
import { MembersContext, MentionPress } from "./markdown/context";
import { MessageList } from "./MessageList";
import { toggleReaction } from "./mutations";
import { PickerPanel } from "./picker/PickerPanel";
import { ReactPicker } from "./picker/ReactPicker";
import { ReactionDetails } from "./reaction-details";
import { ReactionsSheet, type ReactionsTarget } from "./ReactionsSheet";
import type { Author } from "./schema";
import { SlotPanel } from "./slot/SlotPanel";
import { useComposerSlot } from "./slot/useComposerSlot";
import type { ChatMessage } from "./store";
import { TypingLine } from "./TypingLine";

const COMPOSER_GAP = 8;
/** The attach tray floats like a sheet; the emoji panel lies flat like a keyboard. */
const SLOT_SURFACES = { attach: "float", emoji: "flat" } as const;

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
  /** A channel's members key. */
  onMembers?: () => void;
  /** A DM's header opens the other person's profile. */
  onTitle?: () => void;
}

/**
 * One conversation: header, history, typing line and composer, plus the
 * composer's slot (keyboard, emoji panel or attach tray) and the sheets
 * (message actions, the react picker, who reacted). The body follows the
 * keyboard or the slot's panel frame by frame (edge to edge, so the window
 * never resizes), keeping the composer on top of whichever is up.
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
  onMembers,
  onTitle,
}: ChatViewProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const composer = useRef<ComposerHandle>(null);
  const attach = useAttach(channelId);
  const slot = useComposerSlot();
  const { keyboard, lift, close: closeSlot } = slot;
  const [selected, setSelected] = useState<ChatMessage | null>(null);
  const [reacting, setReacting] = useState<ChatMessage | null>(null);
  const [reactions, setReactions] = useState<ReactionsTarget | null>(null);

  // Open while home is on screen, whichever page is in front: peeking at
  // the drawer keeps the history live instead of reloading it on return.
  useFocusEffect(
    useCallback(() => {
      openChannel(channelId);
      return () => closeChannel(channelId);
    }, [channelId]),
  );

  // The slot's panel belongs to the chat in front; sliding to the drawer
  // puts it away.
  useEffect(() => {
    if (!attended) closeSlot();
  }, [attended, closeSlot]);

  const bottomInset = insets.bottom;
  const bodyStyle = useAnimatedStyle(() => ({
    paddingBottom:
      Math.max(keyboard.height.value, lift.value, bottomInset) + COMPOSER_GAP,
  }));

  const peopleByName = useMemo(
    () =>
      new Map(people.map((person) => [person.username.toLowerCase(), person])),
    [people],
  );
  const memberNames = useMemo(
    () => new Set(peopleByName.keys()),
    [peopleByName],
  );
  const openMention = useCallback(
    (username: string) => {
      const person = peopleByName.get(username.toLowerCase());
      if (!person) return false;
      openProfile(person.id, person);
      return true;
    },
    [peopleByName],
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
  const closeReacting = useCallback(() => setReacting(null), []);
  const react = useCallback((message: ChatMessage, emoji: string) => {
    void toggleReaction(message, emoji);
  }, []);
  const showReactions = useCallback(
    (message: ChatMessage, emoji: string) =>
      setReactions({
        channelId: message.channel_id,
        messageId: message.id,
        emoji,
      }),
    [],
  );
  const closeReactions = useCallback(() => setReactions(null), []);
  const insert = useCallback((value: string) => {
    composer.current?.insert(value);
  }, []);
  // "Mention" from a profile or the members page lands here.
  useEffect(() => registerComposerInsert(insert), [insert]);
  const sendGif = useCallback(
    (gif: Parameters<ComposerHandle["sendGif"]>[0]) => {
      composer.current?.sendGif(gif);
      closeSlot();
    },
    [closeSlot],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.ply0 }}>
      <ChatHeader
        title={title}
        subtitle={subtitle}
        avatar={avatar}
        onMenu={onOpenDrawer}
        onMembers={onMembers}
        onTitle={onTitle}
      />
      <Animated.View style={[{ flex: 1 }, bodyStyle]}>
        <MembersContext value={memberNames}>
          <MentionPress value={openMention}>
            <ReactionDetails value={showReactions}>
              <MessageList
                channelId={channelId}
                title={title}
                intro={intro}
                attended={attended}
                onLongPress={openActions}
                onReply={reply}
              />
            </ReactionDetails>
          </MentionPress>
        </MembersContext>
        <TypingLine channelId={channelId} people={people} />
        <Composer
          ref={composer}
          channelId={channelId}
          placeholder={placeholder}
          people={people}
          attach={attach}
          slot={slot}
          attended={attended}
        />
      </Animated.View>
      <SlotPanel
        slot={slot}
        surface={SLOT_SURFACES}
        panels={{
          attach: <AttachTray attach={attach} open={slot.panel === "attach"} />,
          emoji: (
            <PickerPanel
              slot={slot}
              open={slot.panel === "emoji"}
              onInsert={insert}
              onSendGif={sendGif}
            />
          ),
        }}
      />
      <MessageActionsSheet
        message={selected}
        onClose={closeSheet}
        onCompose={compose}
        onMoreReactions={setReacting}
      />
      <ReactPicker message={reacting} onClose={closeReacting} onPick={react} />
      <ReactionsSheet
        target={reactions}
        people={people}
        onClose={closeReactions}
      />
    </View>
  );
}
