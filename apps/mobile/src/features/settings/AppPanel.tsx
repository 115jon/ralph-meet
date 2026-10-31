import Constants from "expo-constants";
import { View } from "react-native";

import { config } from "@/lib/config";
import { THEME_IDS, THEME_LABELS, useThemeOverride } from "@/theme";
import { Text } from "@/ui";

import { ChoiceRow, Row, Section } from "./rows";

function ThemeSection() {
  const { override, setOverride } = useThemeOverride();
  const options = [null, ...THEME_IDS] as const;
  return (
    <Section title="Theme">
      <View accessibilityRole="radiogroup">
        {options.map((id) => (
          <ChoiceRow
            key={id ?? "system"}
            label={id ? THEME_LABELS[id] : "Follow system"}
            selected={override === id}
            onPress={() => setOverride(id)}
          />
        ))}
      </View>
    </Section>
  );
}

function AboutSection() {
  const app = Constants.expoConfig;
  return (
    <Section title="About">
      <Row
        label="Version"
        description={app?.name}
        trailing={
          <Text variant="num" tone="ink2">
            {app?.version ?? "Unknown"}
          </Text>
        }
      />
      <Row
        label="Server"
        trailing={
          <Text variant="num" tone="ink2" numberOfLines={1}>
            {config.apiBaseUrl.replace(/^https?:\/\//, "")}
          </Text>
        }
      />
    </Section>
  );
}

/** 03 App: how the app looks, and which build this is. */
export function AppPanel() {
  return (
    <View style={{ gap: 24 }}>
      <ThemeSection />
      <AboutSection />
    </View>
  );
}
