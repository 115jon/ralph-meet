import { Hash, SpeakerHigh } from "phosphor-react-native";
import type { Icon as PhosphorIcon } from "phosphor-react-native";
import { Pressable, ScrollView, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";
import { Header, Icon, Led, Screen, Text } from "@/ui";

const SERVERS = ["R", "K", "D", "M", "T"];

interface Channel {
  name: string;
  icon: PhosphorIcon;
  occupants?: number;
}

const BRANCHES: { label: string; channels: Channel[] }[] = [
  {
    label: "Voice",
    channels: [
      { name: "Standup", icon: SpeakerHigh, occupants: 3 },
      { name: "Pairing", icon: SpeakerHigh },
    ],
  },
  {
    label: "Text",
    channels: [
      { name: "general", icon: Hash },
      { name: "shipping", icon: Hash },
    ],
  },
];

function ServerStrip() {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ padding: 12, gap: 8 }}
      style={{ flexGrow: 0 }}
    >
      {SERVERS.map((initial, index) => {
        const active = index === 0;
        return (
          <Pressable
            key={initial}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              width: 48,
              height: 48,
              borderRadius: RADIUS,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: active ? theme.ply4 : theme.ply2,
              borderWidth: 1,
              borderColor: active ? theme.lineStrong : theme.line,
            }}
          >
            {active ? (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  backgroundColor: theme.accentInk,
                }}
              />
            ) : null}
            <Text variant="name">{initial}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ChannelRow({ channel }: { channel: Channel }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => ({
        height: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        borderRadius: RADIUS,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Icon icon={channel.icon} size={20} color={theme.ink2} />
      <Text variant="row" tone="ink1" style={{ flex: 1 }}>
        {channel.name}
      </Text>
      {channel.occupants ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Led state="talk" />
          <Text variant="num" tone="ink2">
            {channel.occupants}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function ServersScreen() {
  const theme = useTheme();
  return (
    <Screen>
      <Header title="Ralph HQ" />
      <ServerStrip />
      <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
        {BRANCHES.map((branch) => (
          <View key={branch.label}>
            <View
              style={{
                height: 24,
                justifyContent: "center",
                paddingHorizontal: 12,
              }}
            >
              <Text variant="silk" tone="ink3">
                {branch.label}
              </Text>
            </View>
            <View
              style={{
                marginLeft: 12,
                paddingLeft: 4,
                borderLeftWidth: 1,
                borderLeftColor: theme.guide,
                marginBottom: 12,
              }}
            >
              {branch.channels.map((channel) => (
                <ChannelRow key={channel.name} channel={channel} />
              ))}
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}
