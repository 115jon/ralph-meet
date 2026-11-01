import { Phone, PhoneX } from "phosphor-react-native";
import { type ComponentRef, type Ref, useEffect, useRef } from "react";
import { AccessibilityInfo, Modal, Pressable, View } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { useVoiceStore } from "@/features/voice/store";
import { mediaUrl } from "@/lib/api";
import { RADIUS, SHEET_TOP_RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, Led, Text } from "@/ui";

import { answerRing, declineRing } from "./actions";
import { RingPulse } from "./RingPulse";
import { useIncomingRing, type IncomingRing } from "./store";

/** Dragged this far down (or flung), the sheet declines. */
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 900;

function RingKey({
  label,
  icon,
  tone,
  onPress,
  focused = false,
  keyRef,
}: {
  label: string;
  icon: typeof Phone;
  tone: "danger" | "talk";
  onPress: () => void;
  /** The key the sheet leads with: a 2px ink ring, like the web's focus. */
  focused?: boolean;
  keyRef?: Ref<ComponentRef<typeof Pressable>>;
}) {
  const theme = useTheme();
  const fill = tone === "danger" ? theme.dangerFill : theme.talk;
  const ink = tone === "danger" ? theme.onDanger : theme.onTalk;
  return (
    <View
      style={{
        flex: 1,
        padding: 2,
        borderRadius: RADIUS + 2,
        borderWidth: 2,
        borderColor: focused ? theme.ink1 : "transparent",
      }}
    >
      <Pressable
        ref={keyRef}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({
          height: 52,
          borderRadius: RADIUS,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          backgroundColor: fill,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Icon icon={icon} active size={20} color={ink} />
        <Text variant="control" style={{ color: ink }}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

function RingSheet({ ring }: { ring: IncomingRing }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const offset = useSharedValue(0);
  const answerKey = useRef<ComponentRef<typeof Pressable>>(null);
  // Answering swaps calls without asking; the sheet says what you'd leave.
  const leaving = useVoiceStore((s) =>
    s.call && s.call.channelId !== ring.channelId ? s.call.channelName : null,
  );
  const decline = () => declineRing(ring);

  // Screen readers land on Answer, the key the sheet leads with.
  useEffect(() => {
    if (answerKey.current) {
      AccessibilityInfo.sendAccessibilityEvent(answerKey.current, "focus");
    }
  }, []);

  const drag = usePanGesture({
    activeOffsetY: 8,
    onUpdate: (event) => {
      "worklet";
      offset.set(Math.max(0, event.translationY));
    },
    onDeactivate: (event) => {
      "worklet";
      if (
        event.translationY > DISMISS_DISTANCE ||
        event.velocityY > DISMISS_VELOCITY
      ) {
        offset.set(withTiming(400, { duration: 160 }));
        scheduleOnRN(declineRing, ring);
      } else {
        offset.set(
          withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }),
        );
      }
    },
  });
  const follow = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.get() }],
  }));

  return (
    <GestureHandlerRootView style={{ flex: 1, justifyContent: "flex-end" }}>
      {/* The chat stays visible behind the scrim; tapping it does nothing:
          a ring is answered or declined, not dismissed by accident. */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: theme.scrim,
        }}
      />
      <GestureDetector gesture={drag}>
        <Animated.View
          entering={SlideInDown.duration(250).easing(Easing.out(Easing.cubic))}
          accessibilityViewIsModal
          accessibilityLabel={`Incoming call from ${ring.caller.name}`}
          style={[
            {
              paddingTop: 10,
              paddingHorizontal: 16,
              paddingBottom: insets.bottom + 12,
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
              gap: 16,
            },
            follow,
          ]}
        >
          <View
            style={{
              width: 32,
              height: 3,
              borderRadius: 2,
              alignSelf: "center",
              backgroundColor: theme.lineStrong,
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <RingPulse size={56} ringing>
              <Avatar
                name={ring.caller.name}
                uri={mediaUrl(ring.caller.avatarUrl)}
                size={56}
              />
            </RingPulse>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text
                variant="title"
                numberOfLines={1}
                accessibilityRole="header"
                style={{ fontSize: 22, lineHeight: 26 }}
              >
                {ring.caller.name}
              </Text>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Led state="idle" />
                <Text variant="silk" tone="ink2">
                  Incoming voice call
                </Text>
              </View>
            </View>
          </View>
          {leaving ? (
            <Text variant="row" tone="ink3">
              {`You'll leave ${leaving}.`}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <RingKey
              label="Decline"
              icon={PhoneX}
              tone="danger"
              onPress={decline}
            />
            <RingKey
              label="Answer"
              icon={Phone}
              tone="talk"
              focused
              keyRef={answerKey}
              onPress={() => answerRing(ring)}
            />
          </View>
          <Text
            variant="silk"
            tone="ink3"
            style={{ alignSelf: "center" }}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            Swipe down to decline
          </Text>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

/**
 * The in-app ring while Ralph is in front: a bottom sheet over the scrim,
 * Answer focused, Back or a swipe down declines (the web's IncomingCallModal
 * and its Escape). Off screen, ralph-call shows the call instead.
 */
export function IncomingCallSheet() {
  const ring = useIncomingRing();
  return (
    <Modal
      visible={ring !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (ring) declineRing(ring);
      }}
    >
      {ring ? <RingSheet key={ring.callId} ring={ring} /> : null}
    </Modal>
  );
}
