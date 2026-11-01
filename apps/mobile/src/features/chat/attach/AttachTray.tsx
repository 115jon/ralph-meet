import {
  Images,
  Paperclip,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { useCallback } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

import { SlotGrabber, SlotHandle } from "../slot/SlotPanel";
import { MAX_FILES } from "./limits";
import { MediaGrid } from "./MediaGrid";
import {
  canCapture,
  canPickFiles,
  canPickPhotos,
  capture,
  pickFiles,
  pickPhotos,
} from "./sources";
import type { AttachController } from "./useAttach";
import { useRecentMedia } from "./useRecentMedia";

function ActionKey({
  icon,
  label,
  onPress,
}: {
  icon: PhosphorIcon;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 64,
        gap: 4,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Icon icon={icon} size={24} color={theme.ink1} />
      <Text variant="control" style={{ fontSize: 13, lineHeight: 16 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The attach tray, in the composer's slot (SlotPanel): camera first, then
 * recent media to pick several at once, and Photos and Files for anything
 * older. Drag the top strip down to close or up to see more.
 */
export function AttachTray({
  attach,
  open,
}: {
  attach: AttachController;
  /** On screen: recent media loads only then. */
  open: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const media = useRecentMedia(open);

  const remaining = MAX_FILES - attach.items.length;
  const { add, warn } = attach;
  const sayFull = useCallback(
    () => warn(`Up to ${MAX_FILES} files per message`),
    [warn],
  );

  const takePhoto = useCallback(async () => {
    if (remaining <= 0) return sayFull();
    const taken = await capture();
    if (taken === "denied") warn("Camera access is off. Allow it in Settings.");
    else add(taken);
  }, [add, remaining, sayFull, warn]);

  const openPhotos = useCallback(async () => {
    if (remaining <= 0) return sayFull();
    add(await pickPhotos(remaining));
  }, [add, remaining, sayFull]);

  const openFiles = useCallback(async () => {
    if (remaining <= 0) return sayFull();
    add(await pickFiles());
  }, [add, remaining, sayFull]);

  return (
    <View accessibilityLabel="Attach files" style={{ flex: 1 }}>
      <SlotHandle>
        <View style={{ paddingTop: 10, paddingHorizontal: 12 }}>
          <SlotGrabber />
          <View
            style={{
              height: 28,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text variant="silk" tone="ink3">
              Recent
            </Text>
            {attach.items.length > 0 ? (
              <Text
                variant="num"
                tone="ink2"
                accessibilityLabel={`${attach.items.length} of ${MAX_FILES} selected`}
              >
                {attach.items.length}/{MAX_FILES}
              </Text>
            ) : null}
          </View>
        </View>
      </SlotHandle>
      <View style={{ flex: 1 }}>
        <MediaGrid
          width={width}
          access={media.access}
          assets={media.assets}
          items={attach.items}
          canCapture={canCapture}
          onCapture={() => void takePhoto()}
          onToggle={attach.toggle}
          onFull={sayFull}
          onLoadMore={media.loadMore}
          onRequestAccess={() => void media.request()}
          onShareMore={() => void media.shareMore()}
        />
      </View>
      {canPickPhotos || canPickFiles ? (
        <View
          style={{
            flexDirection: "row",
            paddingHorizontal: 8,
            paddingBottom: insets.bottom,
            borderTopWidth: 1,
            borderTopColor: theme.line,
            backgroundColor: theme.ply3,
          }}
        >
          {canPickPhotos ? (
            <ActionKey
              icon={Images}
              label="Photos"
              onPress={() => void openPhotos()}
            />
          ) : null}
          {canPickFiles ? (
            <ActionKey
              icon={Paperclip}
              label="Files"
              onPress={() => void openFiles()}
            />
          ) : null}
        </View>
      ) : (
        <View style={{ height: insets.bottom }} />
      )}
    </View>
  );
}
