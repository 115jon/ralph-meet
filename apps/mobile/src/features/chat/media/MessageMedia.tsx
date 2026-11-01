import {
  File,
  FilmStrip,
  MusicNote,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { memo } from "react";
import { useWindowDimensions, View } from "react-native";

import { RADIUS, useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

import type { Attachment } from "../schema";
import type { MessageMedia as Media } from "./classify";
import { LinkCard } from "./LinkCard";
import { MediaView } from "./MediaView";

/** Row padding, avatar and gutter: what the text column leaves. */
const COLUMN_INSET = 16 + 40 + 12 + 16;

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

/** Anything the app cannot show: one quiet row with its name. */
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
        <Text variant="silk" tone="ink3" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="row" numberOfLines={1}>
          {attachment.filename}
        </Text>
      </View>
    </View>
  );
}

/** Pictures, GIFs, videos, files and link previews under a message's text. */
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
      {media.bare.map((item) => (
        <MediaView
          key={item.key}
          media={item}
          messageId={messageId}
          maxWidth={maxWidth}
        />
      ))}
      {media.files.map((attachment) => (
        <FileRow key={attachment.id} attachment={attachment} />
      ))}
      {media.cards.map((card) => (
        <LinkCard
          key={card.key}
          card={card}
          messageId={messageId}
          maxWidth={maxWidth}
        />
      ))}
    </>
  );
});
