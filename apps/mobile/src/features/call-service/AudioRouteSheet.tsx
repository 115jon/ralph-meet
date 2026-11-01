import { Pressable, View } from "react-native";

import { useTheme } from "@/theme";
import { Icon, Led, Sheet, Text } from "@/ui";

import { routeIcon, routeLabel } from "./routes";
import { type AudioRoute, selectAudioRoute, useAudioRoutes } from "./service";

function RouteRow({
  route,
  onDone,
}: {
  route: AudioRoute;
  onDone: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: route.active }}
      onPress={() => {
        if (!route.active) selectAudioRoute(route.id);
        onDone();
      }}
      style={({ pressed }) => ({
        height: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Icon
        icon={routeIcon(route.type)}
        active={route.active}
        size={20}
        color={route.active ? theme.ink1 : theme.ink2}
      />
      <Text
        variant="row"
        numberOfLines={1}
        style={{ flex: 1, fontSize: 15, color: theme.ink1 }}
      >
        {routeLabel(route)}
      </Text>
      <Led state={route.active ? "talk" : "off"} />
    </Pressable>
  );
}

interface AudioRouteSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** Where call audio plays; the lit LED marks the route in use. */
export function AudioRouteSheet({ visible, onClose }: AudioRouteSheetProps) {
  const routes = useAudioRoutes((s) => s.routes);
  return (
    <Sheet visible={visible} onClose={onClose} label="Audio output">
      <View style={{ paddingHorizontal: 20, paddingBottom: 6 }}>
        <Text variant="silk" tone="ink3">
          Audio output
        </Text>
      </View>
      <View accessibilityRole="radiogroup">
        {routes.map((route) => (
          <RouteRow key={route.id} route={route} onDone={onClose} />
        ))}
      </View>
    </Sheet>
  );
}
