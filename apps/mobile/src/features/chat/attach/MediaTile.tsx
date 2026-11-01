import { Camera, Play } from "phosphor-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { FONT, RADIUS, useTheme } from "@/theme";
import { Icon, RemoteImage, Text } from "@/ui";

import { formatDuration } from "./limits";
import type { PickedFile } from "./types";

const MARK = 22;
// Chrome drawn over a photo: fixed, since a theme ink can vanish on any image.
const OVER_MEDIA_EDGE = "rgba(255, 255, 255, 0.92)";
const OVER_MEDIA_FILL = "rgba(0, 0, 0, 0.32)";
const OVER_MEDIA_READOUT = "rgba(0, 0, 0, 0.56)";

/**
 * The selection mark: a hollow 2px square, or once picked a square count
 * chip on ink with its place in the selection in Martian.
 */
export function SelectionMark({ order }: { order: number | null }) {
  const theme = useTheme();
  if (order === null) {
    return (
      <View
        style={{
          width: MARK,
          height: MARK,
          borderRadius: RADIUS,
          borderWidth: 2,
          borderColor: OVER_MEDIA_EDGE,
          backgroundColor: OVER_MEDIA_FILL,
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: MARK,
        height: MARK,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.ink1,
      }}
    >
      <Text
        variant="num"
        style={{
          fontFamily: FONT.silkStrong,
          fontSize: 12,
          lineHeight: 16,
          color: theme.ply0,
        }}
      >
        {order}
      </Text>
    </View>
  );
}

/** "0:12" over a video's corner, with a small play glyph. */
export function DurationReadout({ seconds }: { seconds: number }) {
  return (
    <View
      style={{
        position: "absolute",
        left: 4,
        bottom: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: RADIUS,
        backgroundColor: OVER_MEDIA_READOUT,
      }}
    >
      <Icon icon={Play} active size={9} color="#ffffff" />
      <Text
        variant="num"
        style={{ fontSize: 11, lineHeight: 14, color: "#ffffff" }}
      >
        {formatDuration(seconds)}
      </Text>
    </View>
  );
}

interface MediaTileProps {
  asset: PickedFile;
  size: number;
  /** 1-based place in the selection, or null. */
  order: number | null;
  /** The selection is full: unpicked tiles dim, and a tap explains why. */
  full: boolean;
  onPress: (asset: PickedFile) => void;
}

/** One recent photo or video in the tray grid. */
export const MediaTile = memo(function MediaTile({
  asset,
  size,
  order,
  full,
  onPress,
}: MediaTileProps) {
  const theme = useTheme();
  const selected = order !== null;
  const label = `${asset.kind === "video" ? "Video" : "Photo"} ${asset.name}`;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: full && !selected }}
      onPress={() => onPress(asset)}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: RADIUS,
        overflow: "hidden",
        backgroundColor: theme.ply4,
        opacity: full && !selected ? 0.4 : pressed ? 0.84 : 1,
      })}
    >
      <RemoteImage url={asset.uri} style={{ width: size, height: size }} />
      {asset.kind === "video" && asset.duration !== null ? (
        <DurationReadout seconds={asset.duration} />
      ) : null}
      {selected ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: RADIUS,
            borderWidth: 2,
            borderColor: theme.ink1,
            backgroundColor: theme.tint2,
          }}
        />
      ) : null}
      <View style={{ position: "absolute", top: 6, right: 6 }}>
        <SelectionMark order={order} />
      </View>
    </Pressable>
  );
});

/** The first tile: opens the camera; a capture joins the selection. */
export function CameraTile({
  size,
  onPress,
}: {
  size: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Take a photo or video"
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        gap: 6,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: pressed ? theme.tint2 : theme.ply4,
      })}
    >
      <Icon icon={Camera} size={28} color={theme.ink2} />
      <Text variant="silk" tone="ink3">
        Camera
      </Text>
    </Pressable>
  );
}
