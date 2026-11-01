import { Play } from "phosphor-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

import type { Size } from "./box";

/** The hairline tile every picture and video sits in. */
export function MediaFrame({
  box,
  label,
  onPress,
  children,
}: {
  box: Size;
  /** What a screen reader hears; the tile's action follows from `onPress`. */
  label: string;
  onPress?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "image"}
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={onPress}
      style={{
        marginTop: 6,
        width: box.width,
        height: box.height,
        borderRadius: RADIUS,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: theme.tint1,
      }}
    >
      {children}
    </Pressable>
  );
}

/** A card-ply plate over the media's bottom-left corner: "GIF", "0:31". */
export function MediaTag({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 6,
        bottom: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: RADIUS,
        backgroundColor: theme.ply2,
      }}
    >
      <Text
        variant={/^\d/.test(children) ? "num" : "silk"}
        tone="ink2"
        style={{ fontSize: 11, lineHeight: 14 }}
      >
        {children}
      </Text>
    </View>
  );
}

/** The play key centred on a poster; the tile itself takes the tap. */
export function PlayKey() {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: RADIUS,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: theme.lineStrong,
          backgroundColor: theme.ply2,
        }}
      >
        <Icon icon={Play} active size={22} />
      </View>
    </View>
  );
}
