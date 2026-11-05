import { CAMERA_UNAVAILABLE_LABEL } from "@ralph/voice-media/video-flow";
import {
  CameraRotate,
  MicrophoneSlash,
  Monitor,
  SpeakerSlash,
  SpeakerX,
  VideoCameraSlash,
} from "phosphor-react-native";
import { lazy, memo, Suspense } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { mediaUrl } from "@/lib/api";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, Led, Text } from "@/ui";

import { flipCamera } from "./actions";
import { useCameraTileView } from "./camera-tile";
import { PEER_VOLUME, usePeerSettings } from "./peer-settings";
import {
  type CallTile,
  useIsSelf,
  useIsSpeaking,
  useParticipant,
  useRemoteCamera,
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
  /** Opens the person's sheet (volume, mute for me) or your own options. */
  onLongPress?: (tile: CallTile) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * One tile: a participant (camera video when it is on, else the square
 * avatar) or the screen they share. Speaking lights the LED and rings the
 * tile in talk green; muted or deafened shows the glyph in danger, and so
 * does a struck speaker when you muted them for yourself. A volume other
 * than 100% shows as a readout on the plate. All state, nothing animates.
 * A remote camera announced on that does not play shows the avatar (with
 * "Video unavailable" once it never came or stalled), never a black or
 * frozen frame; its video stays mounted underneath, measured, and shows
 * again as soon as frames come back.
 */
export const ParticipantTile = memo(function ParticipantTile({
  tile,
  staged = false,
  compact = false,
  onPress,
  onLongPress,
  style,
}: ParticipantTileProps) {
  const theme = useTheme();
  const participant = useParticipant(tile.participantId);
  const speaking = useIsSpeaking(tile.participantId);
  const self = useIsSelf(tile.participantId);
  const stream = useTileStream(tile);
  const remoteCamera = useRemoteCamera(tile);
  const cameraView = useCameraTileView(remoteCamera, stream !== null);
  const showsVideo = stream !== null && cameraView === "video";
  const mirrored = useTileMirrored(tile);
  const settings = usePeerSettings(self ? null : (participant?.userId ?? null));
  if (!participant) return null;

  const screen = tile.kind === "screen";
  const level = screen ? settings.streamVolume : settings.volume;
  const readout =
    !settings.muted && level !== PEER_VOLUME.default ? `${level}%` : null;
  // A screen tile shows the share, not the person: no ring, no mute glyph.
  const ringed = speaking && !screen;
  const mark = settings.muted
    ? { icon: SpeakerX, label: "muted for you" }
    : screen
      ? null
      : participant.deafened
        ? { icon: SpeakerSlash, label: "deafened" }
        : participant.muted
          ? { icon: MicrophoneSlash, label: "muted" }
          : null;
  const name = self ? `${participant.name} (you)` : participant.name;
  const unavailable = cameraView === "unavailable";
  const label = screen
    ? `${name}, sharing their screen`
    : `${name}${mark ? `, ${mark.label}` : ""}${speaking ? ", speaking" : ""}${
        unavailable ? `, ${CAMERA_UNAVAILABLE_LABEL.toLowerCase()}` : ""
      }`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        staged ? "Returns to the grid" : "Shows this tile large"
      }
      accessibilityActions={
        onLongPress ? [{ name: "longpress", label: "Options" }] : undefined
      }
      onAccessibilityAction={() => onLongPress?.(tile)}
      onPress={() => onPress(tile)}
      onLongPress={onLongPress ? () => onLongPress(tile) : undefined}
      delayLongPress={350}
      style={[
        {
          flex: 1,
          borderRadius: RADIUS,
          backgroundColor: screen || showsVideo ? theme.ply0 : theme.ply2,
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
      ) : null}
      {showsVideo ? null : (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              justifyContent: "center",
              gap: compact ? 4 : 8,
              backgroundColor: theme.ply2,
            },
          ]}
        >
          <Avatar
            name={participant.name}
            size={compact ? 40 : 56}
            uri={mediaUrl(participant.avatarUrl)}
          />
          {unavailable ? (
            <View
              style={{
                height: 20,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: compact ? 4 : 6,
                borderRadius: RADIUS,
                backgroundColor: theme.ply4,
              }}
            >
              <Icon icon={VideoCameraSlash} size={12} color={theme.ink3} />
              {compact ? null : (
                <Text
                  variant="row"
                  tone="ink2"
                  style={{ fontSize: 11, lineHeight: 14 }}
                >
                  {CAMERA_UNAVAILABLE_LABEL}
                </Text>
              )}
            </View>
          ) : null}
        </View>
      )}
      {self && stream && !screen && !compact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch camera"
          onPress={flipCamera}
          hitSlop={6}
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
          {mark ? (
            <Icon icon={mark.icon} active size={14} color={theme.dangerInk} />
          ) : screen ? (
            <Icon icon={Monitor} size={14} color={theme.ink2} />
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
          {readout && !compact ? (
            <Text variant="num" tone="ink2" style={{ fontSize: 11 }}>
              {readout}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});
