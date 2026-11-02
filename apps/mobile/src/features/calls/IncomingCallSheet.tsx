import { Phone, PhoneX } from "phosphor-react-native";
import { type ComponentRef, type Ref, useEffect, useRef } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";

import { useVoiceStore } from "@/features/voice/store";
import { mediaUrl } from "@/lib/api";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, Led, Sheet, Text } from "@/ui";

import { answerRing, declineRing } from "./actions";
import { RingPulse } from "./RingPulse";
import { useIncomingRing, type IncomingRing } from "./store";

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

  return (
    <View style={{ paddingHorizontal: 16, gap: 16 }}>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
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
    </View>
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
    <Sheet
      visible={ring !== null}
      onClose={() => {
        if (ring) declineRing(ring);
      }}
      label={ring ? `Incoming call from ${ring.caller.name}` : "Incoming call"}
      scrimCloses={false}
    >
      {ring ? <RingSheet key={ring.callId} ring={ring} /> : null}
    </Sheet>
  );
}
