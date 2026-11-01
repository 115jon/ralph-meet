import {
  CameraRotate,
  MicrophoneSlash,
  Monitor,
  SpeakerSlash,
} from "phosphor-react-native";
import { lazy, memo, Suspense } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { mediaUrl } from "@/lib/api";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, Led, Text } from "@/ui";

import { flipCamera } from "./actions";
import {
  type CallTile,
  useIsSelf,
  useIsSpeaking,
  useParticipant,
  useTileMirrored,
  useTileStream,
} from "./store";

const VideoView = lazy(() => import("./VideoView"));

interface ParticipantTileProps {
  tile: CallTile;
  /** This tile is on the stage; a press returns to the grid. */
  staged?: boolean;
  /** A filmstrip thumbnail under the stage: smaller avatar and plate. */
  compact?: boolean;
  onPress: (tile: CallTile) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * One tile: a participant (camera video when it is on, else the square
 * avatar) or the screen they share. Speaking lights the LED and rings the
 * tile in talk green; muted or deafened shows the glyph in danger. Both are
 * state changes, nothing animates.
 */
export const ParticipantTile = memo(function ParticipantTile({
  tile,
  staged = false,
  compact = false,
  onPress,
  style,
}: ParticipantTileProps) {
  const theme = useTheme();
  const participant = useParticipant(tile.participantId);
  const speaking = useIsSpeaking(tile.participantId);
  const self = useIsSelf(tile.participantId);
  const stream = useTileStream(tile);
  const mirrored = useTileMirrored(tile);
  if (!participant) return null;

  const screen = tile.kind === "screen";
  // A screen tile shows the share, not the person: no ring, no mute glyph.
  const ringed = speaking && !screen;
  const mark = screen
    ? null
    : participant.deafened
      ? { icon: SpeakerSlash, label: "deafened" }
      : participant.muted
        ? { icon: MicrophoneSlash, label: "muted" }
        : null;
  const name = self ? `${participant.name} (you)` : participant.name;
  const label = screen
    ? `${name}, sharing their screen`
    : `${name}${mark ? `, ${mark.label}` : ""}${speaking ? ", speaking" : ""}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        staged ? "Returns to the grid" : "Shows this tile large"
      }
      onPress={() => onPress(tile)}
      style={[
        {
          flex: 1,
          borderRadius: RADIUS,
          backgroundColor: screen || stream ? theme.ply0 : theme.ply2,
          borderWidth: ringed ? 2 : 1,
          borderColor: ringed ? theme.talk : theme.line,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        },
        style,
      ]}
    >
      {stream ? (
        <Suspense fallback={null}>
          <VideoView
            streamURL={stream}
            fit={screen ? "contain" : "cover"}
            mirror={mirrored}
          />
        </Suspense>
      ) : (
        <Avatar
          name={participant.name}
          size={compact ? 40 : 56}
          uri={mediaUrl(participant.avatarUrl)}
        />
      )}
      {self && stream && !screen && !compact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch camera"
          onPress={flipCamera}
          hitSlop={4}
          style={({ pressed }) => ({
            position: "absolute",
            top: 8,
            right: 8,
            width: 36,
            height: 36,
            borderRadius: RADIUS,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? theme.ply3 : theme.ply4,
          })}
        >
          <Icon icon={CameraRotate} size={20} color={theme.ink1} />
        </Pressable>
      ) : null}
      <View
        style={{
          position: "absolute",
          left: compact ? 4 : 8,
          bottom: compact ? 4 : 8,
          right: compact ? 4 : 8,
          flexDirection: "row",
        }}
      >
        <View
          style={{
            height: compact ? 20 : 24,
            maxWidth: "100%",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: compact ? 6 : 8,
            borderRadius: RADIUS,
            backgroundColor: theme.ply4,
          }}
        >
          {screen ? (
            <Icon icon={Monitor} size={14} color={theme.ink2} />
          ) : mark ? (
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
    </Pressable>
  );
});
