import type { Icon as PhosphorIcon } from "phosphor-react-native";
import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import Animated, { Easing, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SHEET_TOP_RADIUS, useTheme } from "@/theme";

import { Icon } from "./Icon";
import { Text } from "./Text";

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** Read by screen readers as the sheet's name. */
  label: string;
  children: ReactNode;
}

/**
 * A bottom sheet: a ply-3 float with a 4px top corner and a 2px ink rule
 * over a scrim, rising in 250ms on ease-out. A React Native Modal rather
 * than Compose's ModalBottomSheet, whose shape cannot be set to the 4px
 * key corner. Tap the scrim or press back to close.
 */
export function Sheet({ visible, onClose, label, children }: SheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.scrim,
          }}
        />
        <Animated.View
          entering={SlideInDown.duration(250).easing(Easing.out(Easing.cubic))}
          accessibilityViewIsModal
          accessibilityLabel={label}
          style={{
            paddingTop: 10,
            paddingBottom: insets.bottom + 12,
            backgroundColor: theme.ply3,
            borderTopWidth: 2,
            borderTopColor: theme.ink1,
            borderTopLeftRadius: SHEET_TOP_RADIUS,
            borderTopRightRadius: SHEET_TOP_RADIUS,
            shadowColor: theme.shadow,
            shadowOffset: { width: 0, height: -12 },
            shadowOpacity: 1,
            shadowRadius: 32,
            elevation: 24,
          }}
        >
          <View
            style={{
              width: 32,
              height: 3,
              borderRadius: 2,
              alignSelf: "center",
              marginBottom: 8,
              backgroundColor: theme.lineStrong,
            }}
          />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

interface SheetRowProps {
  icon: PhosphorIcon;
  label: string;
  onPress: () => void;
  /** Destructive: the row and its glyph in danger ink. */
  danger?: boolean;
}

/** A 52px action row: a 20px ink-2 glyph and a Geist 15 label. */
export function SheetRow({
  icon,
  label,
  onPress,
  danger = false,
}: SheetRowProps) {
  const theme = useTheme();
  const color = danger ? theme.dangerInk : theme.ink2;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Icon icon={icon} size={20} color={color} />
      <Text
        variant="row"
        style={{ fontSize: 15, color: danger ? theme.dangerInk : theme.ink1 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
