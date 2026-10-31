import { Pressable, View } from "react-native";

import { useTheme } from "@/theme";
import { Avatar, CountChip, Header, Screen, Text, type LedState } from "@/ui";

interface Thread {
  name: string;
  preview: string;
  unread: number;
  presence: LedState;
}

const THREADS: Thread[] = [
  {
    name: "Mara",
    preview: "Pushed the voice fix, can you look?",
    unread: 2,
    presence: "talk",
  },
  {
    name: "Kenji",
    preview: "Standup moved to 10:30",
    unread: 1,
    presence: "idle",
  },
  { name: "Ines", preview: "Thanks!", unread: 0, presence: "off" },
];

export default function DmsScreen() {
  const theme = useTheme();
  return (
    <Screen>
      <Header title="Messages" />
      {THREADS.map((thread) => (
        <Pressable
          key={thread.name}
          accessibilityRole="button"
          style={({ pressed }) => ({
            height: 64,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            backgroundColor: pressed ? theme.tint2 : "transparent",
            borderBottomWidth: 1,
            borderBottomColor: theme.line,
          })}
        >
          <Avatar name={thread.name} presence={thread.presence} />
          <View style={{ flex: 1 }}>
            <Text variant="name">{thread.name}</Text>
            <Text variant="row" tone="ink3" numberOfLines={1}>
              {thread.preview}
            </Text>
          </View>
          <CountChip count={thread.unread} />
        </Pressable>
      ))}
    </Screen>
  );
}
