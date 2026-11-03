import { CaretRight, ImagesSquare } from "phosphor-react-native";
import { useCallback, useMemo } from "react";
import { FlatList, Pressable, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";
import { Button, Icon, Text } from "@/ui";

import { MAX_FILES } from "./limits";
import { CameraTile, MediaTile } from "./MediaTile";
import type { DraftItem, PickedFile } from "./types";
import type { MediaAccess } from "./useRecentMedia";

export const GRID_COLUMNS = 4;
export const GRID_GAP = 4;
export const GRID_PADDING = 8;

const CAMERA = "camera" as const;
type Cell = typeof CAMERA | PickedFile;

interface MediaGridProps {
  width: number;
  access: MediaAccess;
  assets: readonly PickedFile[];
  items: readonly DraftItem[];
  canCapture: boolean;
  onCapture: () => void;
  onToggle: (asset: PickedFile) => void;
  onFull: () => void;
  onLoadMore: () => void;
  onRequestAccess: () => void;
  onShareMore: () => void;
}

/** Android 14+ "Select photos": a quiet row to share more. */
function ShareMoreRow({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: pressed ? theme.tint2 : theme.tint1,
      })}
    >
      <Icon icon={ImagesSquare} size={18} color={theme.ink2} />
      <Text variant="row" style={{ flex: 1 }} numberOfLines={1}>
        Allow access to more photos
      </Text>
      <Icon icon={CaretRight} size={14} color={theme.ink3} />
    </Pressable>
  );
}

/** No gallery access: say why the grid is empty and how to fill it. */
function AccessState({
  access,
  onRequest,
}: {
  access: MediaAccess;
  onRequest: () => void;
}) {
  const theme = useTheme();
  if (access === "unavailable") {
    return (
      <Text variant="row" tone="ink3" style={{ padding: 12 }}>
        Update the app to see recent photos here.
      </Text>
    );
  }
  if (access !== "denied" && access !== "blocked") return null;
  return (
    <View
      style={{
        marginTop: 8,
        padding: 16,
        gap: 6,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: theme.ply2,
      }}
    >
      <Icon icon={ImagesSquare} size={22} color={theme.ink2} />
      <Text variant="name" style={{ marginTop: 4 }}>
        Show your recent photos here
      </Text>
      <Text variant="row" tone="ink2">
        Yap only sees the photos you allow. Camera, Photos and Files work either
        way.
      </Text>
      <View style={{ marginTop: 8, alignSelf: "flex-start" }}>
        <Button
          variant="ghost"
          label={access === "blocked" ? "Open settings" : "Allow access"}
          onPress={onRequest}
        />
      </View>
    </View>
  );
}

/**
 * The tray's grid: the camera tile, then the newest photos and videos four
 * across, paged in as it scrolls. Each tile's mark shows its place among
 * the chips over the composer.
 */
export function MediaGrid({
  width,
  access,
  assets,
  items,
  canCapture,
  onCapture,
  onToggle,
  onFull,
  onLoadMore,
  onRequestAccess,
  onShareMore,
}: MediaGridProps) {
  const tile = Math.floor(
    (width - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS,
  );
  const readable = access === "all" || access === "limited";
  const cells = useMemo<readonly Cell[]>(
    () => [...(canCapture ? [CAMERA] : []), ...(readable ? assets : [])],
    [assets, canCapture, readable],
  );
  const order = useMemo(
    () => new Map(items.map((item, index) => [item.key, index + 1])),
    [items],
  );
  const full = items.length >= MAX_FILES;

  const press = useCallback(
    (asset: PickedFile) => {
      if (full && !order.has(asset.key)) onFull();
      else onToggle(asset);
    },
    [full, onFull, onToggle, order],
  );

  return (
    <FlatList
      data={cells}
      keyExtractor={(cell) => (cell === CAMERA ? CAMERA : cell.key)}
      numColumns={GRID_COLUMNS}
      extraData={order}
      contentContainerStyle={{ padding: GRID_PADDING, gap: GRID_GAP }}
      columnWrapperStyle={{ gap: GRID_GAP }}
      ListHeaderComponent={
        access === "limited" ? (
          <ShareMoreRow onPress={onShareMore} />
        ) : undefined
      }
      ListFooterComponent={
        <AccessState access={access} onRequest={onRequestAccess} />
      }
      renderItem={({ item }) =>
        item === CAMERA ? (
          <CameraTile size={tile} onPress={onCapture} />
        ) : (
          <MediaTile
            asset={item}
            size={tile}
            order={order.get(item.key) ?? null}
            full={full}
            onPress={press}
          />
        )
      }
      onEndReached={onLoadMore}
      onEndReachedThreshold={1.5}
      initialNumToRender={GRID_COLUMNS * 6}
      maxToRenderPerBatch={GRID_COLUMNS * 4}
      windowSize={7}
      removeClippedSubviews
      showsVerticalScrollIndicator={false}
    />
  );
}
