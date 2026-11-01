import Constants from "expo-constants";
import { Linking, View } from "react-native";

import { useNotificationPermission } from "@/features/push/use-notification-permission";
import { config } from "@/lib/config";
import { THEME_IDS, THEME_LABELS, useThemeOverride } from "@/theme";
import { Button, Led, Text } from "@/ui";

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

function NotificationsSection() {
  const granted = useNotificationPermission();
  if (granted === null) return null;
  return (
    <Section title="Notifications">
      <Row
        leading={<Led state={granted ? "talk" : "off"} />}
        label={granted ? "On" : "Off"}
        description={
          granted
            ? "Direct messages, mentions and replies reach this phone."
            : "Turn notifications on in system settings to get messages here."
        }
      />
      <View style={{ paddingHorizontal: 12, paddingTop: 4 }}>
        <Button
          variant="ghost"
          label="Open system settings"
          onPress={() => void Linking.openSettings()}
        />
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

/** 03 App: how the app looks, notifications, and which build this is. */
export function AppPanel() {
  return (
    <View style={{ gap: 24 }}>
      <ThemeSection />
      <NotificationsSection />
      <AboutSection />
    </View>
  );
}
