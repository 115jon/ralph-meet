import { useState } from "react";
import { Pressable, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { AppPanel } from "@/features/settings/AppPanel";
import { CallsPanel } from "@/features/settings/CallsPanel";
import { YouPanel } from "@/features/settings/YouPanel";
import { mediaUrl } from "@/lib/api";
import { FONT, useTheme } from "@/theme";
import { Avatar, Header, Screen, Text } from "@/ui";

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
      style={{ flexDirection: "row", paddingHorizontal: 16 }}
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
            <Text variant="silk" tone={selected ? "accent" : "ink3"}>
              {tab.number}
            </Text>
            <Text
              tone={selected ? "ink1" : "ink3"}
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

function ProfileHeader() {
  const user = useSession((s) => s.user);
  const name = user?.display_name ?? user?.username ?? "You";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 16,
      }}
    >
      <Avatar name={name} size={56} uri={mediaUrl(user?.avatar_url)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="title" numberOfLines={1}>
          {name}
        </Text>
        {user ? (
          <Text variant="row" tone="ink3" numberOfLines={1}>
            @{user.username}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function YouScreen() {
  const [tab, setTab] = useState<TabId>("you");
  return (
    <Screen>
      <Header title="You" />
      <ProfileHeader />
      <IndexTabs active={tab} onChange={setTab} />
      <View style={{ paddingHorizontal: 4, paddingVertical: 20 }}>
        {tab === "you" ? <YouPanel /> : null}
        {tab === "calls" ? <CallsPanel /> : null}
        {tab === "app" ? <AppPanel /> : null}
      </View>
    </Screen>
  );
}
