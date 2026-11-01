import { MagnifyingGlass, XCircle } from "phosphor-react-native";
import type { Ref } from "react";
import {
  Pressable,
  TextInput,
  View,
  type TextInputInstance,
} from "react-native";

import { FONT, RADIUS, useTheme } from "@/theme";
import { Icon } from "@/ui";

/** The pickers' search field: a glass, the text, and a clear key. */
export function PickerSearch({
  ref,
  value,
  onChange,
  placeholder,
  height = 36,
  onFocus,
  onBlur,
}: {
  ref?: Ref<TextInputInstance>;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  height?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        height,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 10,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: theme.lineField,
        backgroundColor: theme.ply2,
      }}
    >
      <Icon icon={MagnifyingGlass} size={16} color={theme.ink3} />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={theme.ink3}
        accessibilityLabel={placeholder}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        cursorColor={theme.accentInk}
        selectionColor={theme.accentTint}
        style={{
          flex: 1,
          height,
          padding: 0,
          fontFamily: FONT.body,
          fontSize: 14,
          color: theme.ink1,
        }}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChange("")}
          hitSlop={6}
          style={{
            width: height,
            height,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon icon={XCircle} active size={16} color={theme.ink3} />
        </Pressable>
      ) : (
        <View style={{ width: 4 }} />
      )}
    </View>
  );
}
