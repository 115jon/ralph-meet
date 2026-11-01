import {
  File,
  FilmStrip,
  MusicNote,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { memo, useState } from "react";
import { Linking, Pressable, useWindowDimensions, View } from "react-native";

import { openImage } from "@/features/media/viewer-store";
import { RADIUS, useTheme } from "@/theme";
import { Icon, RemoteImage, Text } from "@/ui";

import type { MediaImage, MessageMedia as Media } from "./media";
import type { Attachment, Embed } from "./schema";
import { useIsMessageVisible } from "./visibility";

/** Row padding, avatar and gutter: what the text column leaves. */
const COLUMN_INSET = 16 + 40 + 12 + 16;
const MAX_HEIGHT = 300;
/** Before an image reports its size it holds a 4:3 box. */
const FALLBACK_RATIO = 4 / 3;

interface Size {
  readonly width: number;
  readonly height: number;
}

// Sizes seen this session, so a row that scrolls back in keeps its box, and
// URLs that failed, so a dead preview never draws an empty frame again.
const knownSizes = new Map<string, Size>();
const failedUrls = new Set<string>();

function fit(size: Size | undefined, maxWidth: number): Size {
  if (!size || size.width <= 0 || size.height <= 0) {
    const width = Math.min(maxWidth, MAX_HEIGHT * FALLBACK_RATIO);
    return { width, height: width / FALLBACK_RATIO };
  }
  const scale = Math.min(1, maxWidth / size.width, MAX_HEIGHT / size.height);
  return {
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  };
}

function ImageTile({
  image,
  messageId,
  maxWidth,
}: {
  image: MediaImage;
  messageId: string;
  maxWidth: number;
}) {
  const theme = useTheme();
  const visible = useIsMessageVisible(messageId);
  const [size, setSize] = useState(
    () =>
      knownSizes.get(image.url) ??
      (image.width && image.height
        ? { width: image.width, height: image.height }
        : undefined),
  );
  const [failed, setFailed] = useState(() => failedUrls.has(image.url));
  const box = fit(size, maxWidth);
  if (failed) return null;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={`Open image: ${image.label}`}
      onPress={() =>
        openImage({
          url: image.url,
          label: image.label,
          animated: image.animated,
        })
      }
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
      <RemoteImage
        url={image.url}
        style={{ width: "100%", height: "100%" }}
        animate={image.animated && visible}
        onError={() => {
          failedUrls.add(image.url);
          setFailed(true);
        }}
        onSize={(width, height) => {
          knownSizes.set(image.url, { width, height });
          if (!size || size.width !== width || size.height !== height) {
            setSize({ width, height });
          }
        }}
      />
    </Pressable>
  );
}

function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return match?.[1]?.replace(/^www\./, "") ?? url;
}

function openLink(url: string | undefined): void {
  if (url) Linking.openURL(url).catch(() => undefined);
}

/** A link preview: host in silkscreen, title, two lines of description, picture. */
function LinkCard({
  embed,
  image,
  messageId,
  maxWidth,
}: {
  embed: Embed;
  image: MediaImage | null;
  messageId: string;
  maxWidth: number;
}) {
  const theme = useTheme();
  const title = embed.rawTitle?.trim();
  const description = embed.rawDescription?.trim();
  return (
    <View
      style={{
        marginTop: 6,
        maxWidth,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: image ? 2 : 10,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: theme.ply2,
        gap: 2,
      }}
    >
      <Pressable
        accessibilityRole="link"
        onPress={() => openLink(embed.url)}
        style={{ gap: 2 }}
      >
        {embed.url ? (
          <Text variant="silk" tone="ink3" numberOfLines={1}>
            {hostOf(embed.url)}
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
            numberOfLines={2}
            style={{ fontSize: 13, lineHeight: 18 }}
          >
            {description}
          </Text>
        ) : null}
      </Pressable>
      {image ? (
        <View style={{ paddingBottom: 8 }}>
          <ImageTile
            image={image}
            messageId={messageId}
            maxWidth={maxWidth - 26}
          />
        </View>
      ) : null}
    </View>
  );
}

interface FileKind {
  readonly icon: PhosphorIcon;
  readonly label: string;
}

function fileKind(attachment: Attachment): FileKind {
  const type = attachment.content_type ?? "";
  if (type.startsWith("video/")) return { icon: FilmStrip, label: "Video" };
  if (type.startsWith("audio/")) return { icon: MusicNote, label: "Audio" };
  return { icon: File, label: "File" };
}

/** Anything that is not a picture: one quiet row with its name. */
function FileRow({ attachment }: { attachment: Attachment }) {
  const theme = useTheme();
  const { icon, label } = fileKind(attachment);
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${attachment.filename}`}
      style={{
        marginTop: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: theme.ply2,
      }}
    >
      <Icon icon={icon} size={18} color={theme.ink2} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="silk" tone="ink3">
          {label}
        </Text>
        <Text variant="row" numberOfLines={1}>
          {attachment.filename}
        </Text>
      </View>
    </View>
  );
}

/** Pictures, files and link previews under a message's text. */
export const MessageMedia = memo(function MessageMedia({
  media,
  messageId,
}: {
  media: Media;
  messageId: string;
}) {
  const { width } = useWindowDimensions();
  const maxWidth = width - COLUMN_INSET;
  return (
    <>
      {media.images.map((image) => (
        <ImageTile
          key={image.key}
          image={image}
          messageId={messageId}
          maxWidth={maxWidth}
        />
      ))}
      {media.files.map((attachment) => (
        <FileRow key={attachment.id} attachment={attachment} />
      ))}
      {media.cards.map(({ embed, image }, index) => (
        <LinkCard
          key={embed.url ?? index}
          embed={embed}
          image={image}
          messageId={messageId}
          maxWidth={maxWidth}
        />
      ))}
    </>
  );
});
