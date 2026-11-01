import { useRouter } from "expo-router";
import { Bell, GearSix } from "phosphor-react-native";
import { Pressable, View } from "react-native";

import { useUnreadActivityCount } from "@/features/activity/store";
import { useSession } from "@/features/auth/session";
import { STATUS_LABEL, statusLed } from "@/features/presence/status";
import {
  useSelfCustomStatus,
  useSelfStatus,
} from "@/features/presence/use-self-presence";
import { mediaUrl } from "@/lib/api";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, Skeleton, Text } from "@/ui";

import { PanelKey } from "./PanelKey";

/** You: avatar with presence, name, status line; then Activity and Settings. */
export function MeRow({ onOpenProfile }: { onOpenProfile: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const status = useSelfStatus();
  const customStatus = useSelfCustomStatus();
  const unread = useUnreadActivityCount();
  const name = user ? (user.display_name ?? user.username) : "";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 10,
        paddingLeft: 8,
        paddingRight: 10,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name || "You"}, ${STATUS_LABEL[status]}. Profile and status`}
        onPress={onOpenProfile}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 4,
          borderRadius: RADIUS,
          backgroundColor: pressed ? theme.tint2 : "transparent",
        })}
      >
        <Avatar
          name={name || "?"}
          size={40}
          uri={mediaUrl(user?.avatar_url)}
          presence={statusLed(status)}
          presenceGround={theme.ply3}
        />
        {user ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="name" numberOfLines={1}>
              {name}
            </Text>
            <Text
              variant="row"
              tone="ink2"
              numberOfLines={1}
              style={{ fontSize: 13, lineHeight: 18 }}
            >
              {customStatus ?? `@${user.username}`}
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={88} height={12} />
            <Skeleton width={120} height={10} />
          </View>
        )}
      </Pressable>
      <PanelKey
        icon={Bell}
        label="Activity"
        count={unread}
        onPress={() => router.push("/activity")}
      />
      <PanelKey
        icon={GearSix}
        label="Settings"
        onPress={() => router.push("/settings")}
      />
    </View>
  );
}
