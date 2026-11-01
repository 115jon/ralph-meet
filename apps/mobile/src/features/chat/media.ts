import type { Attachment, Embed, Message } from "./schema";

export interface MediaImage {
  readonly key: string;
  readonly url: string;
  readonly width?: number;
  readonly height?: number;
  /** A GIF or animated WebP: plays only while on screen. */
  readonly animated: boolean;
  readonly label: string;
}

export interface MessageMedia {
  /** Drawn bare under the text: image attachments and direct image links. */
  readonly images: readonly MediaImage[];
  /** Other attachments, as file rows. */
  readonly files: readonly Attachment[];
  /** Link previews, each with its own optional picture. */
  readonly cards: readonly { embed: Embed; image: MediaImage | null }[];
}

function isGifUrl(url: string): boolean {
  return /\.gif(?:$|[?#])/i.test(url);
}

/** The picture an embed shows: its first image, else its thumbnail. */
function embedImage(embed: Embed, key: string): MediaImage | null {
  const media = embed.media?.find((item) => item.type === "image");
  if (media) {
    return {
      key,
      url: media.url,
      width: media.width,
      height: media.height,
      animated: media.isGif ?? isGifUrl(media.url),
      label: embed.rawTitle ?? "Image",
    };
  }
  const still = embed.thumbnail ?? embed.media?.[0];
  const url = embed.thumbnail?.url ?? embed.media?.[0]?.thumbnailUrl;
  if (url) {
    return {
      key,
      url,
      width: still?.width,
      height: still?.height,
      animated: isGifUrl(url),
      label: embed.rawTitle ?? "Image",
    };
  }
  if (embed.direct && embed.type === "image" && embed.url) {
    return {
      key,
      url: embed.url,
      animated: isGifUrl(embed.url),
      label: "Image",
    };
  }
  return null;
}

/** Sorts a message's attachments and embeds into what the row draws. */
export function messageMedia(message: Message): MessageMedia {
  const images: MediaImage[] = [];
  const files: Attachment[] = [];
  const cards: { embed: Embed; image: MediaImage | null }[] = [];

  for (const attachment of message.attachments ?? []) {
    const type = attachment.content_type ?? "";
    if (type.startsWith("image/") && attachment.url) {
      images.push({
        key: attachment.id,
        url: attachment.url,
        animated: type === "image/gif" || type === "image/webp",
        label: attachment.filename,
      });
    } else {
      files.push(attachment);
    }
  }

  message.embeds?.forEach((embed, index) => {
    const key = `${message.id}-embed-${index}`;
    const image = embedImage(embed, key);
    if (embed.direct && embed.type === "image" && image) {
      images.push(image);
    } else if (embed.rawTitle?.trim() || image) {
      cards.push({ embed, image });
    }
  });

  return { images, files, cards };
}
