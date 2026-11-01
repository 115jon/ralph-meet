import {
  Images,
  Paperclip,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  BackHandler,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { SHEET_TOP_RADIUS, useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

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

/** Resting height: a little under half the screen, like the keyboard. */
const REST = 0.45;
/** Dragged up: most of the screen, leaving the header and some history. */
const EXPANDED = 0.72;
const ENTER = { duration: 250, easing: Easing.out(Easing.cubic) };
const EXIT = { duration: 175, easing: Easing.out(Easing.cubic) };
const SETTLE = { duration: 200, easing: Easing.inOut(Easing.cubic) };
/** A flick faster than this (px/s) decides the drag on its own. */
const FLING = 900;

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
 * The attach tray: a ply-3 panel that rises under the composer while the
 * keyboard steps aside. Camera first, then recent media to pick several at
 * once, and Photos and Files for anything older. The composer stays on top
 * of it (ChatView pads the conversation by `lift`); drag the top strip down
 * to close or up to see more. Back closes it.
 */
export function AttachTray({ attach }: { attach: AttachController }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height: screen } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const { trayOpen: open, closeTray, lift } = attach;
  // Built on first open, then kept, so reopening is instant.
  const [built, setBuilt] = useState(open);
  if (open && !built) setBuilt(true);
  const media = useRecentMedia(open);

  const rest = Math.round(screen * REST);
  const expanded = Math.round(screen * EXPANDED);
  const height = useSharedValue(rest);
  const progress = useSharedValue(0);
  const dragFrom = useSharedValue(0);

  useEffect(() => {
    const motion = reducedMotion ? { duration: 0 } : open ? ENTER : EXIT;
    if (open) height.set(rest);
    progress.set(withTiming(open ? 1 : 0, motion));
  }, [open, reducedMotion, rest, height, progress]);

  useAnimatedReaction(
    () => height.get() * progress.get(),
    (shown) => {
      lift.set(shown);
    },
  );

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeTray();
      return true;
    });
    return () => sub.remove();
  }, [open, closeTray]);

  const drag = usePanGesture({
    onActivate: () => {
      "worklet";
      dragFrom.set(height.get() * progress.get());
    },
    onUpdate: (event) => {
      "worklet";
      const next = dragFrom.get() - event.translationY;
      if (next >= rest) {
        height.set(Math.min(expanded, next));
        progress.set(1);
      } else {
        height.set(rest);
        progress.set(Math.max(0, next / rest));
      }
    },
    onDeactivate: (event) => {
      "worklet";
      const motion = reducedMotion ? { duration: 0 } : SETTLE;
      const shown = height.get() * progress.get();
      if (event.velocityY > FLING || shown < rest * 0.6) {
        progress.set(withTiming(0, reducedMotion ? motion : EXIT));
        scheduleOnRN(closeTray);
        return;
      }
      progress.set(withTiming(1, motion));
      const up =
        event.velocityY < -FLING ||
        (event.velocityY <= FLING && height.get() > (rest + expanded) / 2);
      height.set(withTiming(up ? expanded : rest, motion));
    },
  });

  const panelStyle = useAnimatedStyle(() => ({
    height: height.get(),
    // Parked below the screen, its shadow would still rim the bottom edge.
    opacity: progress.get() > 0 ? 1 : 0,
    transform: [{ translateY: height.get() * (1 - progress.get()) }],
  }));

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

  if (!built) return null;

  return (
    <Animated.View
      accessibilityLabel="Attach files"
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      pointerEvents={open ? "auto" : "none"}
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: theme.ply3,
          borderTopWidth: 2,
          borderTopColor: theme.ink1,
          borderTopLeftRadius: SHEET_TOP_RADIUS,
          borderTopRightRadius: SHEET_TOP_RADIUS,
          shadowColor: theme.shadow,
          shadowOffset: { width: 0, height: -12 },
          shadowOpacity: 1,
          shadowRadius: 32,
          elevation: 24,
        },
        panelStyle,
      ]}
    >
      <GestureDetector gesture={drag}>
        <View style={{ paddingTop: 10, paddingHorizontal: 12 }}>
          <View
            style={{
              width: 32,
              height: 3,
              borderRadius: 2,
              alignSelf: "center",
              backgroundColor: theme.lineStrong,
            }}
          />
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
      </GestureDetector>
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
    </Animated.View>
  );
}
