import {
  FilmStrip,
  File,
  Image as ImageIcon,
  LinkSimple,
  MusicNote,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { memo, useMemo } from "react";
import { View } from "react-native";

import { useSession } from "@/features/auth/session";
import { mediaUrl } from "@/lib/api";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, Text } from "@/ui";

import { mentionsUser, parseContent } from "./content";
import { MessageBody } from "./MessageBody";
import type { Attachment, Embed, Message } from "./schema";
import { formatTime } from "./time";

const AVATAR = 40;
const GUTTER = 12;

function authorName(message: Message): string {
  const author = message.author;
  return author?.display_name?.trim() || author?.username || "Unknown";
}

interface MessageRowProps {
  message: Message;
  sentAt: Date;
  /** A follow-up from the same author: no avatar, no name line. */
  grouped: boolean;
}

export const MessageRow = memo(function MessageRow({
  message,
  sentAt,
  grouped,
}: MessageRowProps) {
  const theme = useTheme();
  const username = useSession((s) => s.user?.username);
  const myId = useSession((s) => s.user?.id);
  const parts = useMemo(
    () => parseContent(message.content ?? ""),
    [message.content],
  );
  const mentionsMe =
    message.author_id !== myId && mentionsUser(parts, username);
  const name = authorName(message);

  return (
    <View
      style={{
        flexDirection: "row",
        gap: GUTTER,
        paddingHorizontal: 16,
        paddingTop: grouped ? 2 : 12,
        paddingBottom: 2,
        backgroundColor: mentionsMe ? theme.accentTint : "transparent",
      }}
    >
      {mentionsMe ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            backgroundColor: theme.accentInk,
          }}
        />
      ) : null}
      {grouped ? (
        <View style={{ width: AVATAR }} />
      ) : (
        <Avatar
          name={name}
          size={AVATAR}
          uri={mediaUrl(message.author?.avatar_url)}
        />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        {grouped ? null : (
          <View
            style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}
          >
            <Text variant="name" numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </Text>
            <Text variant="num" tone="ink3" style={{ fontSize: 11 }}>
              {formatTime(sentAt)}
            </Text>
          </View>
        )}
        {parts.length > 0 ? <MessageBody parts={parts} /> : null}
        {message.attachments?.map((attachment) => (
          <AttachmentRow key={attachment.id} attachment={attachment} />
        ))}
        {message.embeds?.map((embed, index) => (
          <EmbedRow key={embed.url ?? index} embed={embed} />
        ))}
      </View>
    </View>
  );
});

interface PlaceholderKind {
  icon: PhosphorIcon;
  label: string;
}

function attachmentKind(attachment: Attachment): PlaceholderKind {
  const type = attachment.content_type ?? "";
  if (type.startsWith("image/")) return { icon: ImageIcon, label: "Image" };
  if (type.startsWith("video/")) return { icon: FilmStrip, label: "Video" };
  if (type.startsWith("audio/")) return { icon: MusicNote, label: "Audio" };
  return { icon: File, label: "File" };
}

interface PlaceholderRowProps extends PlaceholderKind {
  text: string;
}

/** Attachments and embeds as one quiet row until the media viewer lands. */
function PlaceholderRow({ icon, label, text }: PlaceholderRowProps) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${text}`}
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
          {text}
        </Text>
      </View>
    </View>
  );
}

function AttachmentRow({ attachment }: { attachment: Attachment }) {
  const { icon, label } = attachmentKind(attachment);
  return (
    <PlaceholderRow icon={icon} label={label} text={attachment.filename} />
  );
}

function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return match?.[1]?.replace(/^www\./, "") ?? url;
}

/** A titled preview; without a title the link in the text says it all. */
function EmbedRow({ embed }: { embed: Embed }) {
  const text = embed.rawTitle?.trim();
  if (!text) return null;
  return (
    <PlaceholderRow
      icon={LinkSimple}
      label={embed.url ? hostOf(embed.url) : "Link"}
      text={text}
    />
  );
}

/** Hairlines either side of the day in silkscreen. */
export const DayDivider = memo(function DayDivider({
  label,
}: {
  label: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="header"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 4,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
      <Text variant="silk" tone="ink3">
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
    </View>
  );
});
