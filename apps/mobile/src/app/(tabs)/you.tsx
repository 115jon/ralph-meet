import { useState } from "react";
import { Pressable, View } from "react-native";

import {
  useCallSegment,
  useCallSegmentActions,
} from "@/features/app-bar/call-segment";
import {
  RADIUS,
  THEME_IDS,
  THEME_LABELS,
  useTheme,
  useThemeOverride,
} from "@/theme";
import { Avatar, Button, Header, Led, Screen, Text } from "@/ui";

const TABS = ["01 You", "02 Calls", "03 App"] as const;
type TabId = (typeof TABS)[number];

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
      style={{
        flexDirection: "row",
        borderBottomWidth: 1,
        borderBottomColor: theme.line,
      }}
    >
      {TABS.map((tab) => {
        const selected = tab === active;
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab)}
            style={{
              height: 40,
              paddingHorizontal: 16,
              justifyContent: "center",
              borderBottomWidth: 2,
              borderBottomColor: selected ? theme.accentInk : "transparent",
            }}
          >
            <Text variant="silk" tone={selected ? "ink1" : "ink3"}>
              {tab}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ThemePicker() {
  const theme = useTheme();
  const { override, setOverride } = useThemeOverride();
  const options = [null, ...THEME_IDS] as const;
  return (
    <View style={{ gap: 4 }}>
      <Text variant="silk" tone="ink3" style={{ marginBottom: 4 }}>
        Theme
      </Text>
      {options.map((id) => {
        const selected = override === id;
        return (
          <Pressable
            key={id ?? "system"}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => setOverride(id)}
            style={({ pressed }) => ({
              height: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 12,
              borderRadius: RADIUS,
              backgroundColor:
                selected || pressed ? theme.tint2 : "transparent",
            })}
          >
            <Led state={selected ? "talk" : "off"} />
            <Text variant="row">{id ? THEME_LABELS[id] : "Follow system"}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DevCallToggle() {
  const call = useCallSegment();
  const { setCall } = useCallSegmentActions();
  return (
    <Button
      variant="ghost"
      label={call ? "End fake call" : "Fake a call"}
      onPress={() =>
        setCall(
          call
            ? null
            : { channel: "Standup", status: "3 in the room", muted: false },
        )
      }
    />
  );
}

export default function YouScreen() {
  const [tab, setTab] = useState<TabId>("01 You");
  return (
    <Screen>
      <Header title="You" />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 16,
        }}
      >
        <Avatar name="Jon" size={56} presence="talk" />
        <View>
          <Text variant="title">Jon</Text>
          <Text variant="silk" tone="ink3">
            Online
          </Text>
        </View>
      </View>
      <IndexTabs active={tab} onChange={setTab} />
      <View style={{ padding: 16, gap: 16 }}>
        {tab === "01 You" ? <ThemePicker /> : null}
        {tab === "02 Calls" ? (
          <Text variant="body" tone="ink2">
            Call history lands with the voice release.
          </Text>
        ) : null}
        {tab === "03 App" ? (
          <>
            <Text variant="body" tone="ink2">
              Developer
            </Text>
            <DevCallToggle />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
