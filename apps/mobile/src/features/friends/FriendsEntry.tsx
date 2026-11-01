import { Users } from "phosphor-react-native";
import { Pressable, View } from "react-native";

import {
  FRIENDS_ID,
  openFriends,
  useIsCurrentConversation,
} from "@/features/conversation/store";
import { useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

import { usePendingCount } from "./store";

/**
 * The Friends row pinned atop the DM list (the web's DMSidebar): opens the
 * Friends page in the chat's slot. Requests waiting on you read as a
 * silkscreen "N pending": count chips are for mentions and unread DMs only.
 */
export function FriendsEntry() {
  const theme = useTheme();
  const pending = usePendingCount();
  const selected = useIsCurrentConversation(FRIENDS_ID);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        pending > 0 ? `Friends, ${pending} pending` : "Friends"
      }
      accessibilityState={{ selected }}
      onPress={openFriends}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        backgroundColor: pressed || selected ? theme.tint2 : "transparent",
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon icon={Users} size={22} active={selected} />
      </View>
      <Text variant="name" style={{ flex: 1 }}>
        Friends
      </Text>
      {pending > 0 ? (
        <Text variant="silk" tone="ink2">
          {pending} pending
        </Text>
      ) : null}
    </Pressable>
  );
}
