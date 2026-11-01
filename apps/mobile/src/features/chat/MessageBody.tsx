import { memo } from "react";
import { Linking } from "react-native";

import { FONT, useTheme } from "@/theme";
import { Text } from "@/ui";

import type { ContentPart } from "./content";

function openLink(url: string): void {
  Linking.openURL(url).catch(() => undefined);
}

/** Message prose in Geist: mentions on the accent tint, links tappable. */
export const MessageBody = memo(function MessageBody({
  parts,
  edited = false,
}: {
  parts: readonly ContentPart[];
  /** Appends a quiet "(edited)" after the text. */
  edited?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text variant="body" selectable>
      {parts.map((part, index) => {
        switch (part.kind) {
          case "text":
            return part.text;
          case "emoji":
            return (
              <Text key={index} tone="ink2">
                {part.text}
              </Text>
            );
          case "mention":
            return (
              <Text
                key={index}
                style={{
                  fontFamily: FONT.row,
                  color: theme.accentInk,
                  backgroundColor: theme.accentTint,
                }}
              >
                {part.text}
              </Text>
            );
          case "link":
            return (
              <Text
                key={index}
                accessibilityRole="link"
                onPress={() => openLink(part.url)}
                style={{
                  color: theme.accentInk,
                  textDecorationLine: "underline",
                }}
              >
                {part.text}
              </Text>
            );
        }
      })}
      {edited ? (
        <Text tone="ink3" style={{ fontSize: 11 }}>
          {" (edited)"}
        </Text>
      ) : null}
    </Text>
  );
});
