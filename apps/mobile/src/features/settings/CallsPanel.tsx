import { View } from "react-native";

import {
  setCallPreference,
  SPEAKING_THRESHOLD_DB,
  useCallPreferences,
} from "@/features/preferences/call-preferences";
import { Fader } from "@/ui";

import { ChoiceRow, Section, ToggleRow } from "./rows";

const formatDb = (value: number) => `${value} dB`;

/** 02 Calls: how you sound and where calls play, on this device. */
export function CallsPanel() {
  const { speakingThresholdDb, joinMuted, audioRoute } = useCallPreferences();
  return (
    <View style={{ gap: 24 }}>
      <Section
        title="Input sensitivity"
        note="How loud you speak before your LED lights for everyone. Lower picks up quieter voices."
      >
        <View style={{ paddingHorizontal: 12 }}>
          <Fader
            value={speakingThresholdDb}
            min={SPEAKING_THRESHOLD_DB.min}
            max={SPEAKING_THRESHOLD_DB.max}
            onCommit={(value) =>
              setCallPreference("speakingThresholdDb", value)
            }
            format={formatDb}
            accessibilityLabel="Input sensitivity"
          />
        </View>
      </Section>
      <Section title="Joining">
        <ToggleRow
          label="Join muted"
          description="Your microphone starts off when you join a voice channel."
          value={joinMuted}
          onValueChange={(value) => setCallPreference("joinMuted", value)}
        />
      </Section>
      <Section
        title="Audio output"
        note="Where calls start when no headset is connected. Applies from your next call."
      >
        <View accessibilityRole="radiogroup">
          <ChoiceRow
            label="Speaker"
            selected={audioRoute === "speaker"}
            onPress={() => setCallPreference("audioRoute", "speaker")}
          />
          <ChoiceRow
            label="Phone"
            description="The earpiece, held to your ear."
            selected={audioRoute === "earpiece"}
            onPress={() => setCallPreference("audioRoute", "earpiece")}
          />
        </View>
      </Section>
    </View>
  );
}
