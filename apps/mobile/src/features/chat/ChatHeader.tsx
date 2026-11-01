import { List } from "phosphor-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGatewayStatus } from "@/features/realtime/gateway";
import { useTheme } from "@/theme";
import { Avatar, IconButton, Led, Text } from "@/ui";

interface ChatHeaderProps {
  /** "#general", or the other person's name in a DM. */
  title: string;
  /** The server's name, or the DM partner's @username. */
  subtitle: string;
  /** A DM shows who it is with. */
  avatar?: { name: string; uri: string | null };
  /** Slides the chat aside to the drawer (channels and messages). */
  onMenu: () => void;
}

/** Menu key, the title in Bricolage, then context or link state in silk. */
export function ChatHeader({
  title,
  subtitle,
  avatar,
  onMenu,
}: ChatHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const status = useGatewayStatus();
  const offline = status === "reconnecting" || status === "signed-out";
  return (
    <View
      style={{
        paddingTop: insets.top,
        borderBottomWidth: 1,
        borderBottomColor: theme.line,
        backgroundColor: theme.ply0,
      }}
    >
      <View
        style={{
          height: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingLeft: 4,
          paddingRight: 16,
        }}
      >
        <IconButton
          icon={List}
          label="Channels and messages"
          onPress={onMenu}
        />
        {avatar ? (
          <View style={{ marginRight: 8 }}>
            <Avatar name={avatar.name} uri={avatar.uri} size={32} />
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            variant="title"
            accessibilityRole="header"
            numberOfLines={1}
            style={{ fontSize: 18, lineHeight: 22 }}
          >
            {title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {offline ? <Led state="idle" size={6} /> : null}
            {offline ? (
              <Text variant="silk" tone="ink3" numberOfLines={1}>
                {status === "signed-out" ? "Signed out" : "Reconnecting"}
              </Text>
            ) : (
              // Server and user names are user content: never uppercased.
              <Text
                variant="num"
                tone="ink3"
                numberOfLines={1}
                style={{ flexShrink: 1, fontSize: 11, lineHeight: 14 }}
              >
                {subtitle}
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
