import {
  ArrowBendUpLeft,
  Copy,
  PencilSimple,
  SmileyWink,
  Trash,
} from "phosphor-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { tapHaptic } from "@/lib/haptics";
import { RADIUS, useTheme } from "@/theme";
import { Button, Icon, Sheet, SheetRow, Text } from "@/ui";

import { canCopy, copyText } from "./clipboard";
import { deleteMessage, toggleReaction } from "./mutations";
import { emojiLabel } from "./picker/emoji-data";
import { EmojiGlyph } from "./picker/EmojiGlyph";
import { quickReactions } from "./picker/recent-list";
import { rememberEmoji, useRecents } from "./picker/recents";
import type { ChatMessage } from "./store";

export type ComposerIntent =
  | { readonly kind: "reply"; readonly message: ChatMessage }
  | { readonly kind: "edit"; readonly message: ChatMessage };

interface MessageActionsSheetProps {
  message: ChatMessage | null;
  onClose: () => void;
  onCompose: (intent: ComposerIntent) => void;
  /** The quick row's "more" key: the full picker in react mode. */
  onMoreReactions: (message: ChatMessage) => void;
}

function ReactionKey({
  emoji,
  mine,
  onPress,
}: {
  emoji: string;
  mine: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const label = emojiLabel(emoji);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mine ? `Remove ${label}` : `React with ${label}`}
      accessibilityState={{ selected: mine }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 48,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: mine ? theme.accentInk : "transparent",
        backgroundColor: mine
          ? theme.accentTint
          : pressed
            ? theme.tint3
            : theme.ply4,
      })}
    >
      <EmojiGlyph value={emoji} size={24} />
    </Pressable>
  );
}

/** The sixth key: every emoji, in the picker's react mode. */
function MoreKey({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="More reactions"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 48,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: theme.lineStrong,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Icon icon={SmileyWink} size={22} />
    </Pressable>
  );
}

function Seam() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 1,
        marginVertical: 4,
        backgroundColor: theme.lineStrong,
      }}
    />
  );
}

function Actions({
  message,
  onClose,
  onCompose,
  onMoreReactions,
}: {
  message: ChatMessage;
  onClose: () => void;
  onCompose: (intent: ComposerIntent) => void;
  onMoreReactions: (message: ChatMessage) => void;
}) {
  const myId = useSession((s) => s.user?.id);
  const recents = useRecents();
  const [confirming, setConfirming] = useState(false);
  const own = message.author_id === myId;
  const sent = !message.send;
  const text = message.content?.trim() ?? "";
  const emojis = quickReactions(recents);
  const mine = new Set(
    (message.reactions ?? [])
      .filter((reaction) => reaction.me)
      .map((reaction) => reaction.emoji),
  );

  if (confirming) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 8 }}>
        <Text variant="title" style={{ fontSize: 22, lineHeight: 26 }}>
          Delete this message?
        </Text>
        <Text variant="body" tone="ink2" numberOfLines={3}>
          {text || "It is removed for everyone in the conversation."}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Button variant="ghost" label="Cancel" onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              variant="danger"
              label="Delete"
              onPress={() => {
                onClose();
                void deleteMessage(message);
              }}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <>
      {sent ? (
        <View
          style={{
            flexDirection: "row",
            gap: 6,
            paddingHorizontal: 12,
            paddingTop: 4,
            paddingBottom: 12,
          }}
        >
          {emojis.map((emoji) => (
            <ReactionKey
              key={emoji}
              emoji={emoji}
              mine={mine.has(emoji)}
              onPress={() => {
                tapHaptic();
                onClose();
                if (!mine.has(emoji)) rememberEmoji(emoji);
                void toggleReaction(message, emoji);
              }}
            />
          ))}
          <MoreKey
            onPress={() => {
              onClose();
              onMoreReactions(message);
            }}
          />
        </View>
      ) : null}
      {sent ? <Seam /> : null}
      {sent ? (
        <SheetRow
          icon={ArrowBendUpLeft}
          label="Reply"
          onPress={() => {
            onClose();
            onCompose({ kind: "reply", message });
          }}
        />
      ) : null}
      {canCopy && text ? (
        <SheetRow
          icon={Copy}
          label="Copy text"
          onPress={() => {
            onClose();
            copyText(text);
          }}
        />
      ) : null}
      {own && sent && text ? (
        <SheetRow
          icon={PencilSimple}
          label="Edit message"
          onPress={() => {
            onClose();
            onCompose({ kind: "edit", message });
          }}
        />
      ) : null}
      {own ? (
        <SheetRow
          icon={Trash}
          label={sent ? "Delete message" : "Discard message"}
          danger
          onPress={() => {
            if (sent) {
              setConfirming(true);
              return;
            }
            onClose();
            void deleteMessage(message);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Long-press on a message: the quick row (your five most recent reactions
 * and a key for all of them), then the rows it allows.
 */
export function MessageActionsSheet({
  message,
  onClose,
  onCompose,
  onMoreReactions,
}: MessageActionsSheetProps) {
  return (
    <Sheet visible={message !== null} onClose={onClose} label="Message actions">
      {message ? (
        <Actions
          key={message.id}
          message={message}
          onClose={onClose}
          onCompose={onCompose}
          onMoreReactions={onMoreReactions}
        />
      ) : null}
    </Sheet>
  );
}
