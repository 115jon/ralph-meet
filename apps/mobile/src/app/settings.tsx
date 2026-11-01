import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppPanel } from "@/features/settings/AppPanel";
import { CallsPanel } from "@/features/settings/CallsPanel";
import { YouPanel } from "@/features/settings/YouPanel";
import { FONT, useTheme } from "@/theme";
import { Header, Screen, Text } from "@/ui";

// The Studio settings on a phone: three index tabs, 01 You, 02 Calls, 03 App.

const TABS = [
  { id: "you", number: "01", label: "You" },
  { id: "calls", number: "02", label: "Calls" },
  { id: "app", number: "03", label: "App" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * C2 index tabs: equal cells on a 2px rule, a silkscreen number over a 17px
 * Bricolage label; the chosen cell's rule and label are ink-1, its number
 * accent.
 */
function IndexTabs({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: "row", paddingHorizontal: 16, paddingTop: 8 }}
    >
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.id)}
            style={{
              flex: 1,
              paddingTop: 8,
              paddingBottom: 10,
              gap: 2,
              borderBottomWidth: 2,
              borderBottomColor: selected ? theme.ink1 : theme.line,
            }}
          >
            <Text
              variant="silk"
              tone={selected ? "accent" : "ink3"}
              numberOfLines={1}
            >
              {tab.number}
            </Text>
            <Text
              tone={selected ? "ink1" : "ink3"}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              style={{ fontFamily: FONT.name, fontSize: 17, lineHeight: 22 }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Studio settings, opened from the panel's gear or the profile sheet. */
export default function SettingsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("you");
  return (
    <Screen>
      <Header title="Settings" onBack={() => router.back()} />
      <IndexTabs active={tab} onChange={setTab} />
      <View style={{ paddingHorizontal: 4, paddingVertical: 20 }}>
        {tab === "you" ? <YouPanel /> : null}
        {tab === "calls" ? <CallsPanel /> : null}
        {tab === "app" ? <AppPanel /> : null}
      </View>
    </Screen>
  );
}
