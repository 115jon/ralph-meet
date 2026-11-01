import { Linking, Pressable, View } from "react-native";

import { useAppActive } from "@/lib/app-active";
import { RADIUS, useTheme } from "@/theme";
import { RemoteImage, Text } from "@/ui";

import { LONG_PRESS_MS, useMessageLongPress } from "../long-press";
import { useIsMessageVisible } from "../visibility";
import type { LinkCard as Card } from "./classify";
import { MediaView } from "./MediaView";

const PADDING = 12;
const THUMB = 80;

function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return match?.[1]?.replace(/^www\./, "") ?? url;
}

function openLink(url: string | undefined): void {
  if (url) Linking.openURL(url).catch(() => undefined);
}

/**
 * A link preview on the card ply: the site in silkscreen, the title, three
 * lines of description, then its picture or video. Pages that asked for a
 * summary card get a small picture beside the text instead.
 */
export function LinkCard({
  card,
  messageId,
  maxWidth,
}: {
  card: Card;
  messageId: string;
  maxWidth: number;
}) {
  const theme = useTheme();
  const visible = useIsMessageVisible(messageId);
  const active = useAppActive();
  const onLongPress = useMessageLongPress();
  const { embed, media } = card;
  const site = embed.provider?.name?.trim() || (embed.url && hostOf(embed.url));
  const title = embed.rawTitle?.trim() || embed.author?.name?.trim();
  const description = embed.rawDescription?.trim();
  const beside =
    media?.kind === "image" && embed.imageLayout === "thumbnail" ? media : null;
  const below = beside ? null : media;
  return (
    <View
      style={{
        marginTop: 6,
        maxWidth,
        padding: PADDING,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: theme.ply2,
      }}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={title ?? site ?? "Link"}
        onPress={() => openLink(embed.url)}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_MS}
        style={{ flexDirection: "row", gap: PADDING }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {site ? (
            <Text variant="silk" tone="ink3" numberOfLines={1}>
              {site}
            </Text>
          ) : null}
          {title ? (
            <Text variant="name" numberOfLines={2} style={{ fontSize: 14 }}>
              {title}
            </Text>
          ) : null}
          {description ? (
            <Text
              variant="body"
              tone="ink2"
              numberOfLines={3}
              style={{ fontSize: 13, lineHeight: 18 }}
            >
              {description}
            </Text>
          ) : null}
        </View>
        {beside ? (
          <RemoteImage
            url={beside.url}
            animate={beside.animated && visible && active}
            style={{
              width: THUMB,
              height: THUMB,
              borderRadius: RADIUS,
              backgroundColor: theme.tint1,
            }}
          />
        ) : null}
      </Pressable>
      {below ? (
        <MediaView
          media={below}
          messageId={messageId}
          maxWidth={maxWidth - PADDING * 2 - 2}
        />
      ) : null}
    </View>
  );
}
