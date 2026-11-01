import { useEffect, useState } from "react";
import { AppState, Pressable, View } from "react-native";

import {
  setCallPreference,
  SPEAKING_THRESHOLD_DB,
  useCallPreferences,
} from "@/features/preferences/call-preferences";
import { RADIUS, useTheme } from "@/theme";
import { Fader, Led, Text } from "@/ui";

import * as RalphCall from "../../../modules/ralph-call/src";
import { ChoiceRow, Row, Section, ToggleRow } from "./rows";

const formatDb = (value: number) => `${value} dB`;

/** Whether calls may show over the lock screen; re-read on return from settings. */
function useLockScreenCalls(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!RalphCall.isAvailable) return;
    const read = () => void RalphCall.canUseFullScreenIntent().then(setAllowed);
    read();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") read();
    });
    return () => appState.remove();
  }, []);
  return allowed;
}

/** Ringing over the lock screen: on, or a key to the system page that allows it. */
function LockScreenRow() {
  const theme = useTheme();
  const allowed = useLockScreenCalls();
  if (allowed === null) return null;
  return (
    <Row
      leading={<Led state={allowed ? "talk" : "idle"} />}
      label="Ring on the lock screen"
      description={
        allowed
          ? "A call wakes your phone and shows over the lock screen."
          : "Off: calls only show as a notification. Allow full-screen notifications to turn it on."
      }
      trailing={
        allowed ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Allow in system settings"
            onPress={() => void RalphCall.openFullScreenIntentSettings()}
            style={({ pressed }) => ({
              height: 36,
              paddingHorizontal: 12,
              borderRadius: RADIUS,
              justifyContent: "center",
              backgroundColor: pressed ? theme.tint3 : theme.tint1,
            })}
          >
            <Text variant="control">Allow</Text>
          </Pressable>
        )
      }
    />
  );
}

/** 02 Calls: how you sound and where calls play, on this device. */
export function CallsPanel() {
  const {
    speakingThresholdDb,
    joinMuted,
    audioRoute,
    skipCallConfirm,
    joinLeaveTones,
  } = useCallPreferences();
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
      <Section title="Direct calls">
        <ToggleRow
          label="Ask before calling"
          description="Confirm before a call rings every device they're signed in on."
          value={!skipCallConfirm}
          onValueChange={(value) =>
            setCallPreference("skipCallConfirm", !value)
          }
        />
        <LockScreenRow />
      </Section>
      <Section title="Joining">
        <ToggleRow
          label="Join muted"
          description="Your microphone starts off when you join a voice channel."
          value={joinMuted}
          onValueChange={(value) => setCallPreference("joinMuted", value)}
        />
        <ToggleRow
          label="Join and leave tones"
          description="A short tone when someone joins or leaves your call."
          value={joinLeaveTones}
          onValueChange={(value) => setCallPreference("joinLeaveTones", value)}
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
