import { List, UsersThree } from "phosphor-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGatewayStatus } from "@/features/realtime/gateway";
import { RADIUS, useTheme } from "@/theme";
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
  /** A channel's members key: slides the members page in. */
  onMembers?: () => void;
  /** A DM's avatar and name open the other person's profile. */
  onTitle?: () => void;
}

/**
 * Menu key, the title in Bricolage, then context or link state in silk; a
 * channel ends in the members key.
 */
export function ChatHeader({
  title,
  subtitle,
  avatar,
  onMenu,
  onMembers,
  onTitle,
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
          paddingRight: onMembers ? 4 : 16,
        }}
      >
        <IconButton
          icon={List}
          label="Channels and messages"
          onPress={onMenu}
        />
        <Pressable
          accessibilityRole={onTitle ? "button" : undefined}
          accessibilityLabel={onTitle ? `${title}'s profile` : undefined}
          disabled={!onTitle}
          onPress={onTitle}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            borderRadius: RADIUS,
            paddingRight: 4,
            backgroundColor: pressed ? theme.tint1 : "transparent",
          })}
        >
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
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
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
        </Pressable>
        {onMembers ? (
          <IconButton icon={UsersThree} label="Members" onPress={onMembers} />
        ) : null}
      </View>
    </View>
  );
}
