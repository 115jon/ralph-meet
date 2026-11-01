import { List, Phone, UsersThree } from "phosphor-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGatewayStatus } from "@/features/realtime/gateway";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, IconButton, Led, Text } from "@/ui";

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
  /** A 1:1 DM's phone key: starts a call. */
  onCall?: () => void;
  /** Already in this DM's call: the phone key rests at 45%. */
  callDisabled?: boolean;
}

/** The DM header's phone key: its glyph fills while pressed. */
function CallKey({
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start a voice call"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? theme.tint2 : "transparent",
        opacity: disabled ? 0.45 : 1,
      })}
    >
      {({ pressed }) => <Icon icon={Phone} active={pressed} size={22} />}
    </Pressable>
  );
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
  onCall,
  callDisabled = false,
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
          paddingRight: onMembers || onCall ? 4 : 16,
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
        {onCall ? <CallKey onPress={onCall} disabled={callDisabled} /> : null}
        {onMembers ? (
          <IconButton icon={UsersThree} label="Members" onPress={onMembers} />
        ) : null}
      </View>
    </View>
  );
}
