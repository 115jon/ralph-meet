import type { BottomTabBarProps } from "expo-router/js-tabs";
import { At, ChatCircle, TreeStructure, User } from "phosphor-react-native";
import type { Icon as PhosphorIcon } from "phosphor-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RADIUS, useTheme } from "@/theme";
import { CountChip, Icon, Text } from "@/ui";

import { CallSegment } from "./CallSegment";
import { useCallSegment } from "./call-segment";
import { BAR_BOTTOM_GAP, BAR_HEIGHT, BAR_INSET_X } from "./metrics";

const TABS: { name: string; label: string; icon: PhosphorIcon }[] = [
  { name: "servers", label: "Servers", icon: TreeStructure },
  { name: "dms", label: "DMs", icon: ChatCircle },
  { name: "activity", label: "Activity", icon: At },
  { name: "you", label: "You", icon: User },
];

/** Variant A, the morphing plate: one floating ply-3 plate; a call slides a segment in and tabs collapse to icons. */
export function AppBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
}: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const call = useCallSegment();

  return (
    <View
      style={{
        position: "absolute",
        left: BAR_INSET_X,
        right: BAR_INSET_X,
        bottom: insets.bottom + BAR_BOTTOM_GAP,
        height: BAR_HEIGHT,
        flexDirection: "row",
        alignItems: "stretch",
        borderRadius: RADIUS,
        backgroundColor: theme.ply3,
        borderWidth: 1,
        borderColor: theme.lineStrong,
        borderTopWidth: 2,
        borderTopColor: theme.ink1,
        shadowColor: theme.shadow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 12,
        elevation: 12,
      }}
    >
      {call ? <CallSegment call={call} /> : null}
      {state.routes.map((route, index) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const focused = index === state.index;
        const badge = descriptors[route.key]?.options.tabBarBadge;
        const count = typeof badge === "number" ? badge : 0;
        const onPress = () => {
          const event = emitter.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };
        const color = focused ? theme.ink1 : theme.ink3;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: focused }}
            onPress={onPress}
            style={{
              flex: call ? 0 : 1,
              width: call ? 48 : undefined,
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            {focused ? (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 8,
                  right: 8,
                  height: 2,
                  backgroundColor: theme.accentInk,
                }}
              />
            ) : null}
            <View>
              <Icon icon={tab.icon} active={focused} size={24} color={color} />
              {count > 0 ? (
                <View style={{ position: "absolute", top: -6, left: 14 }}>
                  <CountChip count={count} />
                </View>
              ) : null}
            </View>
            {call ? null : (
              <Text variant="silk" style={{ color }}>
                {tab.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
