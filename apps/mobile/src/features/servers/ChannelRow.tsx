import {
  Hash,
  MicrophoneSlash,
  Monitor,
  SpeakerHigh,
  SpeakerSimpleNone,
  SpeakerSlash,
  VideoCamera,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { memo, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { useIsCurrentConversation } from "@/features/conversation/store";
import { mediaUrl } from "@/lib/api";
import { FONT, RADIUS, useTheme, type Theme } from "@/theme";
import { Avatar, Icon, Led, Text } from "@/ui";

import type { Channel, VoiceMember } from "./schema";
import { useIsUnread, useVoiceMembers } from "./store";
import { TreeGuide } from "./TreeGuide";

/** The branch stroke's x, and where a channel's icon starts. */
const BRANCH_X = 14;
const CHANNEL_INSET = 28;
/** Occupants hang off a stroke under the centre of the channel's icon. */
const OCCUPANT_X = CHANNEL_INSET + 10;
const OCCUPANT_INSET = OCCUPANT_X + 14;

export interface ChannelRowProps {
  channel: Channel;
  /** Last row of its branch: the stroke stops at its tick. */
  last: boolean;
  onPress: (channel: Channel) => void;
}

interface RowShellProps {
  label: string;
  last: boolean;
  onPress: () => void;
  /** The open conversation: a tint-2 ground, as the web's selected row. */
  selected?: boolean;
  children: ReactNode;
}

function RowShell({
  label,
  last,
  onPress,
  selected = false,
  children,
}: RowShellProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: CHANNEL_INSET,
        paddingRight: 10,
        borderRadius: RADIUS,
        backgroundColor: pressed || selected ? theme.tint2 : "transparent",
      })}
    >
      <TreeGuide x={BRANCH_X} last={last} />
      {children}
    </Pressable>
  );
}

export const TextChannelRow = memo(function TextChannelRow({
  channel,
  last,
  onPress,
}: ChannelRowProps) {
  const theme = useTheme();
  const unread = useIsUnread(channel.id);
  const selected = useIsCurrentConversation(channel.id);
  return (
    <RowShell
      label={`${channel.name}, text channel${unread ? ", unread" : ""}`}
      last={last}
      selected={selected}
      onPress={() => onPress(channel)}
    >
      {unread ? (
        // The only side mark: a 2 by 8 pill flush with the panel edge.
        <View
          style={{
            position: "absolute",
            left: -8,
            top: 20,
            width: 2,
            height: 8,
            backgroundColor: theme.ink1,
          }}
        />
      ) : null}
      <Icon icon={Hash} size={20} color={unread ? theme.ink1 : theme.ink3} />
      <Text
        variant="row"
        numberOfLines={1}
        style={{
          flex: 1,
          fontSize: 15,
          // Unread rows are ink-1 at 600, read rows ink-2 at 500.
          fontFamily: unread ? FONT.rowStrong : FONT.row,
          color: unread ? theme.ink1 : theme.ink2,
        }}
      >
        {channel.name}
      </Text>
    </RowShell>
  );
});

export const VoiceChannelRow = memo(function VoiceChannelRow({
  channel,
  last,
  onPress,
}: ChannelRowProps) {
  const theme = useTheme();
  const members = useVoiceMembers(channel.id);
  const myId = useSession((s) => s.user?.id);
  const live = members.length > 0;
  return (
    <View>
      <RowShell
        label={`${channel.name}, voice channel, ${
          live ? `${members.length} in the room` : "empty"
        }`}
        last={last && !live}
        onPress={() => onPress(channel)}
      >
        <Icon
          icon={live ? SpeakerHigh : SpeakerSimpleNone}
          active={live}
          size={20}
          color={live ? theme.talk : theme.ink3}
        />
        <Text
          variant="row"
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: 15,
            color: live ? theme.ink1 : theme.ink2,
          }}
        >
          {channel.name}
        </Text>
        {live ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Led state="talk" />
            <Text variant="num" tone="ink2">
              {members.length}
            </Text>
          </View>
        ) : (
          <Text variant="silk" tone="inkOff" numberOfLines={1}>
            Empty
          </Text>
        )}
      </RowShell>
      {members.map((member, index) => (
        <OccupantRow
          key={member.user_id}
          member={member}
          isMe={member.user_id === myId}
          last={index === members.length - 1}
          branchContinues={!last}
        />
      ))}
    </View>
  );
});

function memberName(member: VoiceMember): string {
  return (
    member.display_name ??
    member.name ??
    member.username ??
    "Someone"
  ).trim();
}

interface MemberState {
  icon: PhosphorIcon;
  color: string;
  label: string;
}

/** The loudest part of a member's state: a filled glyph in an LED hue. */
function memberState(member: VoiceMember, theme: Theme): MemberState | null {
  if (member.self_deaf) {
    return { icon: SpeakerSlash, color: theme.dangerInk, label: "deafened" };
  }
  if (member.self_mute) {
    return { icon: MicrophoneSlash, color: theme.dangerInk, label: "muted" };
  }
  if (member.self_stream) {
    return { icon: Monitor, color: theme.live, label: "sharing a screen" };
  }
  if (member.self_video) {
    return { icon: VideoCamera, color: theme.live, label: "camera on" };
  }
  return null;
}

interface OccupantRowProps {
  member: VoiceMember;
  isMe: boolean;
  last: boolean;
  /** More channels follow, so the branch stroke runs through this row. */
  branchContinues: boolean;
}

const OccupantRow = memo(function OccupantRow({
  member,
  isMe,
  last,
  branchContinues,
}: OccupantRowProps) {
  const theme = useTheme();
  const name = memberName(member);
  const state = memberState(member, theme);
  // Their socket was lost and the room holds the seat for a resume: dimmed,
  // as on web and desktop, until they are back or the hold runs out.
  const reconnecting = member.connected === false;
  return (
    <View
      accessible
      accessibilityLabel={`${name}${isMe ? ", you" : ""}${
        reconnecting ? ", reconnecting" : state ? `, ${state.label}` : ""
      }`}
      style={{
        opacity: reconnecting ? 0.5 : 1,
        minHeight: 40,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: OCCUPANT_INSET,
        paddingRight: 10,
      }}
    >
      {branchContinues ? (
        <TreeGuide x={BRANCH_X} last={false} tick={false} />
      ) : null}
      <TreeGuide x={OCCUPANT_X} last={last} lit={isMe && !reconnecting} />
      <Avatar name={name} size={24} uri={mediaUrl(member.avatar_url)} />
      <Text
        variant="body"
        numberOfLines={1}
        tone={isMe ? "ink1" : "ink2"}
        style={{ flex: 1, fontSize: 14, lineHeight: 20 }}
      >
        {name}
        {isMe ? (
          <Text tone="ink3" style={{ fontSize: 14, lineHeight: 20 }}>
            {" (you)"}
          </Text>
        ) : null}
      </Text>
      {state ? (
        <Icon icon={state.icon} active size={16} color={state.color} />
      ) : null}
    </View>
  );
});
