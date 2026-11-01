import { SpeakerHigh } from "phosphor-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { authorName } from "@/features/chat/authors";
import { LONG_PRESS_MS } from "@/features/chat/long-press";
import {
  presenceLedOf,
  useCustomStatus,
  usePresence,
} from "@/features/presence/live";
import {
  nameLook,
  parseDisplayNameStyle,
  roleColor,
} from "@/features/profile/style";
import { useIsUserSpeaking } from "@/features/voice/store";
import { mediaUrl } from "@/lib/api";
import { FONT, useTheme } from "@/theme";
import { Avatar, Icon, TalkLed, Text } from "@/ui";

import { highestRole } from "./grouping";
import type { ServerMember } from "./schema";

export const MEMBER_ROW_HEIGHT = 52;
export const MEMBER_HEADER_HEIGHT = 36;

interface MemberRowProps {
  member: ServerMember;
  online: boolean;
  typing: boolean;
  /** The voice channel they are in, by name. */
  voiceChannel: string | null;
  onPress: (member: ServerMember) => void;
  onLongPress: (member: ServerMember) => void;
}

/**
 * 52px: avatar with presence, the name (in its role colour or its own
 * style), and one line under it: typing, then voice, then custom status.
 * A talk LED lights at the end while they speak in your call. Offline rows
 * sit at half strength, as on the web.
 */
export const MemberRow = memo(function MemberRow({
  member,
  online,
  typing,
  voiceChannel,
  onPress,
  onLongPress,
}: MemberRowProps) {
  const theme = useTheme();
  const { user } = member;
  const presence = usePresence(user.id, user.status);
  const custom = useCustomStatus(user.id, user.custom_status);
  const speaking = useIsUserSpeaking(user.id);
  const name = authorName(user);
  const style = parseDisplayNameStyle(user.display_name_style);
  // The web colours an online name by its role, unless it has a style.
  const look = style ? nameLook(style, theme.ply0) : null;
  const tint =
    online && !style
      ? roleColor(highestRole(member.roles)?.color, theme.ply0)
      : null;

  let line: { text: string; voice: boolean } | null = null;
  if (typing && online) line = { text: "typing…", voice: false };
  else if (voiceChannel) line = { text: voiceChannel, voice: true };
  else if (custom) line = { text: custom, voice: false };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        name,
        online ? presence : "offline",
        line?.voice ? `in ${line.text}` : line?.text,
        speaking ? "speaking" : null,
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityHint="Opens their profile. Long press for actions."
      onPress={() => onPress(member)}
      onLongPress={() => onLongPress(member)}
      delayLongPress={LONG_PRESS_MS}
      style={({ pressed }) => ({
        height: MEMBER_ROW_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          opacity: online ? 1 : 0.5,
        }}
      >
        <Avatar
          name={name}
          size={32}
          uri={mediaUrl(user.avatar_url)}
          presence={online ? presenceLedOf(presence) : undefined}
          presenceGround={theme.ply0}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            variant="name"
            numberOfLines={1}
            style={look ?? (tint ? { color: tint } : undefined)}
          >
            {name}
          </Text>
          {line ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              {line.voice ? (
                <Icon icon={SpeakerHigh} size={13} color={theme.ink2} />
              ) : null}
              <Text
                variant="row"
                tone="ink2"
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  fontSize: 12.5,
                  lineHeight: 16,
                  fontFamily: line.voice ? FONT.row : FONT.body,
                }}
              >
                {line.text}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <TalkLed lit={speaking} />
    </Pressable>
  );
});

/** A branch label in silkscreen with its count, like the web's tree. */
export const MemberHeader = memo(function MemberHeader({
  name,
  count,
}: {
  name: string;
  count: number;
}) {
  return (
    <View
      accessibilityRole="header"
      accessible
      accessibilityLabel={`${name}, ${count}`}
      style={{
        height: MEMBER_HEADER_HEIGHT,
        flexDirection: "row",
        alignItems: "flex-end",
        paddingHorizontal: 16,
        paddingBottom: 6,
      }}
    >
      {/* Role names are user content; silkscreen uppercases them as labels. */}
      <Text variant="silk" tone="ink3" numberOfLines={1} style={{ flex: 1 }}>
        {name}
      </Text>
      <Text variant="num" tone="ink3" style={{ fontSize: 11 }}>
        {count}
      </Text>
    </View>
  );
});
