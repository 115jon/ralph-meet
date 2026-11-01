import {
  ArrowBendUpLeft,
  Copy,
  PencilSimple,
  Trash,
} from "phosphor-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { RADIUS, useTheme } from "@/theme";
import { Button, Sheet, SheetRow, Text } from "@/ui";

import { canCopy, copyText } from "./clipboard";
import { deleteMessage, toggleReaction } from "./mutations";
import type { ChatMessage } from "./store";

/** The quick set from the mockup; reactions already on the message follow. */
const QUICK_REACTIONS = ["🔥", "😂", "💀", "👍", "🫡"] as const;

export type ComposerIntent =
  | { readonly kind: "reply"; readonly message: ChatMessage }
  | { readonly kind: "edit"; readonly message: ChatMessage };

interface MessageActionsSheetProps {
  message: ChatMessage | null;
  onClose: () => void;
  onCompose: (intent: ComposerIntent) => void;
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mine ? `Remove ${emoji}` : `React with ${emoji}`}
      accessibilityState={{ selected: mine }}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 52,
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
            : theme.tint2,
      })}
    >
      <Text style={{ fontSize: 22, lineHeight: 28 }}>{emoji}</Text>
    </Pressable>
  );
}

function Actions({
  message,
  onClose,
  onCompose,
}: {
  message: ChatMessage;
  onClose: () => void;
  onCompose: (intent: ComposerIntent) => void;
}) {
  const myId = useSession((s) => s.user?.id);
  const [confirming, setConfirming] = useState(false);
  const own = message.author_id === myId;
  const sent = !message.send;
  const text = message.content?.trim() ?? "";
  const emojis = [
    ...new Set([
      ...QUICK_REACTIONS,
      ...(message.reactions ?? []).map((reaction) => reaction.emoji),
    ]),
  ];
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 8,
            paddingHorizontal: 20,
            paddingTop: 6,
            paddingBottom: 12,
          }}
        >
          {emojis.map((emoji) => (
            <ReactionKey
              key={emoji}
              emoji={emoji}
              mine={mine.has(emoji)}
              onPress={() => {
                onClose();
                void toggleReaction(message, emoji);
              }}
            />
          ))}
        </ScrollView>
      ) : null}
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

/** Long-press on a message: quick reactions, then the rows it allows. */
export function MessageActionsSheet({
  message,
  onClose,
  onCompose,
}: MessageActionsSheetProps) {
  return (
    <Sheet visible={message !== null} onClose={onClose} label="Message actions">
      {message ? (
        <Actions
          key={message.id}
          message={message}
          onClose={onClose}
          onCompose={onCompose}
        />
      ) : null}
    </Sheet>
  );
}
