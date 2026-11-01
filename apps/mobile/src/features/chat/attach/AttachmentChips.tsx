import { ArrowClockwise, File, X } from "phosphor-react-native";
import { Pressable, ScrollView, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";
import { Icon, Led, RemoteImage, Text } from "@/ui";

import { formatBytes } from "./limits";
import { DurationReadout } from "./MediaTile";
import type { DraftItem, Notice } from "./types";

const CHIP = 64;
const FILE_CHIP_WIDTH = 176;

function stateLabel(item: DraftItem): string {
  switch (item.upload.phase) {
    case "uploading":
      return `, uploading ${Math.round(item.upload.progress * 100)} percent`;
    case "failed":
      return `, ${item.upload.reason}. Tap to retry`;
    default:
      return "";
  }
}

/** A 2px ink bar along the chip's foot while its file goes up. */
function ProgressBar({ fraction }: { fraction: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
        backgroundColor: theme.tint3,
      }}
    >
      <View
        style={{
          width: `${Math.round(fraction * 100)}%`,
          height: 2,
          backgroundColor: theme.ink1,
        }}
      />
    </View>
  );
}

function Chip({
  item,
  sending,
  onRemove,
  onRetry,
}: {
  item: DraftItem;
  sending: boolean;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const media = item.kind !== "file";
  const failed = item.upload.phase === "failed";
  const progress =
    item.upload.phase === "uploading"
      ? item.upload.progress
      : item.upload.phase === "waiting" && sending
        ? 0
        : null;
  return (
    <View style={{ paddingTop: 6, paddingRight: 6 }}>
      <Pressable
        accessibilityRole={failed ? "button" : undefined}
        accessibilityLabel={`${item.name}${stateLabel(item)}`}
        disabled={!failed}
        onPress={onRetry}
        style={{
          width: media ? CHIP : FILE_CHIP_WIDTH,
          height: CHIP,
          borderRadius: RADIUS,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: theme.line,
          backgroundColor: theme.ply2,
        }}
      >
        {media ? (
          <>
            <RemoteImage url={item.uri} style={{ width: CHIP, height: CHIP }} />
            {item.kind === "video" && item.duration !== null ? (
              <DurationReadout seconds={item.duration} />
            ) : null}
          </>
        ) : (
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingLeft: 12,
              paddingRight: 20,
            }}
          >
            <Icon icon={File} size={20} color={theme.ink2} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text
                variant="row"
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{ fontSize: 13, lineHeight: 18 }}
              >
                {item.name}
              </Text>
              <Text variant="num" tone="ink3" style={{ fontSize: 11 }}>
                {item.size !== null ? formatBytes(item.size) : "File"}
              </Text>
            </View>
          </View>
        )}
        {failed ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.scrim,
            }}
          >
            <Icon icon={ArrowClockwise} size={20} color="#ffffff" />
            <View style={{ position: "absolute", left: 6, bottom: 6 }}>
              <Led state="danger" size={6} />
            </View>
          </View>
        ) : null}
        {progress !== null ? <ProgressBar fraction={progress} /> : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.name}`}
        onPress={onRemove}
        // 24 plus 12 a side: a 48dp target over the chip's corner.
        hitSlop={12}
        style={({ pressed }) => ({
          position: "absolute",
          top: 0,
          right: 0,
          width: 24,
          height: 24,
          borderRadius: RADIUS,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: theme.lineStrong,
          backgroundColor: pressed ? theme.ply4 : theme.ply3,
        })}
      >
        <Icon icon={X} size={12} />
      </Pressable>
    </View>
  );
}

/** One line over the chips: a limit hit (idle) or an upload refused (danger). */
export function NoticeLine({ notice }: { notice: Notice }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 4,
      }}
    >
      <Led state={notice.led} size={6} />
      <Text variant="row" tone="ink2" style={{ flex: 1, fontSize: 13 }}>
        {notice.text}
      </Text>
    </View>
  );
}

interface AttachmentChipsProps {
  items: readonly DraftItem[];
  sending: boolean;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}

/**
 * The files riding on the next message, above the field: thumbnails for
 * pictures and videos, name and size for anything else. Each shows its
 * upload as it goes; a failed one turns into a retry key.
 */
export function AttachmentChips({
  items,
  sending,
  onRemove,
  onRetry,
}: AttachmentChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 2 }}
    >
      {items.map((item) => (
        <Chip
          key={item.key}
          item={item}
          sending={sending}
          onRemove={() => onRemove(item.key)}
          onRetry={() => onRetry(item.key)}
        />
      ))}
    </ScrollView>
  );
}
