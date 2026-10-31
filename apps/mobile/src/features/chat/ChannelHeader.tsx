import { useRouter } from "expo-router";
import { ArrowLeft } from "phosphor-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGatewayStatus } from "@/features/realtime/gateway";
import { useTheme } from "@/theme";
import { IconButton, Led, Text } from "@/ui";

interface ChannelHeaderProps {
  name: string;
  serverName: string | null;
}

/** Back key, #channel in Bricolage, then the server and link state in silk. */
export function ChannelHeader({ name, serverName }: ChannelHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
          icon={ArrowLeft}
          label="Back"
          onPress={() => router.back()}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            variant="title"
            accessibilityRole="header"
            numberOfLines={1}
            style={{ fontSize: 18, lineHeight: 22 }}
          >
            #{name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {offline ? <Led state="idle" size={6} /> : null}
            <Text
              variant="silk"
              tone="ink3"
              numberOfLines={1}
              style={{ flexShrink: 1 }}
            >
              {offline
                ? status === "signed-out"
                  ? "Signed out"
                  : "Reconnecting"
                : (serverName ?? "Channel")}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
