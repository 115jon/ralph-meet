import { useRouter } from "expo-router";
import {
  Headphones,
  Microphone,
  MicrophoneSlash,
  PhoneX,
  SpeakerSlash,
} from "phosphor-react-native";
import { Pressable, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut } from "react-native-reanimated";

import { leaveCall, toggleDeafen, toggleMute } from "@/features/voice/actions";
import { useTheme } from "@/theme";
import { Led, Text } from "@/ui";

import type { CallRowState } from "./call-row";
import { PanelKey } from "./PanelKey";

const ENTER_MS = 200;

/**
 * The panel's call row, above you while in a call: LED and status, where
 * the call is, then Mute, Deafen and Leave. Tapping the text opens the call.
 */
export function CallRow({ call }: { call: CallRowState }) {
  const theme = useTheme();
  const router = useRouter();
  const live = call.led === "talk";
  const status =
    live && call.count > 0
      ? `${call.label} · ${call.count} in call`
      : call.label;
  return (
    <Animated.View
      // Opacity only: the plate's own layout transition moves its edge.
      entering={FadeIn.duration(ENTER_MS).easing(Easing.out(Easing.cubic))}
      exiting={FadeOut.duration(150)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 10,
        paddingLeft: 12,
        paddingRight: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.lineStrong,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${call.place}, ${status}. Open the call`}
        onPress={() => router.push("/call")}
        style={{
          flex: 1,
          minWidth: 0,
          gap: 2,
          alignSelf: "stretch",
          justifyContent: "center",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Led state={call.led} />
          <Text
            variant="silk"
            numberOfLines={1}
            style={{ flexShrink: 1, color: live ? theme.talk : theme.ink2 }}
          >
            {status}
          </Text>
        </View>
        {/* Channel and server names are user content: never silkscreen. */}
        <Text
          variant="name"
          numberOfLines={1}
          style={{ fontSize: 14, lineHeight: 19 }}
        >
          {call.place}
        </Text>
      </Pressable>
      <PanelKey
        icon={call.muted ? MicrophoneSlash : Microphone}
        label={call.muted ? "Unmute" : "Mute"}
        tone={call.muted ? "off" : "rest"}
        selected={call.muted}
        onPress={toggleMute}
      />
      <PanelKey
        icon={call.deafened ? SpeakerSlash : Headphones}
        label={call.deafened ? "Undeafen" : "Deafen"}
        tone={call.deafened ? "off" : "rest"}
        selected={call.deafened}
        onPress={toggleDeafen}
      />
      <PanelKey
        icon={PhoneX}
        label="Leave the call"
        tone="danger"
        onPress={leaveCall}
      />
    </Animated.View>
  );
}
