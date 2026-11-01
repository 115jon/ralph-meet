import { ChatCircle, Check, X } from "phosphor-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { LONG_PRESS_MS } from "@/features/chat/long-press";
import {
  PRESENCE_LABEL,
  presenceLedOf,
  useCustomStatus,
  usePresence,
} from "@/features/presence/live";
import { mediaUrl } from "@/lib/api";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, SquareKey, Text } from "@/ui";

import { personName } from "./filters";
import { RELATIONSHIP, type Relationship } from "./schema";

export const FRIEND_ROW_HEIGHT = 60;

export interface FriendRowActions {
  onOpen: (relationship: Relationship) => void;
  onLongPress: (relationship: Relationship) => void;
  onMessage: (relationship: Relationship) => void;
  onAccept: (relationship: Relationship) => void;
  /** Ignore theirs, cancel yours, or unblock. */
  onRemove: (relationship: Relationship) => void;
}

/** What the second line says for each kind of row. */
function useSecondLine(relationship: Relationship): string {
  const { user, type } = relationship;
  const presence = usePresence(user.id, user.status);
  const custom = useCustomStatus(user.id, user.custom_status);
  if (type === RELATIONSHIP.outgoing) return "Request sent";
  if (type !== RELATIONSHIP.friend) return `@${user.username}`;
  if (custom && presence !== "offline") return custom;
  return PRESENCE_LABEL[presence];
}

/**
 * 60px: avatar with presence, name over a second line, and the row's keys:
 * Message for a friend, Accept and Ignore for theirs, cancel for yours,
 * Unblock for a block. Tap opens the profile; long-press, more actions.
 */
export const FriendRow = memo(function FriendRow({
  relationship,
  actions,
}: {
  relationship: Relationship;
  actions: FriendRowActions;
}) {
  const theme = useTheme();
  const { user, type } = relationship;
  const name = personName(user);
  const presence = usePresence(user.id, user.status);
  const line = useSecondLine(relationship);
  const friend = type === RELATIONSHIP.friend;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${line}`}
      accessibilityHint="Opens their profile. Long press for actions."
      onPress={() => actions.onOpen(relationship)}
      onLongPress={() => actions.onLongPress(relationship)}
      delayLongPress={LONG_PRESS_MS}
      style={({ pressed }) => ({
        height: FRIEND_ROW_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 12,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Avatar
        name={name}
        size={40}
        uri={mediaUrl(user.avatar_url)}
        presence={friend ? presenceLedOf(presence) : undefined}
        presenceGround={theme.ply0}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="name" numberOfLines={1}>
          {name}
        </Text>
        <Text
          variant="row"
          tone="ink2"
          numberOfLines={1}
          style={{ fontSize: 12.5, lineHeight: 16 }}
        >
          {line}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {friend ? (
          <SquareKey
            icon={ChatCircle}
            label={`Message ${name}`}
            onPress={() => actions.onMessage(relationship)}
          />
        ) : null}
        {type === RELATIONSHIP.incoming ? (
          <>
            <SquareKey
              icon={Check}
              label={`Accept ${name}`}
              tone="primary"
              onPress={() => actions.onAccept(relationship)}
            />
            <SquareKey
              icon={X}
              label={`Ignore ${name}`}
              onPress={() => actions.onRemove(relationship)}
            />
          </>
        ) : null}
        {type === RELATIONSHIP.outgoing ? (
          <SquareKey
            icon={X}
            label={`Cancel the request to ${name}`}
            onPress={() => actions.onRemove(relationship)}
          />
        ) : null}
        {type === RELATIONSHIP.blocked ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Unblock ${name}`}
            onPress={() => actions.onRemove(relationship)}
            hitSlop={4}
            style={({ pressed }) => ({
              height: 40,
              paddingHorizontal: 12,
              justifyContent: "center",
              borderRadius: RADIUS,
              borderWidth: 2,
              borderColor: theme.lineStrong,
              backgroundColor: pressed ? theme.tint2 : "transparent",
            })}
          >
            <Text variant="control" style={{ fontSize: 14 }}>
              Unblock
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
});
