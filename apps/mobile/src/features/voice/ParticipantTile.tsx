import { MicrophoneSlash, SpeakerSlash } from "phosphor-react-native";
import { memo } from "react";
import { View } from "react-native";

import { mediaUrl } from "@/lib/api";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, Led, Text } from "@/ui";

import { useIsSelf, useIsSpeaking, useParticipant } from "./store";

interface ParticipantTileProps {
  id: string;
}

/**
 * One participant: square avatar, name plate, and state. Speaking lights the
 * LED and rings the tile in talk green; muted or deafened shows the glyph in
 * danger. Both are state changes, nothing animates.
 */
export const ParticipantTile = memo(function ParticipantTile({
  id,
}: ParticipantTileProps) {
  const theme = useTheme();
  const participant = useParticipant(id);
  const speaking = useIsSpeaking(id);
  const self = useIsSelf(id);
  if (!participant) return null;

  const mark = participant.deafened
    ? { icon: SpeakerSlash, label: "deafened" }
    : participant.muted
      ? { icon: MicrophoneSlash, label: "muted" }
      : null;
  const name = self ? `${participant.name} (you)` : participant.name;

  return (
    <View
      accessible
      accessibilityLabel={`${name}${mark ? `, ${mark.label}` : ""}${
        speaking ? ", speaking" : ""
      }`}
      style={{
        flex: 1,
        borderRadius: RADIUS,
        backgroundColor: theme.ply2,
        borderWidth: speaking ? 2 : 1,
        borderColor: speaking ? theme.talk : theme.line,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Avatar
        name={participant.name}
        size={56}
        uri={mediaUrl(participant.avatarUrl)}
      />
      <View
        style={{
          position: "absolute",
          left: 8,
          bottom: 8,
          right: 8,
          flexDirection: "row",
        }}
      >
        <View
          style={{
            height: 24,
            maxWidth: "100%",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 8,
            borderRadius: RADIUS,
            backgroundColor: theme.ply4,
          }}
        >
          {mark ? (
            <Icon icon={mark.icon} active size={14} color={theme.dangerInk} />
          ) : (
            <Led state={speaking ? "talk" : "off"} />
          )}
          <Text
            variant="name"
            numberOfLines={1}
            style={{ fontSize: 12, lineHeight: 16, flexShrink: 1 }}
          >
            {name}
          </Text>
        </View>
      </View>
    </View>
  );
});
