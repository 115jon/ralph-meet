import { Copy } from "phosphor-react-native";
import { memo } from "react";
import { Pressable, Text as RNText, ScrollView, View } from "react-native";

import { FONT, RADIUS, useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

import { canCopy, copyText } from "../clipboard";

/**
 * A ``` fence: Geist Mono on ply-2 behind a hairline, long lines scroll
 * sideways instead of wrapping. The strip on top names the language and
 * holds the copy key.
 */
export const CodeBlock = memo(function CodeBlock({
  language,
  code,
}: {
  language: string | null;
  code: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        marginVertical: 4,
        borderWidth: 1,
        borderColor: theme.line,
        borderRadius: RADIUS,
        backgroundColor: theme.ply2,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          height: 32,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 12,
          borderBottomWidth: 1,
          borderBottomColor: theme.line,
        }}
      >
        <Text
          variant="silk"
          tone="ink3"
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {language ?? "Code"}
        </Text>
        {canCopy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy code"
            onPress={() => copyText(code)}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? theme.tint2 : "transparent",
            })}
          >
            <Icon icon={Copy} size={16} color={theme.ink2} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}
      >
        <RNText
          style={{
            fontFamily: FONT.code,
            fontSize: 13,
            lineHeight: 20,
            color: theme.ink1,
          }}
        >
          {code}
        </RNText>
      </ScrollView>
    </View>
  );
});
