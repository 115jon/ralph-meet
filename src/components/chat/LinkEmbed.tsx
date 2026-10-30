import type {
  Attachment,
  EmbedAuthor,
  EmbedExternalCard,
  EmbedInfo,
  EmbedMedia,
  EmbedMetrics,
} from "@/lib/types";
import { extractCustomEmojiIds, splitTextByNativeEmoji } from "@/lib/emoji";
import { apiUrl, getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import {
  createAttachmentClipFavorite,
  createExternalGifFavorite,
  getFxTwitterGifWebpUrl,
  unwrapProxyMediaUrl,
} from "@/lib/gif-favorite-item";
import { buildProxyMediaPath, buildProxyMediaUrl } from "@/lib/proxy-media-url";
import {
  hydrationKey,
  loadEmbedHydration,
  peekEmbedHydration,
} from "@/lib/embed-hydration-cache";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { HIT } from "@/components/ui/interaction";
import { Num } from "@/components/ui/num";
import { useAppActive } from "@/hooks/useAppActive";
import { useCustomEmojiLookup } from "@/hooks/useCustomEmojiLookup";
import { useEmojiDataReady } from "@/hooks/useEmojiDataReady";
import type { ViewerContext } from "@/stores/useImageViewerStore";
import { useImageViewerActions } from "@/stores/useImageViewerStore";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EmbedFrame } from "./EmbedFrame";
import { EmbedDate, EmbedHeader, EmbedOpenButton } from "./embeds/EmbedChrome";
import { MediaPlayButton } from "./embeds/MediaPlayButton";
import {
  DIRECT_MEDIA_MAX_HEIGHT,
  DIRECT_MEDIA_MAX_WIDTH,
  EMBED_PORTRAIT_MAX_HEIGHT,
  type EmbedWidth,
  SOCIAL_UNAVAILABLE_IMAGE,
  getDirectMediaBox,
  getSpotifyEmbedUrl,
  getSpotifyPlayerHeight,
  getXSingleImageBoxStyle,
} from "./embed-layout";
import EmojiToken from "./EmojiToken";
import { RemoveEmbedsDialog } from "./RemoveEmbedsDialog";
import { GifFavoriteButton } from "./GifFavoriteButton";
import VideoAttachment from "./VideoAttachment";

// TikTok's player bootstrap reads its own cookies; without allow-same-origin
// the iframe fallback logs SecurityError and never finishes initialising.
const EMBED_PLAYER_SANDBOX =
  "allow-presentation allow-same-origin allow-scripts";
const EMBED_WIDGET_SANDBOX =
  "allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts";

const EMBED_INLINE_URL_REGEX = /(https?:\/\/[^\s]+)/gi;
const X_STANDALONE_TWEET_COLLAPSED_LINES = 5;
const X_STANDALONE_TWEET_COLLAPSED_CHAR_THRESHOLD = 280;
const X_REFERENCED_TWEET_COLLAPSED_LINES = 4;
const X_REFERENCED_TWEET_COLLAPSED_CHAR_THRESHOLD = 220;
const useSafeLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ─── Shared Base Components ───────────────────────────────────────────────

interface BaseEmbedProps {
  embed: EmbedInfo;
  children: React.ReactNode;
  /** One of the three embed widths (embed-layout.ts). */
  width?: EmbedWidth;
  /** If true, skip rendering rawTitle/rawDescription/provider inside the wrapper */
  bare?: boolean;
  /** Adds the open-external control to the header (players, not links). */
  openHref?: string;
  openLabel?: string;
}

function renderEmbedPlainText(
  text: string,
  keyPrefix: string,
  customEmojiMap: Record<string, { image_url?: string | null }>,
): React.ReactNode[] {
  const customEmojiRegex = /<:[a-z0-9_]+:[a-z0-9-]+>/gi;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(customEmojiRegex)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(
        ...splitTextByNativeEmoji(text.slice(lastIndex, index)).map(
          (part, partIndex) =>
            part.type === "emoji" ? (
              <EmojiToken
                key={`${keyPrefix}-emoji-${index}-${partIndex}`}
                value={part.value}
                selectable
              />
            ) : (
              part.value
            ),
        ),
      );
    }

    nodes.push(
      <EmojiToken
        key={`${keyPrefix}-custom-${index}`}
        value={token}
        customEmojiMap={customEmojiMap}
        selectable
      />,
    );

    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(
      ...splitTextByNativeEmoji(text.slice(lastIndex)).map((part, partIndex) =>
        part.type === "emoji" ? (
          <EmojiToken
            key={`${keyPrefix}-tail-${partIndex}`}
            value={part.value}
            selectable
          />
        ) : (
          part.value
        ),
      ),
    );
  }

  return nodes.length > 0 ? nodes : [text];
}

function formatInlineUrlLabel(url: string, compactUrls = false): string {
  if (!compactUrls) return url;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, "");
    const pathname =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    const suffix = `${pathname}${parsed.search}${parsed.hash}`;
    return `${hostname}${suffix}` || hostname;
  } catch {
    return url.replace(/^https?:\/\/(?:www\.)?/i, "");
  }
}

function renderEmbedInlineContent(
  text: string,
  keyPrefix: string,
  customEmojiMap: Record<string, { image_url?: string | null }>,
  options?: {
    linkClassName?: string;
    compactUrls?: boolean;
  },
): React.ReactNode[] {
  const linkClassName = options?.linkClassName?.trim();
  if (!linkClassName) {
    return renderEmbedPlainText(text, keyPrefix, customEmojiMap);
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(EMBED_INLINE_URL_REGEX)) {
    const url = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(
        ...renderEmbedPlainText(
          text.slice(lastIndex, index),
          `${keyPrefix}-text-${index}`,
          customEmojiMap,
        ),
      );
    }

    nodes.push(
      <a
        key={`${keyPrefix}-url-${index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
      >
        {formatInlineUrlLabel(url, options?.compactUrls)}
      </a>,
    );

    lastIndex = index + url.length;
  }

  if (lastIndex < text.length) {
    nodes.push(
      ...renderEmbedPlainText(
        text.slice(lastIndex),
        `${keyPrefix}-tail`,
        customEmojiMap,
      ),
    );
  }

  return nodes.length > 0 ? nodes : [text];
}

const EmbedInlineText = memo(
  ({
    text,
    keyPrefix,
    linkClassName,
    compactUrls,
  }: {
    text: string;
    keyPrefix: string;
    linkClassName?: string;
    compactUrls?: boolean;
  }) => {
    useEmojiDataReady(); // re-render once lazy emoji data lands (desktop)
    const customEmojiIds = extractCustomEmojiIds(text);
    const customEmojiMap = useCustomEmojiLookup(customEmojiIds);

    return (
      <>
        {renderEmbedInlineContent(text, keyPrefix, customEmojiMap, {
          linkClassName,
          compactUrls,
        })}
      </>
    );
  },
);

/** Link classes for URLs inside embed text. */
const EMBED_TEXT_LINK =
  "text-accent-ink underline-offset-3 pointer-fine:hover:underline";

/** The card title: a link in accent ink, 14/20 at 600. */
function EmbedTitle({ embed }: { embed: EmbedInfo }) {
  if (!embed.rawTitle) return null;
  return (
    <a
      href={embed.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ui-row font-semibold text-balance break-words text-accent-ink underline-offset-3 pointer-fine:hover:underline"
    >
      <EmbedInlineText text={embed.rawTitle} keyPrefix={`${embed.id}-title`} />
    </a>
  );
}

/** The card description: 13/20 in ink-2, three lines at most. */
function EmbedDescription({ embed }: { embed: EmbedInfo }) {
  if (!embed.rawDescription) return null;
  return (
    <div className="line-clamp-3 text-ui-sm leading-5 text-pretty whitespace-pre-wrap break-words text-ink-2">
      <EmbedInlineText
        text={embed.rawDescription}
        keyPrefix={`${embed.id}-description`}
      />
    </div>
  );
}

/** Header for a generic card: dot, provider name and the post date. */
function EmbedCardHeader({
  embed,
  openHref,
  openLabel,
}: {
  embed: EmbedInfo;
  openHref?: string;
  openLabel?: string;
}) {
  if (!embed.provider && !embed.timestamp && !openHref) return null;
  return (
    <EmbedHeader
      provider={
        embed.provider ? (
          <EmbedInlineText
            text={embed.provider.name}
            keyPrefix={`${embed.id}-provider`}
          />
        ) : undefined
      }
      color={embed.color}
      timestamp={embed.timestamp}
      openHref={openHref}
      openLabel={openLabel}
    />
  );
}

/**
 * The one embed anatomy (talk-tree-spec §8): a ply-2 card at radius 10 with
 * a header (provider dot, provider name, date, open control), then title,
 * description, media and a footer line. `bare` lets a provider card lay out
 * its own body inside the same frame and padding.
 */
const BaseEmbed = memo(
  ({
    embed,
    children,
    width = "standard",
    bare,
    openHref,
    openLabel,
  }: BaseEmbedProps) => {
    return (
      <EmbedFrame width={width}>
        <div className="flex flex-col gap-2 p-3">
          {!bare && (
            <EmbedCardHeader
              embed={embed}
              openHref={openHref}
              openLabel={openLabel}
            />
          )}

          {!bare && <EmbedTitle embed={embed} />}

          {!bare && <EmbedDescription embed={embed} />}

          {children}

          {!bare && embed.footer && (
            <div className="flex min-w-0 items-center gap-2 text-ui-xs text-ink-3">
              {embed.footer.iconURL && (
                <img
                  src={embed.footer.iconURL}
                  alt=""
                  className="size-4 shrink-0 rounded-avatar"
                />
              )}
              <span className="min-w-0 truncate">
                <EmbedInlineText
                  text={embed.footer.text}
                  keyPrefix={`${embed.id}-footer`}
                />
              </span>
            </div>
          )}
        </div>
      </EmbedFrame>
    );
  },
);

function shouldCollapseXText(
  text: string,
  collapsedLineThreshold: number,
  collapsedCharThreshold: number,
): boolean {
  if (!text) return false;

  const normalizedLineCount = text.split(/\r?\n/).length;
  return (
    normalizedLineCount > collapsedLineThreshold ||
    text.length > collapsedCharThreshold
  );
}

// ─── Media chrome ─────────────────────────────────────────────────────────

/**
 * Floating control on top of media (carousel chevrons, GIF controls): a
 * ply-3 float in ink-1, so it holds its contrast over any frame and theme.
 */
const MEDIA_FLOAT =
  "border border-line bg-ply-3 text-ink-1 shadow-float outline-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-ply-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** "+3" over the last visible tile when more media is hidden. */
function MediaMoreOverlay({ count }: { count: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-scrim">
      <span className="rounded-md bg-ply-3 px-2 py-1 text-ink-1">
        <Num size="sm">+{count}</Num>
      </span>
    </div>
  );
}

function getAspectRatio(
  width?: number | null,
  height?: number | null,
): number | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  return width / height;
}

const DirectVideoEmbed = memo(
  ({
    src,
    filename,
    maxWidth,
    maxHeight,
    aspectRatio,
    poster,
    fallbackToPosterOnError,
    referrerPolicy,
    onVideoError,
    surfaceClassName,
    mediaClassName,
    showDurationBadge,
    durationBadgeSeconds,
    embeddedChrome = true,
    onPlay,
    onStop,
    playbackMode = "default",
  }: {
    src: string;
    filename: string;
    maxWidth: number;
    maxHeight: number;
    aspectRatio?: number;
    poster?: string;
    fallbackToPosterOnError?: boolean;
    referrerPolicy?: React.HTMLAttributeReferrerPolicy;
    onVideoError?: () => void;
    surfaceClassName?: string;
    mediaClassName?: string;
    showDurationBadge?: boolean;
    durationBadgeSeconds?: number;
    embeddedChrome?: boolean;
    onPlay?: React.ReactEventHandler<HTMLVideoElement>;
    onStop?: () => void;
    playbackMode?: "default" | "animated";
  }) => (
    <VideoAttachment
      src={src}
      filename={filename}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
      aspectRatio={aspectRatio}
      poster={poster}
      fallbackToPosterOnError={fallbackToPosterOnError}
      referrerPolicy={referrerPolicy}
      showDownload={false}
      onVideoError={onVideoError}
      surfaceClassName={surfaceClassName}
      mediaClassName={mediaClassName}
      showDurationBadge={showDurationBadge}
      durationBadgeSeconds={durationBadgeSeconds}
      embeddedChrome={embeddedChrome}
      onPlay={onPlay}
      onStop={onStop}
      playbackMode={playbackMode}
    />
  ),
);

// ─── Platform-specific Renderers ──────────────────────────────────────────

const YouTubeEmbed = memo(
  ({
    embed,
    onMediaPlay,
    onMediaStop,
  }: {
    embed: EmbedInfo;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
  }) => {
    const [playing, setPlaying] = useState(false);

    const handlePlay = useCallback(() => {
      setPlaying(true);
      onMediaPlay?.();
    }, [onMediaPlay]);

    useEffect(
      () => () => {
        if (playing) onMediaStop?.();
      },
      [onMediaStop, playing],
    );

    const w = embed.video?.width ?? 1280;
    const h = embed.video?.height ?? 720;
    const isPortrait = h > w;

    return (
      <BaseEmbed
        embed={embed}
        // Landscape takes the media width; Shorts sit in a compact card and
        // stop growing at the portrait cap.
        width={isPortrait ? "compact" : "media"}
        openHref={embed.url}
        openLabel="Open in YouTube"
      >
        <div
          className="relative w-full overflow-hidden rounded-md bg-black"
          {...(embed.thumbnail?.url
            ? {
                "data-media-element": "true",
                "data-media-url": embed.thumbnail.url,
                "data-media-download-url": getAuthAssetUrl(embed.thumbnail.url),
              }
            : {})}
          style={{
            aspectRatio: `${w}/${h}`,
            maxHeight: isPortrait ? EMBED_PORTRAIT_MAX_HEIGHT : undefined,
          }}
        >
          {playing ? (
            <iframe
              className="absolute inset-0 w-full h-full border-0"
              title="Embedded video player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              sandbox={EMBED_PLAYER_SANDBOX}
              src={`${embed.video?.url}?autoplay=1&rel=0`}
            />
          ) : (
            <>
              {embed.thumbnail?.url && (
                <img
                  src={embed.thumbnail.url}
                  alt={embed.rawTitle || "YouTube video"}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                  data-media-element="true"
                  data-media-url={embed.thumbnail.url}
                  data-media-download-url={getAuthAssetUrl(embed.thumbnail.url)}
                />
              )}
              {/* The whole frame plays; the shared disc is centred on it. */}
              <button
                type="button"
                onClick={handlePlay}
                className="group/media absolute inset-0 flex cursor-pointer items-center justify-center outline-none"
                aria-label={
                  embed.rawTitle ? `Play ${embed.rawTitle}` : "Play video"
                }
              >
                <MediaPlayButton />
              </button>
            </>
          )}
        </div>
      </BaseEmbed>
    );
  },
);

type TikTokHydrationPayload = {
  canonicalUrl?: string | null;
  postType?: "video" | "slideshow" | null;
  videoUrl?: string | null;
  coverUrl?: string | null;
  title?: string | null;
  authorName?: string | null;
  authorHandle?: string | null;
  authorAvatarUrl?: string | null;
  media?: EmbedMedia[];
  audio?: EmbedInfo["audio"];
  likeCount?: number | null;
  commentCount?: number | null;
  viewCount?: number | null;
  shareCount?: number | null;
  timestamp?: string | null;
};

type TikTokPlayerState =
  | { mode: "idle" }
  | { mode: "loading" }
  | { mode: "ready" }
  | { mode: "iframe" }
  | { mode: "error" }
  /** The server confirmed the post is gone (deleted or private). */
  | { mode: "missing" };

type MediaDimensions = {
  width: number;
  height: number;
};

function getEmbedMediaKey(item: EmbedMedia, index: number): string {
  return `${item.type}:${item.url}:${index}`;
}

function getTikTokHydrationSignature(embed: EmbedInfo): string {
  return JSON.stringify({
    id: embed.id,
    url: embed.url,
    title: embed.rawTitle,
    description: embed.rawDescription,
    thumbnail: embed.thumbnail?.url,
    videoUrl: embed.video?.url,
    media:
      embed.media?.map((item) => ({
        type: item.type,
        url: item.url,
        thumbnailUrl: item.thumbnailUrl,
        width: item.width,
        height: item.height,
        durationSeconds: item.durationSeconds,
      })) ?? [],
    audioUrl: embed.audio?.url,
  });
}

function getTikTokVideoId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.pathname.match(
        /(?:\/video\/|\/photo\/|\/player\/v1\/)(\d+)/,
      )?.[1] ?? null
    );
  } catch {
    return (
      rawUrl.match(/(?:\/video\/|\/photo\/|\/player\/v1\/)(\d+)/)?.[1] ?? null
    );
  }
}

function withTikTokPlayerOptions(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set("description", "1");
    parsed.searchParams.set("music_info", "1");
    return parsed.toString();
  } catch {
    return `${rawUrl}?description=1&music_info=1`;
  }
}

function getTikTokRenderableMedia(embed: EmbedInfo): EmbedMedia[] {
  if (Array.isArray(embed.media) && embed.media.length > 0) {
    return embed.media;
  }

  if (embed.video?.url && embed.video.kind === "direct") {
    return [
      {
        type: "video",
        url: embed.video.url,
        width: embed.video.width,
        height: embed.video.height,
        thumbnailUrl: embed.thumbnail?.url,
        contentType: embed.video.contentType,
        durationSeconds: embed.video.durationSeconds,
      },
    ];
  }

  return [];
}

function getTikTokFallbackTitle(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.includes("/photo/")) return "TikTok slideshow";
    if (pathname.includes("/video/")) return "TikTok video";
    return "TikTok";
  } catch {
    return "TikTok";
  }
}

function normalizeTikTokCaptionCandidate(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTikTokCaptionComparison(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function extractTikTokAuthorHandle(author?: EmbedAuthor): string | null {
  const authorUrl = author?.url;
  if (!authorUrl) return null;

  try {
    const pathname = new URL(authorUrl).pathname;
    const handle = pathname.match(/\/@([^/]+)/)?.[1]?.trim();
    return handle ? `@${handle}` : null;
  } catch {
    return null;
  }
}

function getTikTokAuthorCaptionCandidates(embed: EmbedInfo): string[] {
  const handle = extractTikTokAuthorHandle(embed.author);
  return [
    normalizeTikTokCaptionCandidate(embed.author?.name),
    handle,
    handle?.replace(/^@/, "") ?? null,
  ].filter((candidate): candidate is string => candidate !== null);
}

function isTikTokCaptionDuplicateOfAuthor(
  value: string,
  embed: EmbedInfo,
): boolean {
  const normalizedValue = normalizeTikTokCaptionComparison(value);
  const authorCandidates = getTikTokAuthorCaptionCandidates(embed).map(
    normalizeTikTokCaptionComparison,
  );

  return authorCandidates.includes(normalizedValue);
}

function getTikTokHashtagsOnlyCaption(
  value: string,
  embed: EmbedInfo,
): string | undefined {
  const hashtags = value.match(/#[^\s#]+/g);
  if (!hashtags || hashtags.length === 0) return undefined;

  const nonHashtagText = value
    .replace(/#[^\s#]+/g, " ")
    .replace(/[|,.;:/\\()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !nonHashtagText ||
    isTikTokCaptionDuplicateOfAuthor(nonHashtagText, embed)
  ) {
    return hashtags.join(" ");
  }

  return undefined;
}

function resolveTikTokCaptionCandidate(
  value: string | null | undefined,
  embed: EmbedInfo,
): string | undefined {
  const candidate = normalizeTikTokCaptionCandidate(value);
  if (!candidate) return undefined;
  if (candidate.toLowerCase().startsWith("tiktok")) return undefined;

  const hashtagsOnly = getTikTokHashtagsOnlyCaption(candidate, embed);
  if (hashtagsOnly) return hashtagsOnly;
  if (isTikTokCaptionDuplicateOfAuthor(candidate, embed)) return undefined;
  return candidate;
}

function getTikTokCaptionText(embed: EmbedInfo): string | undefined {
  return (
    resolveTikTokCaptionCandidate(embed.rawDescription, embed) ??
    resolveTikTokCaptionCandidate(embed.rawTitle, embed)
  );
}

function isWeakTikTokHydrationPayload(
  payload: TikTokHydrationPayload,
): boolean {
  const media = payload.media ?? [];
  const hasVideo =
    Boolean(payload.videoUrl) || media.some((entry) => entry.type === "video");
  const hasSlideshow =
    payload.postType === "slideshow" &&
    media.some((entry) => entry.type === "image");
  return !hasVideo && !hasSlideshow;
}

function embedHasDirectTikTokMedia(embed: EmbedInfo): boolean {
  return (
    Boolean(embed.media?.some((entry) => entry.type === "video")) ||
    Boolean(embed.video?.url && embed.video.kind === "direct")
  );
}

function hydrateTikTokEmbed(
  embed: EmbedInfo,
  payload: TikTokHydrationPayload | null,
): EmbedInfo {
  if (!payload) return embed;

  // A cover-only answer (tikwm fallback) must not replace a stored video.
  if (
    isWeakTikTokHydrationPayload(payload) &&
    embedHasDirectTikTokMedia(embed)
  ) {
    return {
      ...embed,
      author: embed.author
        ? {
            ...embed.author,
            iconURL: payload.authorAvatarUrl || embed.author.iconURL,
          }
        : embed.author,
      timestamp: embed.timestamp ?? payload.timestamp ?? undefined,
      audio: payload.audio ?? embed.audio ?? undefined,
    };
  }

  const media = payload.media?.length ? payload.media : embed.media;
  const firstVideo = media?.find((entry) => entry.type === "video");
  const firstMedia = media?.[0];
  const nextUrl = payload.canonicalUrl || embed.url;
  const slideshowThumbnailUrl = firstVideo?.thumbnailUrl;
  const nextThumbnailUrl =
    payload.postType === "slideshow"
      ? (slideshowThumbnailUrl ?? payload.coverUrl ?? embed.thumbnail?.url)
      : (payload.coverUrl ??
        embed.thumbnail?.url ??
        firstVideo?.thumbnailUrl ??
        firstMedia?.url);
  const nextThumbnail = nextThumbnailUrl
    ? {
        url: nextThumbnailUrl,
        width:
          embed.thumbnail?.width ??
          (firstMedia?.type === "image" ? firstMedia.width : firstVideo?.width),
        height:
          embed.thumbnail?.height ??
          (firstMedia?.type === "image"
            ? firstMedia.height
            : firstVideo?.height),
      }
    : embed.thumbnail;
  const nextAuthorUrl =
    embed.author?.url ||
    (payload.authorHandle
      ? `https://www.tiktok.com/@${payload.authorHandle}`
      : undefined);
  const nextAuthorName = embed.author?.name || payload.authorName;
  // Signed avatar URLs expire too: prefer the fresh one.
  const nextAuthorIcon =
    payload.authorAvatarUrl || embed.author?.iconURL || undefined;
  const nextAuthor = nextAuthorName
    ? {
        name: nextAuthorName,
        url: nextAuthorUrl,
        iconURL: nextAuthorIcon,
      }
    : embed.author;

  return {
    ...embed,
    url: nextUrl,
    rawTitle: embed.rawTitle ?? payload.title ?? undefined,
    rawDescription: embed.rawDescription ?? payload.title ?? undefined,
    thumbnail: nextThumbnail,
    media,
    video: payload.videoUrl
      ? {
          url: payload.videoUrl,
          width: firstVideo?.width ?? embed.video?.width ?? 720,
          height: firstVideo?.height ?? embed.video?.height ?? 1280,
          kind: "direct",
          contentType: embed.video?.contentType ?? "video/mp4",
          durationSeconds:
            embed.video?.durationSeconds ?? firstVideo?.durationSeconds,
        }
      : embed.video,
    author: nextAuthor,
    metrics: {
      ...embed.metrics,
      likes: embed.metrics?.likes ?? payload.likeCount ?? undefined,
      comments: embed.metrics?.comments ?? payload.commentCount ?? undefined,
      views: embed.metrics?.views ?? payload.viewCount ?? undefined,
    },
    timestamp: embed.timestamp ?? payload.timestamp ?? undefined,
    audio: payload.audio ?? embed.audio ?? undefined,
    footer: {
      text: "TikTok",
    },
  };
}

// ─── Portrait social (TikTok, Instagram) shared parts ──────────────────────

/** Avatar, name and verified mark under the header of a social post. */
function SocialAuthorRow({
  name,
  url,
  avatarSrc,
  verified,
  keyPrefix,
}: {
  name?: string;
  url?: string;
  avatarSrc?: string | null;
  verified?: boolean;
  keyPrefix: string;
}) {
  if (!name) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="size-8 shrink-0 overflow-hidden rounded-avatar bg-tint-3">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </span>
      <div className="flex min-w-0 items-center gap-1 text-ui-sm">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "relative min-w-0 truncate font-semibold text-ink-1 underline-offset-3 pointer-fine:hover:underline",
              HIT,
            )}
          >
            <EmbedInlineText text={name} keyPrefix={keyPrefix} />
          </a>
        ) : (
          <span className="min-w-0 truncate font-semibold text-ink-1">
            <EmbedInlineText text={name} keyPrefix={keyPrefix} />
          </span>
        )}
        {verified ? (
          <Icon
            name="verified"
            size="sm"
            label="Verified"
            className="shrink-0 text-accent-ink"
          />
        ) : null}
      </div>
    </div>
  );
}

/** Likes, comments and views as Num counts with 16px glyphs, in ink-2. */
function SocialMetrics({
  likes,
  comments,
  views,
}: {
  likes?: number;
  comments?: number;
  views?: number;
}) {
  const likeText = formatInstagramMetricCount(likes);
  const commentText = formatInstagramMetricCount(comments);
  const viewText = formatInstagramMetricCount(views);
  if (!likeText && !commentText && !viewText) return null;
  const item = "inline-flex items-center gap-1.5";
  return (
    <div className="flex items-center gap-4 text-ink-2">
      {likeText && (
        <span className={item} title="Likes">
          <Icon name="like" size="sm" />
          <Num size="sm">{likeText}</Num>
        </span>
      )}
      {commentText && (
        <span className={item} title="Comments">
          <Icon name="chat" size="sm" />
          <Num size="sm">{commentText}</Num>
        </span>
      )}
      {viewText && (
        <span className={item} title="Views">
          <Icon name="eye" size="sm" />
          <Num size="sm">{viewText}</Num>
        </span>
      )}
    </div>
  );
}

/**
 * Carousel chevrons and position dots over the media. Chevrons are ply-3
 * floats; a dot marks position with opacity and scale (never width).
 */
function CarouselControls({
  count,
  activeIndex,
  dotKeyPrefix,
  onPrev,
  onNext,
  onDot,
  onPointerDown,
}: {
  count: number;
  activeIndex: number;
  dotKeyPrefix: string;
  onPrev: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onNext: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDot: (event: React.MouseEvent<HTMLButtonElement>, index: number) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  if (count <= 1) return null;
  const chevron = cn(
    "absolute top-1/2 z-10 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full",
    MEDIA_FLOAT,
    HIT,
  );
  return (
    <>
      {activeIndex > 0 && (
        <button
          type="button"
          onClick={onPrev}
          onPointerDown={onPointerDown}
          className={cn(chevron, "left-2")}
          aria-label="Previous media"
        >
          <Icon name="chevronLeft" size="sm" />
        </button>
      )}
      {activeIndex < count - 1 && (
        <button
          type="button"
          onClick={onNext}
          onPointerDown={onPointerDown}
          className={cn(chevron, "right-2")}
          aria-label="Next media"
        >
          <Icon name="chevronRight" size="sm" />
        </button>
      )}
      <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center gap-1.5">
        {Array.from({ length: count }, (_, index) => (
          <button
            type="button"
            key={`${dotKeyPrefix}-${index}`}
            onClick={(event) => onDot(event, index)}
            onPointerDown={onPointerDown}
            aria-label={`Go to media ${index + 1}`}
            aria-current={index === activeIndex}
            className={cn(
              // Tall coarse target that tiles with its neighbours (6px dot +
              // 6px gap) instead of overlapping them.
              "relative size-1.5 rounded-full bg-ink-1 shadow-float transition-[opacity,scale] duration-(--dur-2) ease-out",
              HIT,
              "before:min-w-3",
              index === activeIndex ? "scale-133 opacity-100" : "opacity-45",
            )}
          />
        ))}
      </div>
    </>
  );
}

/** Track transform for a carousel: slides on --ease-in-out, follows a drag. */
function carouselTrackStyle(
  count: number,
  activeIndex: number,
  dragOffset: number,
  dragging: boolean,
): React.CSSProperties {
  const slideWidthPercent = count > 0 ? 100 / count : 100;
  return {
    width: `${Math.max(count, 1) * 100}%`,
    transform: `translate3d(calc(${-activeIndex * slideWidthPercent}% + ${dragOffset}px), 0, 0)`,
    transition: dragging ? "none" : "transform var(--dur-4) var(--ease-in-out)",
    willChange: "transform",
  };
}

/** The original-sound row under a post: artwork that plays, title, artist. */
function SocialAudioChip({
  audio,
  artworkSrc,
  playbackUrl,
  playing,
  audioRef,
  keyPrefix,
  onToggle,
  onAudioPlay,
  onAudioStop,
}: {
  audio: NonNullable<EmbedInfo["audio"]>;
  artworkSrc: string | null;
  playbackUrl: string | null;
  playing: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  keyPrefix: string;
  onToggle: () => void;
  onAudioPlay: () => void;
  onAudioStop: () => void;
}) {
  const artwork = artworkSrc ? (
    <img
      src={artworkSrc}
      alt=""
      className="size-full object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="flex size-full items-center justify-center text-ink-2">
      <Icon name="music" size="sm" />
    </span>
  );

  return (
    <div className="flex items-center gap-2 rounded-md bg-tint-1 p-2 text-ui-xs">
      {playbackUrl ? (
        <button
          type="button"
          onClick={onToggle}
          className="group/media relative size-10 shrink-0 overflow-hidden rounded-sm bg-tint-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label={playing ? "Pause audio preview" : "Play audio preview"}
        >
          {artwork}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-6 items-center justify-center rounded-full bg-ply-3 text-ink-1 shadow-float transition-colors duration-(--dur-1) ease-out pointer-fine:group-hover/media:bg-ply-4">
              <Icon
                name={playing ? "pause" : "play"}
                state="active"
                size="xs"
              />
            </span>
          </span>
        </button>
      ) : (
        <span className="size-10 shrink-0 overflow-hidden rounded-sm bg-tint-2">
          {artwork}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {audio.title && (
          <div className="truncate font-medium text-ink-1">
            <EmbedInlineText
              text={audio.title}
              keyPrefix={`${keyPrefix}-audio-title`}
            />
          </div>
        )}
        {audio.artist && (
          <div className="truncate text-ink-3">
            <EmbedInlineText
              text={audio.artist}
              keyPrefix={`${keyPrefix}-audio-artist`}
            />
          </div>
        )}
      </div>
      {playbackUrl && (
        <audio
          ref={audioRef}
          src={playbackUrl}
          preload="none"
          onPlay={onAudioPlay}
          onPause={onAudioStop}
          onEnded={onAudioStop}
        />
      )}
    </div>
  );
}

const TikTokEmbed = memo(
  ({
    embed,
    onMediaPlay,
    onMediaStop,
    messageId,
    onJumpToMessage,
  }: {
    embed: EmbedInfo;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
    messageId?: string;
    onJumpToMessage?: (messageId: string) => void;
  }) => {
    const tiktokHydrationKey = hydrationKey("/api/tiktok-video", embed.url);
    // Read once per mount; the key cannot change (the card is keyed on it).
    const [cachedHydration] = useState(() =>
      peekEmbedHydration<TikTokHydrationPayload>(tiktokHydrationKey),
    );
    const [hydratedPayload, setHydratedPayload] =
      useState<TikTokHydrationPayload | null>(() =>
        cachedHydration?.status === "ok" ? cachedHydration.payload : null,
      );
    const [player, setPlayer] = useState<TikTokPlayerState>(() =>
      cachedHydration?.status === "missing"
        ? { mode: "missing" }
        : cachedHydration?.status === "ok"
          ? { mode: "ready" }
          : {
              mode:
                getTikTokRenderableMedia(embed).length === 0
                  ? "loading"
                  : "idle",
            },
    );
    const [activeIndex, setActiveIndex] = useState(0);
    const [measuredMediaDimensions, setMeasuredMediaDimensions] = useState<
      Record<string, MediaDimensions>
    >({});
    const [dragOffset, setDragOffset] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isAudioPlaying, setIsAudioPlaying] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const audioActiveRef = useRef(false);
    const fetchedRef = useRef(false);
    const suppressViewerClickRef = useRef(false);
    const handledPointerOpenRef = useRef(false);
    const dragStateRef = useRef<{
      pointerId: number | null;
      startX: number;
      deltaX: number;
      pressedImageIndex: number | null;
    }>({
      pointerId: null,
      startX: 0,
      deltaX: 0,
      pressedImageIndex: null,
    });
    const { open } = useImageViewerActions();
    const hydrationSignature = useMemo(
      () => getTikTokHydrationSignature(embed),
      [embed],
    );
    const displayEmbed = useMemo<EmbedInfo>(() => {
      const hydratedEmbed = hydrateTikTokEmbed(embed, hydratedPayload);
      if (hydratedEmbed.rawTitle || hydratedEmbed.rawDescription) {
        return hydratedEmbed;
      }

      return {
        ...hydratedEmbed,
        rawTitle: getTikTokFallbackTitle(hydratedEmbed.url),
      };
    }, [embed, hydratedPayload]);
    const media = useMemo(
      () => getTikTokRenderableMedia(displayEmbed),
      [displayEmbed],
    );
    const resolvedMedia = useMemo(
      () =>
        media.map((item, index) => {
          const measured =
            measuredMediaDimensions[getEmbedMediaKey(item, index)];
          if (!measured || (item.width && item.height)) return item;

          return {
            ...item,
            width: measured.width,
            height: measured.height,
          };
        }),
      [media, measuredMediaDimensions],
    );
    const resolvedActiveIndex = Math.min(
      activeIndex,
      Math.max(media.length - 1, 0),
    );
    const viewerAttachments = useMemo(
      () =>
        mediaToAttachments(resolvedMedia, displayEmbed.url, messageId, {
          filenamePrefix: "tiktok",
          proxyAllMedia: true,
        }),
      [displayEmbed.url, resolvedMedia, messageId],
    );
    const activeMedia = resolvedMedia[resolvedActiveIndex] ?? resolvedMedia[0];
    const captionText = getTikTokCaptionText(displayEmbed);
    const likeCount = displayEmbed.metrics?.likes;
    const commentCount = displayEmbed.metrics?.comments;
    const viewCount = displayEmbed.metrics?.views;
    const slideWidthPercent = media.length > 0 ? 100 / media.length : 100;
    const isMissing = player.mode === "missing";
    const audioArtworkSrc =
      !isMissing && displayEmbed.audio?.artworkUrl
        ? getAuthAssetUrl(
            buildProxyMediaPath(
              displayEmbed.audio.artworkUrl,
              displayEmbed.url,
            ),
          )
        : null;
    const audioPlaybackUrl =
      !isMissing && displayEmbed.audio?.url
        ? getMediaUrl(
            buildProxyMediaPath(displayEmbed.audio.url, displayEmbed.url),
          )
        : null;
    const aspectRatioStyle =
      activeMedia?.width && activeMedia?.height
        ? `${activeMedia.width}/${activeMedia.height}`
        : displayEmbed.thumbnail?.width && displayEmbed.thumbnail?.height
          ? `${displayEmbed.thumbnail.width}/${displayEmbed.thumbnail.height}`
          : "9/16";
    const hasPersistentInlineMedia =
      media.length > 0 && media.every((item) => item.type === "image");
    const hasDirectVideoMedia =
      resolvedMedia.some((item) => item.type === "video") ||
      displayEmbed.video?.kind === "direct";
    const hasRenderableMedia =
      !isMissing &&
      media.length > 0 &&
      (hasPersistentInlineMedia || player.mode !== "iframe");
    const iframeUrl =
      displayEmbed.video?.kind === "player"
        ? withTikTokPlayerOptions(displayEmbed.video.url)
        : (() => {
            const videoId = getTikTokVideoId(displayEmbed.url);
            return videoId
              ? withTikTokPlayerOptions(
                  `https://www.tiktok.com/player/v1/${videoId}`,
                )
              : null;
          })();

    useEffect(() => {
      if (!embed.url || fetchedRef.current) return;
      // Already answered from the shared cache in the initial state.
      if (cachedHydration) {
        fetchedRef.current = true;
        return;
      }

      fetchedRef.current = true;
      let isActive = true;

      // Shared across mounts: a card scrolled back into view (the list is
      // virtualised) reuses the answer instead of fetching again.
      void loadEmbedHydration<TikTokHydrationPayload>(
        tiktokHydrationKey,
        apiUrl(`/api/tiktok-video?videoUrl=${encodeURIComponent(embed.url)}`),
      ).then((result) => {
        if (!isActive) return;
        if (result.status === "missing") {
          setPlayer({ mode: "missing" });
          return;
        }
        const payload = result.status === "ok" ? result.payload : null;
        if (payload) setHydratedPayload(payload);
        setPlayer(
          payload &&
            (payload.videoUrl ||
              payload.media?.length ||
              payload.coverUrl ||
              payload.audio ||
              payload.title)
            ? { mode: "ready" }
            : hasPersistentInlineMedia || hasDirectVideoMedia
              ? { mode: "error" }
              : { mode: "iframe" },
        );
      });

      return () => {
        isActive = false;
      };
    }, [
      cachedHydration,
      embed.url,
      hasDirectVideoMedia,
      hasPersistentInlineMedia,
      hydrationSignature,
      tiktokHydrationKey,
    ]);

    const handleVideoError = useCallback(() => {
      setPlayer(hasDirectVideoMedia ? { mode: "error" } : { mode: "iframe" });
    }, [hasDirectVideoMedia]);

    const goToIndex = useCallback(
      (index: number) => {
        if (media.length === 0) return;
        const bounded = Math.max(0, Math.min(index, media.length - 1));
        setActiveIndex(bounded);
        setDragOffset(0);
      },
      [media.length],
    );

    const openViewer = useCallback(
      (index: number) => {
        if (viewerAttachments.length === 0) return;

        const context: ViewerContext = {
          username: displayEmbed.author?.name,
          avatar_url: displayEmbed.author?.iconURL
            ? buildProxyMediaPath(displayEmbed.author.iconURL, displayEmbed.url)
            : null,
          avatar_display: null,
          created_at: displayEmbed.timestamp,
          onJumpToMessage,
          onIndexChange: goToIndex,
        };

        open(viewerAttachments, index, context);
      },
      [
        displayEmbed.author,
        displayEmbed.timestamp,
        displayEmbed.url,
        goToIndex,
        onJumpToMessage,
        open,
        viewerAttachments,
      ],
    );

    const showPrev = useCallback(() => {
      goToIndex(resolvedActiveIndex - 1);
    }, [goToIndex, resolvedActiveIndex]);

    const showNext = useCallback(() => {
      goToIndex(resolvedActiveIndex + 1);
    }, [goToIndex, resolvedActiveIndex]);

    const getPressedImageIndex = useCallback(
      (target: EventTarget | null): number | null => {
        if (!(target instanceof HTMLElement)) return null;
        const indexText = target.closest<HTMLElement>(
          "[data-tiktok-image-index]",
        )?.dataset.tiktokImageIndex;
        if (!indexText) return null;

        const index = Number(indexText);
        return Number.isInteger(index) && index >= 0 ? index : null;
      },
      [],
    );

    const handleCarouselKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          showPrev();
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          showNext();
        }
      },
      [showNext, showPrev],
    );

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.isPrimary || event.button !== 0) return;

        suppressViewerClickRef.current = false;
        handledPointerOpenRef.current = false;
        setIsDragging(true);
        dragStateRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          deltaX: 0,
          pressedImageIndex: getPressedImageIndex(event.target),
        };

        if (media.length > 1) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      },
      [getPressedImageIndex, media.length],
    );

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragStateRef.current.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - dragStateRef.current.startX;
        dragStateRef.current.deltaX = deltaX;
        if (Math.abs(deltaX) > 8) {
          suppressViewerClickRef.current = true;
        }
        setDragOffset(deltaX);
      },
      [],
    );

    const handlePointerEnd = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragStateRef.current.pointerId !== event.pointerId) return;
        const width = event.currentTarget.clientWidth || 1;
        const threshold = Math.max(48, width * 0.18);
        const deltaX = dragStateRef.current.deltaX;
        const pressedImageIndex = dragStateRef.current.pressedImageIndex;

        dragStateRef.current = {
          pointerId: null,
          startX: 0,
          deltaX: 0,
          pressedImageIndex: null,
        };
        setDragOffset(0);
        setIsDragging(false);

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }

        if (deltaX <= -threshold) {
          handledPointerOpenRef.current = true;
          showNext();
          return;
        }
        if (deltaX >= threshold) {
          handledPointerOpenRef.current = true;
          showPrev();
          return;
        }

        if (pressedImageIndex !== null) {
          handledPointerOpenRef.current = true;
          openViewer(pressedImageIndex);
        }
      },
      [openViewer, showNext, showPrev],
    );

    const handleImageClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>, index: number) => {
        event.stopPropagation();
        if (handledPointerOpenRef.current) {
          handledPointerOpenRef.current = false;
          return;
        }
        if (suppressViewerClickRef.current) {
          suppressViewerClickRef.current = false;
          return;
        }
        openViewer(index);
      },
      [openViewer],
    );

    const handleImageKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openViewer(index);
      },
      [openViewer],
    );

    const handlePrevButtonClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        showPrev();
      },
      [showPrev],
    );

    const handleNextButtonClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        showNext();
      },
      [showNext],
    );

    const handleDotClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>, index: number) => {
        event.stopPropagation();
        goToIndex(index);
      },
      [goToIndex],
    );

    const preventNativeDrag = useCallback(
      (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
      },
      [],
    );

    const stopChromePointerPropagation = useCallback(
      (event: React.PointerEvent<HTMLElement>) => {
        event.stopPropagation();
      },
      [],
    );

    const handleAudioToggle = useCallback(async () => {
      const audioElement = audioRef.current;
      if (!audioElement) return;

      if (audioElement.paused) {
        try {
          await audioElement.play();
          setIsAudioPlaying(true);
          audioActiveRef.current = true;
          onMediaPlay?.();
        } catch {
          setIsAudioPlaying(false);
        }
        return;
      }

      audioElement.pause();
      setIsAudioPlaying(false);
      if (audioActiveRef.current) {
        audioActiveRef.current = false;
        onMediaStop?.();
      }
    }, [onMediaPlay, onMediaStop]);

    useEffect(
      () => () => {
        audioRef.current?.pause();
        if (audioActiveRef.current) {
          audioActiveRef.current = false;
          onMediaStop?.();
        }
      },
      [onMediaStop],
    );

    const handleMediaImageLoad = useCallback(
      (mediaKey: string, event: React.SyntheticEvent<HTMLImageElement>) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (!naturalWidth || !naturalHeight) return;

        setMeasuredMediaDimensions((previous) => {
          const existing = previous[mediaKey];
          if (
            existing?.width === naturalWidth &&
            existing.height === naturalHeight
          ) {
            return previous;
          }

          return {
            ...previous,
            [mediaKey]: {
              width: naturalWidth,
              height: naturalHeight,
            },
          };
        });
      },
      [],
    );

    useEffect(() => {
      const audioElement = audioRef.current;
      if (!audioElement) return;
      audioElement.pause();
      audioElement.currentTime = 0;
    }, [audioPlaybackUrl]);

    useEffect(
      () => () => {
        audioRef.current?.pause();
      },
      [],
    );

    const handleAudioStopped = useCallback(() => {
      setIsAudioPlaying(false);
      if (audioActiveRef.current) {
        audioActiveRef.current = false;
        onMediaStop?.();
      }
    }, [onMediaStop]);

    return (
      <BaseEmbed embed={displayEmbed} width="compact" bare>
        <article ref={containerRef} className="flex flex-col gap-2">
          <EmbedHeader
            provider="TikTok"
            color={displayEmbed.color}
            timestamp={displayEmbed.timestamp}
            openHref={displayEmbed.url}
            openLabel="Open in TikTok"
          />

          <SocialAuthorRow
            name={displayEmbed.author?.name}
            url={displayEmbed.author?.url}
            avatarSrc={
              !isMissing && displayEmbed.author?.iconURL
                ? getAuthAssetUrl(
                    buildProxyMediaPath(
                      displayEmbed.author.iconURL,
                      displayEmbed.url,
                    ),
                  )
                : null
            }
            keyPrefix={`${embed.id}-tiktok-author`}
          />

          {hasRenderableMedia ? (
            <>
              <div className="relative overflow-hidden rounded-md bg-black">
                <div
                  ref={trackRef}
                  className="relative w-full overflow-hidden"
                  style={{
                    aspectRatio: aspectRatioStyle,
                    maxHeight: EMBED_PORTRAIT_MAX_HEIGHT,
                    touchAction: media.length > 1 ? "pan-y" : undefined,
                  }}
                  tabIndex={media.length > 1 ? 0 : -1}
                  onKeyDown={handleCarouselKeyDown}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerEnd}
                  onPointerCancel={handlePointerEnd}
                >
                  <div
                    data-testid="tiktok-carousel-track"
                    className="flex h-full"
                    style={carouselTrackStyle(
                      media.length,
                      resolvedActiveIndex,
                      dragOffset,
                      isDragging,
                    )}
                  >
                    {resolvedMedia.map((item, index) => {
                      const mediaKey = getEmbedMediaKey(item, index);
                      const imageSrc = getAuthAssetUrl(
                        buildProxyMediaPath(item.url, displayEmbed.url),
                      );
                      const videoSrc = getMediaUrl(
                        buildProxyMediaPath(item.url, displayEmbed.url),
                      );
                      const posterSrc = item.thumbnailUrl
                        ? getAuthAssetUrl(
                            buildProxyMediaPath(
                              item.thumbnailUrl,
                              displayEmbed.url,
                            ),
                          )
                        : displayEmbed.thumbnail?.url
                          ? getAuthAssetUrl(
                              buildProxyMediaPath(
                                displayEmbed.thumbnail.url,
                                displayEmbed.url,
                              ),
                            )
                          : undefined;
                      return (
                        <div
                          key={`${item.type}-${item.url}-${index}`}
                          data-media-element="true"
                          data-media-url={item.url}
                          data-media-download-url={
                            item.type === "video" ? videoSrc : imageSrc
                          }
                          className="relative h-full shrink-0 bg-black"
                          style={{ width: `${slideWidthPercent}%` }}
                        >
                          {item.type === "video" ? (
                            <div
                              className="flex h-full w-full items-center justify-center bg-black"
                              onPointerDown={stopChromePointerPropagation}
                            >
                              <DirectVideoEmbed
                                src={videoSrc}
                                filename={`tiktok-${index + 1}.mp4`}
                                maxWidth={4096}
                                maxHeight={4096}
                                aspectRatio={getAspectRatio(
                                  item.width,
                                  item.height,
                                )}
                                poster={posterSrc}
                                fallbackToPosterOnError={!!posterSrc}
                                referrerPolicy="no-referrer"
                                onVideoError={handleVideoError}
                                surfaceClassName="bg-black"
                                mediaClassName="h-full w-full object-contain"
                                showDurationBadge
                                durationBadgeSeconds={item.durationSeconds}
                                embeddedChrome={false}
                                onPlay={onMediaPlay}
                                onStop={onMediaStop}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(event) =>
                                handleImageClick(event, index)
                              }
                              onKeyDown={(event) =>
                                handleImageKeyDown(event, index)
                              }
                              onDragStart={preventNativeDrag}
                              className="block h-full w-full cursor-zoom-in select-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                              aria-label={`Open media ${index + 1} of ${resolvedMedia.length}`}
                              data-tiktok-image-index={index}
                            >
                              <img
                                src={imageSrc}
                                alt={
                                  item.altText ||
                                  displayEmbed.rawTitle ||
                                  "TikTok slideshow media"
                                }
                                className="h-full w-full object-contain"
                                loading={index === 0 ? "eager" : "lazy"}
                                referrerPolicy="no-referrer"
                                draggable={false}
                                onLoad={(event) =>
                                  handleMediaImageLoad(mediaKey, event)
                                }
                                onDragStart={preventNativeDrag}
                              />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <CarouselControls
                    count={resolvedMedia.length}
                    activeIndex={resolvedActiveIndex}
                    dotKeyPrefix={`${embed.id}-tiktok-dot`}
                    onPrev={handlePrevButtonClick}
                    onNext={handleNextButtonClick}
                    onDot={handleDotClick}
                    onPointerDown={stopChromePointerPropagation}
                  />
                </div>
              </div>

              <SocialMetrics
                likes={likeCount}
                comments={commentCount}
                views={viewCount}
              />

              {captionText && (
                <p className="text-ui-sm leading-5 text-pretty break-words text-ink-1">
                  <EmbedInlineText
                    text={captionText}
                    keyPrefix={`${embed.id}-tiktok-caption`}
                    linkClassName={EMBED_TEXT_LINK}
                  />
                </p>
              )}

              {displayEmbed.audio &&
                (displayEmbed.audio.title || displayEmbed.audio.artist) && (
                  <SocialAudioChip
                    audio={displayEmbed.audio}
                    artworkSrc={audioArtworkSrc}
                    playbackUrl={audioPlaybackUrl}
                    playing={isAudioPlaying}
                    audioRef={audioRef}
                    keyPrefix={`${embed.id}-tiktok`}
                    onToggle={handleAudioToggle}
                    onAudioPlay={() => setIsAudioPlaying(true)}
                    onAudioStop={handleAudioStopped}
                  />
                )}
            </>
          ) : (
            <div
              className={cn(
                "relative overflow-hidden rounded-md",
                isMissing ? "bg-tint-1" : "bg-black",
              )}
              style={{
                aspectRatio: "9/16",
                maxHeight: EMBED_PORTRAIT_MAX_HEIGHT,
              }}
            >
              {isMissing ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <img
                    src={SOCIAL_UNAVAILABLE_IMAGE}
                    alt=""
                    data-testid="tiktok-unavailable"
                    className="size-36 rounded-xl"
                    draggable={false}
                  />
                  <p className="text-ui-sm font-medium text-ink-2">
                    This TikTok is no longer available
                  </p>
                </div>
              ) : null}
              {(player.mode === "iframe" || player.mode === "ready") &&
                iframeUrl && (
                  <iframe
                    src={iframeUrl}
                    className="absolute inset-0 h-full w-full border-0"
                    allow="fullscreen; autoplay"
                    allowFullScreen
                    loading="lazy"
                    onLoad={onMediaPlay}
                    sandbox={EMBED_PLAYER_SANDBOX}
                    title={displayEmbed.rawTitle || "TikTok video"}
                  />
                )}

              {(player.mode === "iframe" || player.mode === "ready") &&
                !iframeUrl && (
                  <a
                    href={displayEmbed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group/media absolute inset-0 flex items-center justify-center outline-none"
                    title="Open in TikTok"
                    aria-label="Open in TikTok"
                  >
                    <span className="flex size-12 items-center justify-center rounded-full border border-line bg-ply-3 text-ink-1 shadow-float transition-colors duration-(--dur-1) ease-out pointer-fine:group-hover/media:bg-ply-4 group-focus-visible/media:outline-2 group-focus-visible/media:outline-offset-2 group-focus-visible/media:outline-focus">
                      <Icon name="externalLink" size="lg" />
                    </span>
                  </a>
                )}

              {(player.mode === "idle" ||
                player.mode === "loading" ||
                player.mode === "error") && (
                <>
                  {displayEmbed.thumbnail?.url && (
                    <img
                      src={getAuthAssetUrl(
                        buildProxyMediaPath(
                          displayEmbed.thumbnail.url,
                          displayEmbed.url,
                        ),
                      )}
                      alt={displayEmbed.rawTitle || "TikTok preview"}
                      className={cn(
                        "absolute inset-0 h-full w-full object-cover transition-opacity duration-(--dur-3) ease-out",
                        player.mode === "loading" ? "opacity-50" : undefined,
                      )}
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center">
                    {player.mode === "loading" ? (
                      <span className="flex size-12 items-center justify-center rounded-full border border-line bg-ply-3 text-ink-1 shadow-float">
                        <span
                          role="status"
                          aria-label="Loading TikTok"
                          className="rm-spinner size-5"
                        />
                      </span>
                    ) : (
                      <MediaPlayButton />
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </article>
      </BaseEmbed>
    );
  },
);

const SpotifyEmbed = memo(({ embed }: { embed: EmbedInfo }) => {
  const spotifyEmbedUrl = getSpotifyEmbedUrl(embed.url);
  const playerHeight = getSpotifyPlayerHeight(embed.url);

  // Spotify's player is its own card (art, colour, controls), so it renders
  // bare: no ply-2 fill, edge or padding around it (no card in a card), just
  // clipped to the embed radius at the compact width. Its default theme takes
  // its colour from the artwork, so it reads on every app theme without
  // sniffing which one is active.
  return (
    <EmbedFrame width="compact" bare>
      <iframe
        src={`${spotifyEmbedUrl}?utm_source=generator`}
        title="Spotify player"
        frameBorder="0"
        sandbox={EMBED_WIDGET_SANDBOX}
        allow="clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        className="block"
        style={{
          width: "100%",
          minWidth: 0,
          height: playerHeight,
        }}
        loading="lazy"
      />
    </EmbedFrame>
  );
});

const XReplyIcon = () => <Icon name="reply" size="sm" />;

const XRetweetIcon = () => <Icon name="repost" size="sm" />;

const XHeartIcon = () => <Icon name="like" size="sm" />;

const XImpressionsIcon = () => <Icon name="stats" size="sm" />;

function getXHandleFromUrl(url?: string): string | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    const handle = parsed.pathname.split("/").filter(Boolean)[0];
    return handle ? `@${handle.replace(/^@/, "")}` : undefined;
  } catch {
    return undefined;
  }
}

function getXAuthorParts(author?: EmbedAuthor): {
  displayName?: string;
  handle?: string;
} {
  if (!author?.name) {
    return { displayName: undefined, handle: getXHandleFromUrl(author?.url) };
  }

  const match = author.name.match(/^(.*?)\s+\(@([^)]+)\)$/);
  if (match) {
    return {
      displayName: match[1].trim(),
      handle: `@${match[2].trim().replace(/^@/, "")}`,
    };
  }

  return {
    displayName: author.name,
    handle: getXHandleFromUrl(author.url),
  };
}

function formatXMetricCount(value: number): string {
  if (value >= 1_000_000_000) {
    return `${trimMetricDecimal(value / 1_000_000_000)}B`;
  }

  if (value >= 1_000_000) {
    return `${trimMetricDecimal(value / 1_000_000)}M`;
  }

  if (value >= 1_000) {
    return `${trimMetricDecimal(value / 1_000)}K`;
  }

  return value.toLocaleString();
}

function trimMetricDecimal(value: number): string {
  const rounded =
    value >= 100
      ? value.toFixed(0)
      : value >= 10
        ? value.toFixed(1)
        : value.toFixed(1);
  return rounded.replace(/\.0$/, "");
}

const XMetricBar = memo(({ metrics }: { metrics?: EmbedMetrics }) => {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ReactElement;
  }> = [];

  if (metrics?.replies !== undefined) {
    items.push({
      key: "replies",
      label: "Replies",
      value: metrics.replies,
      icon: <XReplyIcon />,
    });
  }

  if (metrics?.retweets !== undefined) {
    items.push({
      key: "retweets",
      label: "Reposts",
      value: metrics.retweets,
      icon: <XRetweetIcon />,
    });
  }

  if (metrics?.likes !== undefined) {
    items.push({
      key: "likes",
      label: "Likes",
      value: metrics.likes,
      icon: <XHeartIcon />,
    });
  }

  if (metrics?.impressions !== undefined) {
    items.push({
      key: "impressions",
      label: "Impressions",
      value: metrics.impressions,
      icon: <XImpressionsIcon />,
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2 text-ink-3">
      {items.map((item) => {
        const formattedValue =
          item.value > 0 ? formatXMetricCount(item.value) : null;
        const rawValue = item.value.toLocaleString();

        return (
          <div
            key={item.key}
            className="inline-flex items-center gap-1.5"
            aria-label={`${item.label}: ${rawValue}`}
            title={`${item.label}: ${rawValue}`}
          >
            {item.icon}
            {formattedValue && <Num size="sm">{formattedValue}</Num>}
          </div>
        );
      })}
    </div>
  );
});

function getXExternalCardDomain(card?: EmbedExternalCard): string | null {
  if (card?.domain?.trim()) {
    return card.domain.trim();
  }

  if (!card?.url) return null;

  try {
    return new URL(card.url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

const XExternalCardChip = memo(
  ({ card, keyPrefix }: { card: EmbedExternalCard; keyPrefix: string }) => {
    const title = card.title?.trim();
    const fallbackLabel = getXExternalCardDomain(card) || card.url;
    const label = title || fallbackLabel;
    if (!label) return null;

    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-start p-3">
        <div className="max-w-full rounded-sm border border-line bg-ply-3 px-2 py-1 text-ui-xs text-ink-1 shadow-float">
          <span className="block max-w-full truncate">
            <EmbedInlineText
              text={label}
              keyPrefix={`${keyPrefix}-card-title`}
            />
          </span>
        </div>
      </div>
    );
  },
);

const XEmbed = memo(
  ({
    embed,
    messageId,
    onJumpToMessage,
    onMediaPlay,
    onMediaStop,
  }: {
    embed: EmbedInfo;
    messageId?: string;
    onJumpToMessage?: (messageId: string) => void;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
  }) => {
    const authorParts = useMemo(
      () => getXAuthorParts(embed.author),
      [embed.author],
    );
    const mainMedia = useMemo<EmbedMedia[]>(() => {
      if (Array.isArray(embed.media) && embed.media.length > 0) {
        return embed.media;
      }

      if (embed.video?.url && embed.video.kind !== "player") {
        return [
          {
            type: "video" as const,
            url: embed.video.url,
            width: embed.video.width,
            height: embed.video.height,
            thumbnailUrl: embed.thumbnail?.url,
            contentType: embed.video.contentType,
            durationSeconds: embed.video.durationSeconds,
          },
        ];
      }

      if (embed.thumbnail?.url) {
        return [
          {
            type: "image" as const,
            url: embed.thumbnail.url,
            width: embed.thumbnail.width,
            height: embed.thumbnail.height,
          },
        ];
      }

      return [];
    }, [embed.media, embed.thumbnail, embed.video]);
    const hasMainMedia = mainMedia.length > 0;
    const externalCardDomain = getXExternalCardDomain(embed.externalCard);
    const singleMediaOverlay =
      hasMainMedia && mainMedia.length === 1 && embed.externalCard ? (
        <XExternalCardChip
          card={embed.externalCard}
          keyPrefix={`${embed.id}-external-card`}
        />
      ) : undefined;

    return (
      <BaseEmbed embed={embed} width="standard" bare>
        <div className="flex flex-col gap-2">
          <EmbedHeader
            provider={embed.provider?.name || "X"}
            color={embed.color}
            timestamp={embed.timestamp}
            openHref={embed.url}
            openLabel="Open post on X"
          />

          {embed.author && (
            <div className="flex min-w-0 items-center gap-2">
              {embed.author.iconURL ? (
                <img
                  src={embed.author.iconURL}
                  alt=""
                  className="size-8 shrink-0 rounded-avatar bg-tint-3 object-cover"
                  loading="lazy"
                />
              ) : null}
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-ui-sm">
                <a
                  href={embed.author.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate font-semibold text-ink-1 underline-offset-3 pointer-fine:hover:underline"
                >
                  <EmbedInlineText
                    text={authorParts.displayName || embed.author.name}
                    keyPrefix={`${embed.id}-author-name`}
                  />
                </a>
                {authorParts.handle && (
                  <span className="min-w-0 truncate text-ink-3">
                    <EmbedInlineText
                      text={authorParts.handle}
                      keyPrefix={`${embed.id}-author-handle`}
                    />
                  </span>
                )}
              </div>
            </div>
          )}

          {embed.rawDescription && (
            <XStandaloneTweetText
              text={embed.rawDescription}
              keyPrefix={`${embed.id}-x-description`}
            />
          )}

          {hasMainMedia && (
            <XMediaGrid
              media={mainMedia}
              url={embed.url}
              author={embed.author}
              createdAt={embed.timestamp}
              singleMediaAlign="start"
              singleMediaChrome="framed"
              singleOverlay={singleMediaOverlay}
              messageId={messageId}
              onJumpToMessage={onJumpToMessage}
              onMediaPlay={onMediaPlay}
              onMediaStop={onMediaStop}
            />
          )}

          {hasMainMedia && externalCardDomain && embed.externalCard?.url && (
            <a
              href={embed.externalCard.url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit text-ui-xs text-ink-3 transition-colors duration-(--dur-1) ease-out pointer-fine:hover:text-ink-1"
            >
              <span>From </span>
              <span className="font-medium">{externalCardDomain}</span>
            </a>
          )}

          {embed.referencedTweet && (
            <XReferencedTweetCard
              tweet={embed.referencedTweet}
              compactMedia={hasMainMedia}
              onMediaPlay={onMediaPlay}
              onMediaStop={onMediaStop}
            />
          )}

          <XMetricBar metrics={embed.metrics} />
        </div>
      </BaseEmbed>
    );
  },
);

const XReferencedTweetCard = memo(
  ({
    tweet,
    compactMedia = true,
    onMediaPlay,
    onMediaStop,
  }: {
    tweet: NonNullable<EmbedInfo["referencedTweet"]>;
    compactMedia?: boolean;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
  }) => {
    const media = tweet.media ?? [];
    const authorParts = useMemo(
      () => getXAuthorParts(tweet.author),
      [tweet.author],
    );

    return (
      // A quote inside the card is a ruled block, not a second card: line
      // edge at radius 8 (concentric inside the 10 card), no fill.
      <div className="overflow-hidden rounded-md border border-line">
        <div className="flex flex-col gap-2 p-3">
          {tweet.author && (
            <div className="flex min-w-0 items-center gap-2">
              {tweet.author.iconURL ? (
                <img
                  src={tweet.author.iconURL}
                  alt=""
                  className="size-5 shrink-0 rounded-avatar bg-tint-3 object-cover"
                  loading="lazy"
                />
              ) : null}
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-ui-sm">
                <span className="min-w-0 truncate font-semibold text-ink-1">
                  <EmbedInlineText
                    text={authorParts.displayName || tweet.author.name}
                    keyPrefix={`${tweet.url || "tweet"}-author-name`}
                  />
                </span>
                {authorParts.handle && (
                  <span className="min-w-0 truncate text-ink-3">
                    <EmbedInlineText
                      text={authorParts.handle}
                      keyPrefix={`${tweet.url || "tweet"}-author-handle`}
                    />
                  </span>
                )}
                {tweet.timestamp ? (
                  <>
                    <span aria-hidden="true" className="text-ui-xs text-ink-3">
                      ·
                    </span>
                    <EmbedDate value={tweet.timestamp} />
                  </>
                ) : null}
              </div>
              {tweet.url && (
                <EmbedOpenButton
                  href={tweet.url}
                  label="Open quoted post on X"
                  className="-my-1 -mr-1"
                />
              )}
            </div>
          )}
          {tweet.rawDescription && (
            <XReferencedTweetText
              text={tweet.rawDescription}
              keyPrefix={`${tweet.url || "tweet"}-description`}
            />
          )}

          {media.length > 0 && (
            <XMediaGrid
              media={media}
              url={tweet.url}
              author={tweet.author}
              createdAt={tweet.timestamp}
              compact={compactMedia}
              singleMediaAlign="center"
              singleMediaChrome="plain"
              onMediaPlay={onMediaPlay}
              onMediaStop={onMediaStop}
            />
          )}
        </div>
      </div>
    );
  },
);

const XExpandableText = memo(
  ({
    text,
    keyPrefix,
    collapsedLinesClassName,
    estimatedCollapsedLines,
    estimatedCollapsedChars,
    textClassName,
    collapsedLabel,
    expandedLabel,
    expandAriaLabel,
    collapseAriaLabel,
    buttonClassName,
  }: {
    text: string;
    keyPrefix: string;
    collapsedLinesClassName: "line-clamp-4" | "line-clamp-5";
    estimatedCollapsedLines: number;
    estimatedCollapsedChars: number;
    textClassName: string;
    collapsedLabel: string;
    expandedLabel: string;
    expandAriaLabel: string;
    collapseAriaLabel: string;
    buttonClassName: string;
  }) => {
    const [expanded, setExpanded] = useState(false);
    const [canExpand, setCanExpand] = useState(() =>
      shouldCollapseXText(
        text,
        estimatedCollapsedLines,
        estimatedCollapsedChars,
      ),
    );
    const textRef = useRef<HTMLDivElement>(null);
    const lastTextRef = useRef(text);

    const measureOverflow = useCallback(() => {
      const node = textRef.current;
      if (!node) return;

      const nextClientHeight = node.clientHeight;
      const nextScrollHeight = node.scrollHeight;
      if (nextClientHeight === 0 && nextScrollHeight === 0) return;

      setCanExpand(nextScrollHeight > nextClientHeight + 1);
    }, []);

    useSafeLayoutEffect(() => {
      if (lastTextRef.current !== text) {
        lastTextRef.current = text;
        setExpanded(false);
        setCanExpand(
          shouldCollapseXText(
            text,
            estimatedCollapsedLines,
            estimatedCollapsedChars,
          ),
        );
        return;
      }

      if (expanded) return;

      measureOverflow();

      const node = textRef.current;
      if (!node) return;

      const resizeObserver =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              measureOverflow();
            })
          : null;

      resizeObserver?.observe(node);
      window.addEventListener("resize", measureOverflow);

      return () => {
        resizeObserver?.disconnect();
        window.removeEventListener("resize", measureOverflow);
      };
    }, [
      expanded,
      estimatedCollapsedChars,
      estimatedCollapsedLines,
      measureOverflow,
      text,
    ]);

    return (
      <div className="flex flex-col gap-1">
        <div
          ref={textRef}
          data-x-expandable-text="true"
          className={cn(textClassName, !expanded && collapsedLinesClassName)}
        >
          <EmbedInlineText
            text={text}
            keyPrefix={keyPrefix}
            linkClassName={EMBED_TEXT_LINK}
            compactUrls
          />
        </div>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-label={expanded ? collapseAriaLabel : expandAriaLabel}
            data-expanded={expanded}
            className={buttonClassName}
          >
            {expanded ? expandedLabel : collapsedLabel}
          </button>
        )}
      </div>
    );
  },
);

const XStandaloneTweetText = memo(
  ({ text, keyPrefix }: { text: string; keyPrefix: string }) => (
    <XExpandableText
      text={text}
      keyPrefix={keyPrefix}
      collapsedLinesClassName="line-clamp-5"
      estimatedCollapsedLines={X_STANDALONE_TWEET_COLLAPSED_LINES}
      estimatedCollapsedChars={X_STANDALONE_TWEET_COLLAPSED_CHAR_THRESHOLD}
      textClassName="text-ui-sm leading-5 text-pretty whitespace-pre-wrap break-words text-ink-1"
      collapsedLabel="Show more"
      expandedLabel="Show less"
      expandAriaLabel="Expand post text"
      collapseAriaLabel="Collapse post text"
      buttonClassName="inline-flex w-fit items-center rounded-xs text-ui-sm font-medium text-accent-ink underline-offset-3 outline-none pointer-fine:hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    />
  ),
);

const XReferencedTweetText = memo(
  ({ text, keyPrefix }: { text: string; keyPrefix: string }) => (
    <XExpandableText
      text={text}
      keyPrefix={keyPrefix}
      collapsedLinesClassName="line-clamp-4"
      estimatedCollapsedLines={X_REFERENCED_TWEET_COLLAPSED_LINES}
      estimatedCollapsedChars={X_REFERENCED_TWEET_COLLAPSED_CHAR_THRESHOLD}
      textClassName="text-ui-sm leading-5 text-pretty whitespace-pre-wrap break-words text-ink-1"
      collapsedLabel="..."
      expandedLabel="Show less"
      expandAriaLabel="Expand quoted post text"
      collapseAriaLabel="Collapse quoted post text"
      buttonClassName="inline-flex w-fit items-center rounded-xs px-1 text-ui-xs font-medium text-ink-3 outline-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[expanded=false]:tracking-[0.24em]"
    />
  ),
);

type XMediaAttachment = Attachment & {
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  sourceUrl?: string;
  durationSeconds?: number;
};

type XGifWebpState = "pending" | "ready" | "failed";

function getXGifStateKey(attachment: XMediaAttachment): string {
  return attachment.id || attachment.url || attachment.file_key;
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}

const XMediaGrid = memo(
  ({
    media,
    url,
    author,
    createdAt,
    compact = false,
    singleMediaAlign = "center",
    singleMediaChrome = "plain",
    singleOverlay,
    messageId,
    onJumpToMessage,
    onMediaPlay,
    onMediaStop,
  }: {
    media: EmbedMedia[];
    url?: string;
    author?: EmbedAuthor;
    createdAt?: string;
    compact?: boolean;
    singleMediaAlign?: "start" | "center";
    singleMediaChrome?: "framed" | "plain";
    singleOverlay?: React.ReactNode;
    messageId?: string;
    onJumpToMessage?: (messageId: string) => void;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
  }) => {
    const attachments = useMemo(
      () =>
        mediaToAttachments(media, url, messageId, {
          proxyAllMedia: true,
        }),
      [media, messageId, url],
    );
    const visibleAttachments = attachments.slice(0, 4);
    const extraCount = Math.max(
      0,
      attachments.length - visibleAttachments.length,
    );
    const count = visibleAttachments.length;
    const { open, updateImage } = useImageViewerActions();
    const [gifStates, setGifStates] = useState<Record<string, XGifWebpState>>(
      {},
    );
    const gifStatesRef = useRef(gifStates);
    useEffect(() => {
      gifStatesRef.current = gifStates;
    }, [gifStates]);

    const getViewerAttachment = useCallback(
      (
        attachment: XMediaAttachment,
        stateOverride?: XGifWebpState,
      ): XMediaAttachment => {
        const state =
          stateOverride ?? gifStatesRef.current[getXGifStateKey(attachment)];
        if (!attachment.isGif || state !== "ready") {
          return {
            ...attachment,
            filename: attachment.filename.replace(/\.webp$/i, ".mp4"),
            downloadUrl: undefined,
          };
        }

        const rawMediaUrl = unwrapProxyMediaUrl(
          attachment.url || attachment.file_key,
        );
        const webpUrl = getFxTwitterGifWebpUrl(rawMediaUrl);
        return {
          ...attachment,
          filename: attachment.filename.replace(/\.mp4$/i, ".webp"),
          downloadUrl: webpUrl
            ? getAuthAssetUrl(
                buildProxyMediaPath(webpUrl, attachment.sourceUrl),
              )
            : undefined,
        };
      },
      [],
    );

    const handleGifStateChange = useCallback(
      (key: string, state: XGifWebpState) => {
        setGifStates((current) =>
          current[key] === state ? current : { ...current, [key]: state },
        );
        const attachmentIndex = attachments.findIndex(
          (attachment) => getXGifStateKey(attachment) === key,
        );
        const attachment =
          attachmentIndex >= 0 ? attachments[attachmentIndex] : undefined;
        if (attachment) {
          updateImage?.(attachment.id, getViewerAttachment(attachment, state));
        }
      },
      [attachments, getViewerAttachment, updateImage],
    );

    const openViewer = (index: number) => {
      const context: ViewerContext = {
        username: author?.name,
        avatar_url: author?.iconURL ?? null,
        created_at: createdAt,
        onJumpToMessage,
      };
      const viewerAttachments = attachments.map((attachment) =>
        getViewerAttachment(attachment),
      );
      open(viewerAttachments, index, context);
    };

    const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openViewer(index);
    };

    if (count === 0) return null;

    if (count === 1) {
      return (
        <XMediaTile
          attachment={visibleAttachments[0]}
          index={0}
          onOpen={openViewer}
          onKeyDown={handleKeyDown}
          url={url}
          single
          compact={compact}
          singleMediaAlign={singleMediaAlign}
          singleMediaChrome={singleMediaChrome}
          overlay={singleOverlay}
          onMediaPlay={onMediaPlay}
          onMediaStop={onMediaStop}
          gifStateKey={getXGifStateKey(visibleAttachments[0])}
          gifWebpState={
            gifStates[getXGifStateKey(visibleAttachments[0])] ?? "pending"
          }
          onGifStateChange={handleGifStateChange}
        />
      );
    }

    const heightClass = compact
      ? "h-[140px] md:h-[180px]"
      : "h-[220px] md:h-[300px]";
    const gridClass =
      count === 2
        ? cn("grid-cols-2", heightClass)
        : cn("grid-cols-2 grid-rows-2", heightClass);

    return (
      <div
        className={cn(
          "grid max-w-full gap-1 overflow-hidden rounded-md border border-line bg-tint-1",
          gridClass,
        )}
      >
        {visibleAttachments.map((attachment, index) => (
          <XMediaTile
            key={attachment.id}
            attachment={attachment}
            index={index}
            onOpen={openViewer}
            onKeyDown={handleKeyDown}
            url={url}
            className={count === 3 && index === 0 ? "row-span-2" : undefined}
            extraCount={
              index === visibleAttachments.length - 1 ? extraCount : 0
            }
            compact={compact}
            singleMediaAlign={singleMediaAlign}
            singleMediaChrome={singleMediaChrome}
            onMediaPlay={onMediaPlay}
            onMediaStop={onMediaStop}
            gifStateKey={getXGifStateKey(attachment)}
            gifWebpState={gifStates[getXGifStateKey(attachment)] ?? "pending"}
            onGifStateChange={handleGifStateChange}
          />
        ))}
      </div>
    );
  },
);

const XMediaTile = memo(
  ({
    attachment,
    index,
    onOpen,
    onKeyDown,
    url,
    className = "",
    single = false,
    extraCount = 0,
    compact = false,
    singleMediaAlign = "center",
    singleMediaChrome = "plain",
    overlay,
    onMediaPlay,
    onMediaStop,
    gifStateKey,
    gifWebpState = "pending",
    onGifStateChange,
  }: {
    attachment: XMediaAttachment;
    index: number;
    onOpen: (index: number) => void;
    onKeyDown: (event: React.KeyboardEvent, index: number) => void;
    url?: string;
    className?: string;
    single?: boolean;
    extraCount?: number;
    compact?: boolean;
    singleMediaAlign?: "start" | "center";
    singleMediaChrome?: "framed" | "plain";
    overlay?: React.ReactNode;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
    gifStateKey: string;
    gifWebpState?: XGifWebpState;
    onGifStateChange?: (key: string, state: XGifWebpState) => void;
  }) => {
    const mediaUrl = getXAttachmentUrl(attachment);
    const isVideo = attachment.content_type?.startsWith("video/");
    const isGif = attachment.isGif === true;
    const [imageError, setImageError] = useState(false);
    const gifWebpReady = isGif && gifWebpState === "ready";
    const rawMediaUrl = unwrapProxyMediaUrl(mediaUrl);
    const gifMediaUrl = isGif ? getFxTwitterGifWebpUrl(rawMediaUrl) : null;
    const activeMediaUrl =
      gifMediaUrl && gifWebpReady ? gifMediaUrl : rawMediaUrl;
    const activeDownloadUrl =
      gifMediaUrl && gifWebpReady
        ? getAuthAssetUrl(
            buildProxyMediaPath(gifMediaUrl, attachment.sourceUrl),
          )
        : getAuthAssetUrl(mediaUrl);
    const handleWebpReady = useCallback(
      () => onGifStateChange?.(gifStateKey, "ready"),
      [gifStateKey, onGifStateChange],
    );
    const handleWebpError = useCallback(
      () => onGifStateChange?.(gifStateKey, "failed"),
      [gifStateKey, onGifStateChange],
    );
    const mediaContextProps = {
      "data-media-element": "true",
      "data-media-url": activeMediaUrl,
      "data-media-download-url": gifMediaUrl
        ? activeDownloadUrl
        : !isVideo && attachment.sourceUrl && /^https?:\/\//i.test(rawMediaUrl)
          ? getAuthAssetUrl(
              buildProxyMediaPath(rawMediaUrl, attachment.sourceUrl),
            )
          : getAuthAssetUrl(mediaUrl),
      "data-media-filename":
        gifMediaUrl && gifWebpReady
          ? attachment.filename.replace(/\.mp4$/i, ".webp")
          : attachment.filename.replace(/\.webp$/i, ".mp4"),
    };
    const singleObjectPositionClass =
      singleMediaAlign === "start" ? "object-left" : "object-center";
    const usesFramedSingleChrome = singleMediaChrome === "framed";
    const posterUrl =
      !isGif && attachment.thumbnailUrl
        ? getAuthAssetUrl(
            buildProxyMediaPath(attachment.thumbnailUrl, attachment.sourceUrl),
          )
        : undefined;
    const singleMaxWidth = compact ? 240 : 520;
    const singleMaxHeight = compact ? 180 : 420;

    const content = isVideo ? (
      isGif ? (
        <XGifTile
          attachment={attachment}
          src={mediaUrl}
          single={single}
          compact={compact}
          onOpenViewer={() => onOpen(index)}
          webpReady={gifWebpReady}
          onWebpReady={handleWebpReady}
          onWebpError={handleWebpError}
        />
      ) : (
        <div
          className={cn(
            "flex items-center",
            single
              ? singleMediaAlign === "start"
                ? "w-full max-w-full justify-start"
                : "w-full max-w-full justify-center"
              : "h-full w-full justify-center",
          )}
        >
          <GifFavoriteButton
            gif={createAttachmentClipFavorite({
              id: attachment.id || mediaUrl,
              filename: attachment.filename,
              fileKeyOrUrl: attachment.file_key || attachment.url,
              title: attachment.filename,
              sourceUrl: mediaUrl,
              previewUrl: mediaUrl,
              sendUrl: mediaUrl,
              width: attachment.width,
              height: attachment.height,
              sizeBytes: attachment.size_bytes,
            })}
          />
          <DirectVideoEmbed
            src={getMediaUrl(mediaUrl)}
            filename={attachment.filename}
            maxWidth={single ? singleMaxWidth : 520}
            maxHeight={single ? singleMaxHeight : 300}
            aspectRatio={getAspectRatio(attachment.width, attachment.height)}
            poster={posterUrl}
            fallbackToPosterOnError={!!posterUrl}
            referrerPolicy="no-referrer"
            surfaceClassName="bg-transparent"
            mediaClassName={single ? singleObjectPositionClass : undefined}
            showDurationBadge
            durationBadgeSeconds={attachment.durationSeconds}
            embeddedChrome={usesFramedSingleChrome}
            onPlay={onMediaPlay}
            onStop={onMediaStop}
          />
        </div>
      )
    ) : imageError ? (
      <div
        role="img"
        aria-label="Media unavailable"
        className={
          single
            ? compact
              ? `flex h-[180px] w-auto max-w-full items-center justify-center bg-tint-1 px-4 text-center text-ui-xs font-medium text-ink-3 ${singleObjectPositionClass}`
              : `flex h-[180px] max-h-[420px] w-auto max-w-full items-center justify-center bg-tint-1 px-4 text-center text-ui-xs font-medium text-ink-3 ${singleObjectPositionClass}`
            : "flex h-full min-h-40 w-full items-center justify-center bg-tint-1 px-4 text-center text-ui-xs font-medium text-ink-3"
        }
      >
        Media unavailable
      </div>
    ) : (
      <img
        src={mediaUrl}
        alt={attachment.filename}
        className={
          single
            ? compact
              ? `h-[180px] w-auto max-w-full object-contain ${singleObjectPositionClass}`
              : `h-auto max-h-[420px] w-auto max-w-full object-contain ${singleObjectPositionClass}`
            : "h-full w-full object-cover"
        }
        // Reserve the single image's box from its known size so the message
        // row does not grow (and the list jump) when the image arrives.
        style={
          single && !compact
            ? getXSingleImageBoxStyle(attachment.width, attachment.height)
            : undefined
        }
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImageError(true)}
      />
    );

    const wrapperClassName = cn(
      "relative overflow-hidden",
      single && singleMediaAlign === "center" ? "mx-auto" : "",
      single
        ? compact
          ? cn(
              "block h-[180px] max-w-[240px]",
              usesFramedSingleChrome &&
                "rounded-md border border-line bg-tint-1",
            )
          : cn(
              "block w-fit max-w-full",
              !isVideo &&
                usesFramedSingleChrome &&
                "rounded-md border border-line bg-tint-1",
              isVideo && usesFramedSingleChrome && "rounded-md",
            )
        : "block",
      !isVideo || isGif ? "cursor-zoom-in" : "",
      className,
    );

    if (!isVideo) {
      return (
        <button
          type="button"
          {...mediaContextProps}
          className={cn(
            wrapperClassName,
            "appearance-none p-0 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
          )}
          onClick={() => onOpen(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
          aria-label={isGif ? "Open GIF viewer" : "Open media viewer"}
          title={
            url ? (isGif ? "Open GIF viewer" : "Open media viewer") : undefined
          }
        >
          {content}
          {overlay}
          {extraCount > 0 && <MediaMoreOverlay count={extraCount} />}
        </button>
      );
    }

    if (isGif) {
      return (
        <div
          role="button"
          tabIndex={0}
          {...mediaContextProps}
          className={cn(
            wrapperClassName,
            "text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
          )}
          onClick={() => onOpen(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
          aria-label="Open GIF viewer"
          title={url ? "Open GIF viewer" : undefined}
        >
          {content}
          {overlay}
          {extraCount > 0 && <MediaMoreOverlay count={extraCount} />}
        </div>
      );
    }

    return (
      <div {...mediaContextProps} className={wrapperClassName}>
        {content}
        {overlay}
        {extraCount > 0 && <MediaMoreOverlay count={extraCount} />}
      </div>
    );
  },
);

const AnimatedWebpCanvas = memo(
  ({
    src,
    alt,
    className,
    paused,
    onError,
    onReady,
  }: {
    src: string;
    alt: string;
    className: string;
    paused: boolean;
    onError: () => void;
    onReady?: () => void;
  }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pausedRef = useRef(paused);
    const timerRef = useRef<number | null>(null);
    const decoderRef = useRef<ImageDecoder | null>(null);
    const drawNextFrameRef = useRef<(() => Promise<void>) | null>(null);
    const readyNotifiedRef = useRef(false);

    useEffect(() => {
      pausedRef.current = paused;
      if (paused) {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        return;
      }

      void drawNextFrameRef.current?.();
    }, [paused]);

    useEffect(() => {
      let cancelled = false;
      let decoding = false;
      const abortController = new AbortController();
      readyNotifiedRef.current = false;

      const clearTimer = () => {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };

      const start = async () => {
        if (typeof ImageDecoder === "undefined") {
          onError();
          return;
        }

        const response = await fetch(src, { signal: abortController.signal });
        if (!response.ok)
          throw new Error(`WebP request failed: ${response.status}`);

        const data = await response.arrayBuffer();
        if (cancelled) return;

        const decoder = new ImageDecoder({
          data,
          type: "image/webp",
          preferAnimation: true,
        });
        if (cancelled) {
          decoder.close();
          return;
        }
        decoderRef.current = decoder;
        await decoder.tracks.ready;
        if (cancelled) return;

        const track =
          decoder.tracks.selectedIndex >= 0
            ? decoder.tracks[decoder.tracks.selectedIndex]
            : undefined;
        if (!track?.animated || track.frameCount < 1) {
          throw new Error("WebP does not contain an animation track");
        }

        let frameIndex = 0;
        const drawNextFrame = async (allowWhilePaused = false) => {
          if (cancelled || decoding || (pausedRef.current && !allowWhilePaused))
            return;
          decoding = true;
          let image: VideoFrame | null = null;

          try {
            const result = await decoder.decode({
              frameIndex,
              completeFramesOnly: true,
            });
            image = result.image;
            if (cancelled || (pausedRef.current && !allowWhilePaused)) return;

            const canvas = canvasRef.current;
            const context = canvas?.getContext("2d");
            if (!canvas || !context) {
              throw new Error("Canvas is unavailable");
            }

            canvas.width = image.displayWidth;
            canvas.height = image.displayHeight;
            context.drawImage(
              image,
              0,
              0,
              image.displayWidth,
              image.displayHeight,
            );
            if (!readyNotifiedRef.current) {
              readyNotifiedRef.current = true;
              onReady?.();
            }

            const durationMs = Math.max(16, (image.duration ?? 100_000) / 1000);
            frameIndex = (frameIndex + 1) % track.frameCount;

            if (!cancelled && !pausedRef.current) {
              timerRef.current = window.setTimeout(
                () => void drawNextFrame(),
                durationMs,
              );
            }
          } catch {
            if (!cancelled) onError();
          } finally {
            image?.close();
            decoding = false;
          }
        };

        drawNextFrameRef.current = drawNextFrame;
        await drawNextFrame(true);
      };

      void start().catch(() => {
        if (!cancelled && !abortController.signal.aborted) onError();
      });

      return () => {
        cancelled = true;
        abortController.abort();
        clearTimer();
        drawNextFrameRef.current = null;
        decoderRef.current?.close();
        decoderRef.current = null;
      };
    }, [onError, onReady, src]);

    return (
      <canvas
        ref={canvasRef}
        className={className}
        data-src={src}
        role="img"
        aria-label={alt}
      />
    );
  },
);

const XGifTile = memo(
  ({
    attachment,
    src,
    single = false,
    compact = false,
    onOpenViewer,
    webpReady = false,
    onWebpReady,
    onWebpError,
  }: {
    attachment: XMediaAttachment;
    src: string;
    single?: boolean;
    compact?: boolean;
    onOpenViewer: () => void;
    webpReady?: boolean;
    onWebpReady?: () => void;
    onWebpError?: () => void;
  }) => {
    const [paused, setPaused] = useState(false);
    const [altPinned, setAltPinned] = useState(false);
    const [webpLoadError, setWebpLoadError] = useState(false);
    const [videoLoadError, setVideoLoadError] = useState(false);
    const [posterLoadError, setPosterLoadError] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const altControlRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = usePrefersReducedMotion();
    // Stop the loop while the app is hidden or behind a game (spec §5f);
    // it picks up again on return unless the user paused it.
    const appActive = useAppActive();
    const titleId = useId();
    const altTextId = useId();
    const altText = attachment.alt_text?.trim() || "";
    const hasAltText = altText.length > 0;
    const sourceUrl = unwrapProxyMediaUrl(src);
    const favoriteWebpUrl = getFxTwitterGifWebpUrl(sourceUrl);
    const webpSrc = favoriteWebpUrl
      ? getAuthAssetUrl(
          buildProxyMediaPath(favoriteWebpUrl, attachment.sourceUrl),
        )
      : null;
    const useWebp = Boolean(webpSrc) && !webpLoadError;
    const playbackPaused = paused || prefersReducedMotion;
    const loopStopped = playbackPaused || !appActive;
    const posterUrl = attachment.thumbnailUrl
      ? getAuthAssetUrl(
          buildProxyMediaPath(attachment.thumbnailUrl, attachment.sourceUrl),
        )
      : undefined;
    const favorite = createExternalGifFavorite({
      id: attachment.id || sourceUrl,
      title: attachment.filename || "X GIF",
      altText,
      sourceUrl,
      previewUrl: webpReady && favoriteWebpUrl ? favoriteWebpUrl : src,
      sendUrl: webpReady && favoriteWebpUrl ? favoriteWebpUrl : src,
      width: attachment.width,
      height: attachment.height,
      sizeBytes: attachment.size_bytes,
      contentType:
        webpReady && favoriteWebpUrl ? "image/webp" : attachment.content_type,
    });
    const singleMediaClass = compact
      ? "h-full w-full object-contain object-left"
      : "h-auto max-h-[420px] w-full object-contain object-left";
    const displayAltText = altText || attachment.filename;
    const mediaUnavailable = videoLoadError && (!posterUrl || posterLoadError);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      if (useWebp) return;

      if (loopStopped) {
        video.pause();
        return;
      }

      void video.play().catch(() => {
        // Browser/autoplay support decides whether inline GIF playback starts.
      });
    }, [loopStopped, useWebp]);

    useEffect(() => {
      if (!altPinned) return;

      const handlePointerDown = (event: MouseEvent) => {
        if (altControlRef.current?.contains(event.target as Node)) return;
        setAltPinned(false);
      };

      document.addEventListener("mousedown", handlePointerDown);
      return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [altPinned]);

    const handleTogglePaused = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setPaused((current) => !current);
    };

    const handleOpenViewer = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenViewer();
    };

    const handleToggleAlt = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setAltPinned((current) => !current);
    };

    const handleWebpError = useCallback(() => {
      setWebpLoadError(true);
      onWebpError?.();
    }, [onWebpError]);
    const handleWebpReady = useCallback(() => {
      onWebpReady?.();
    }, [onWebpReady]);

    return (
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center bg-transparent",
          single && !compact && "max-h-[420px]",
        )}
        data-x-gif="true"
      >
        {useWebp ? (
          <AnimatedWebpCanvas
            src={webpSrc || ""}
            alt={displayAltText}
            className={cn(
              single ? singleMediaClass : "h-full w-full object-contain",
            )}
            paused={loopStopped}
            onError={handleWebpError}
            onReady={handleWebpReady}
          />
        ) : videoLoadError && posterUrl && !posterLoadError ? (
          <img
            src={posterUrl}
            alt={displayAltText}
            className={cn(
              single ? singleMediaClass : "h-full w-full object-contain",
            )}
            loading="lazy"
            onError={() => setPosterLoadError(true)}
          />
        ) : mediaUnavailable ? (
          <div
            role="img"
            aria-label={`${displayAltText} unavailable`}
            className={cn(
              single ? singleMediaClass : "h-full w-full",
              "flex items-center justify-center bg-tint-1 px-4 text-center text-ui-xs font-medium text-ink-3",
            )}
          >
            GIF unavailable
          </div>
        ) : (
          <video
            ref={videoRef}
            src={src}
            poster={posterUrl}
            className={cn(
              single ? singleMediaClass : "h-full w-full object-contain",
            )}
            autoPlay={!prefersReducedMotion && appActive}
            loop
            muted
            playsInline
            preload="metadata"
            aria-label={displayAltText}
            onError={() => setVideoLoadError(true)}
          >
            <track kind="captions" />
          </video>
        )}
        {!mediaUnavailable && <GifFavoriteButton gif={favorite} />}
        {!mediaUnavailable && (
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleTogglePaused}
              disabled={prefersReducedMotion}
              className={cn(
                "relative flex size-7 items-center justify-center rounded-full disabled:opacity-45",
                MEDIA_FLOAT,
              )}
              aria-label={playbackPaused ? "Play GIF" : "Pause GIF"}
              title={
                prefersReducedMotion
                  ? "Animation disabled by reduced motion"
                  : playbackPaused
                    ? "Play GIF"
                    : "Pause GIF"
              }
            >
              <Icon
                name={playbackPaused ? "play" : "pause"}
                state="active"
                size="xs"
              />
              <span className="sr-only" id={titleId}>
                {playbackPaused ? "Play GIF" : "Pause GIF"}
              </span>
            </button>

            <button
              type="button"
              onClick={handleOpenViewer}
              className={cn(
                "flex h-7 items-center rounded-sm px-2 text-ui-2xs uppercase",
                MEDIA_FLOAT,
              )}
              aria-label="Open GIF viewer"
              title="Open GIF viewer"
            >
              GIF
            </button>

            {hasAltText && (
              <div className="group/x-gif-alt relative" ref={altControlRef}>
                <button
                  type="button"
                  onClick={handleToggleAlt}
                  className={cn(
                    "flex h-7 items-center rounded-sm px-2 text-ui-2xs uppercase",
                    MEDIA_FLOAT,
                  )}
                  aria-label="Show GIF alt text"
                  aria-controls={altTextId}
                  aria-expanded={altPinned}
                  title="Show GIF alt text"
                >
                  ALT
                </button>
                <div
                  id={altTextId}
                  className={cn(
                    "pointer-events-none absolute bottom-full left-0 mb-2 w-[min(18rem,calc(100vw-3rem))] rounded-lg border border-line bg-ply-3 px-3 py-2 text-ui-xs text-pretty text-ink-1 shadow-float transition-opacity duration-(--dur-2) ease-out pointer-fine:group-hover/x-gif-alt:opacity-100",
                    altPinned ? "opacity-100" : "opacity-0",
                  )}
                  role="tooltip"
                >
                  {altText}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

function mediaToAttachments(
  media: EmbedMedia[],
  sourceUrl?: string,
  messageId?: string,
  options?: {
    filenamePrefix?: string;
    proxyAllMedia?: boolean;
  },
): XMediaAttachment[] {
  const filenamePrefix = options?.filenamePrefix ?? "x";

  return media.map((item, index) => ({
    id: `${filenamePrefix}-media-${messageId ?? "embed"}-${index}-${item.url}`,
    message_id: messageId,
    filename:
      item.type === "video"
        ? `${filenamePrefix}-video-${index + 1}.mp4`
        : `${filenamePrefix}-image-${index + 1}`,
    file_key:
      item.type === "video" || options?.proxyAllMedia
        ? buildProxyMediaPath(item.url, sourceUrl)
        : item.url,
    content_type:
      item.type === "video"
        ? item.contentType || "video/mp4"
        : item.contentType || "image/jpeg",
    size_bytes: 0,
    url:
      item.type === "video" || options?.proxyAllMedia
        ? buildProxyMediaPath(item.url, sourceUrl)
        : item.url,
    thumbnailUrl: item.thumbnailUrl,
    width: item.width,
    height: item.height,
    isGif: item.isGif,
    alt_text: item.altText ?? null,
    sourceUrl,
    durationSeconds: item.durationSeconds,
  }));
}

function getXAttachmentUrl(attachment: Attachment): string {
  if (attachment.content_type?.startsWith("video/")) {
    return attachment.file_key;
  }

  return getAuthAssetUrl(attachment.url || attachment.file_key);
}

const VideoEmbed = memo(({ embed }: { embed: EmbedInfo }) => {
  return (
    <BaseEmbed embed={embed} width="standard">
      {embed.thumbnail?.url && (
        <div
          className="relative overflow-hidden rounded-md bg-tint-1"
          data-media-element="true"
          data-media-url={embed.thumbnail.url}
          data-media-download-url={getAuthAssetUrl(embed.thumbnail.url)}
        >
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group/media relative block outline-none"
            aria-label={
              embed.rawTitle ? `Play ${embed.rawTitle}` : "Play video"
            }
          >
            <img
              src={embed.thumbnail.url}
              alt="Video thumbnail"
              width={embed.thumbnail.width}
              height={embed.thumbnail.height}
              className="w-full object-cover max-h-[400px]"
              style={
                embed.thumbnail.width && embed.thumbnail.height
                  ? {
                      aspectRatio: `${embed.thumbnail.width} / ${embed.thumbnail.height}`,
                    }
                  : { minHeight: 180 }
              }
              data-media-element="true"
              data-media-url={embed.thumbnail.url}
              data-media-download-url={getAuthAssetUrl(embed.thumbnail.url)}
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <MediaPlayButton />
            </span>
          </a>
        </div>
      )}
    </BaseEmbed>
  );
});

const RichEmbed = memo(
  ({
    embed,
    onMediaPlay,
    onMediaStop,
  }: {
    embed: EmbedInfo;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
  }) => {
    const [playing, setPlaying] = useState(false);

    const handlePlay = useCallback(() => {
      setPlaying(true);
      onMediaPlay?.();
    }, [onMediaPlay]);

    useEffect(
      () => () => {
        if (playing) onMediaStop?.();
      },
      [onMediaStop, playing],
    );

    return (
      <BaseEmbed
        embed={embed}
        width="standard"
        openHref={embed.video ? embed.url : undefined}
        openLabel="Open in a new tab"
      >
        <div className="flex flex-col gap-2">
          {embed.author && (
            <div className="flex items-center gap-2">
              <a
                href={embed.author.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ui-sm font-semibold text-ink-1 underline-offset-3 pointer-fine:hover:underline"
              >
                <EmbedInlineText
                  text={embed.author.name}
                  keyPrefix={`${embed.id}-rich-author`}
                />
              </a>
            </div>
          )}

          {embed.thumbnail?.url && (
            <div
              className="relative overflow-hidden rounded-md bg-tint-1"
              data-media-element="true"
              data-media-url={embed.thumbnail.url}
              data-media-download-url={getAuthAssetUrl(embed.thumbnail.url)}
            >
              {playing && embed.video?.url ? (
                <iframe
                  src={embed.video.url}
                  title="Embedded video preview"
                  className="w-full border-0"
                  style={{
                    aspectRatio: `${embed.video.width || 16}/${embed.video.height || 9}`,
                  }}
                  allow="autoplay; fullscreen; encrypted-media"
                  sandbox={EMBED_WIDGET_SANDBOX}
                  allowFullScreen
                />
              ) : (
                <>
                  <img
                    src={embed.thumbnail.url}
                    alt="Media"
                    width={embed.thumbnail.width}
                    height={embed.thumbnail.height}
                    className="w-full object-cover max-h-[300px]"
                    style={
                      embed.thumbnail.width && embed.thumbnail.height
                        ? {
                            aspectRatio: `${embed.thumbnail.width} / ${embed.thumbnail.height}`,
                          }
                        : { minHeight: 160 }
                    }
                    data-media-element="true"
                    data-media-url={embed.thumbnail.url}
                    data-media-download-url={getAuthAssetUrl(
                      embed.thumbnail.url,
                    )}
                  />
                  {embed.video && (
                    <>
                      <button
                        type="button"
                        onClick={handlePlay}
                        className="group/media absolute inset-0 flex cursor-pointer items-center justify-center outline-none"
                        aria-label="Play video"
                      >
                        <MediaPlayButton />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </BaseEmbed>
    );
  },
);

const INSTAGRAM_ICON_URL =
  "https://static.cdninstagram.com/rsrc.php/v4/yI/r/VsNE-OHk_8a.png";
type InstagramHydrationPayload = {
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  title?: string | null;
  durationSeconds?: number | null;
  media?: EmbedMedia[];
  authorAvatarUrl?: string | null;
  authorVerified?: boolean | null;
  likeCount?: number | null;
  commentCount?: number | null;
  viewCount?: number | null;
  timestamp?: string | null;
  audio?: EmbedInfo["audio"];
};

function formatInstagramMetricCount(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  return value > 0 ? formatXMetricCount(value) : "0";
}

function needsInstagramHydration(embed: EmbedInfo): boolean {
  return Boolean(embed.url) && !embed.unavailable;
}

function getInstagramRenderableMedia(embed: EmbedInfo): EmbedMedia[] {
  if (Array.isArray(embed.media) && embed.media.length > 0) {
    return embed.media;
  }

  if (embed.video?.url && embed.video.kind !== "player") {
    return [
      {
        type: "video",
        url: embed.video.url,
        width: embed.video.width,
        height: embed.video.height,
        thumbnailUrl: embed.thumbnail?.url,
        contentType: embed.video.contentType,
        durationSeconds: embed.video.durationSeconds,
      },
    ];
  }

  if (embed.thumbnail?.url) {
    return [
      {
        type: "image",
        url: embed.thumbnail.url,
        width: embed.thumbnail.width,
        height: embed.thumbnail.height,
      },
    ];
  }

  return [];
}

function InstagramImage({
  src,
  alt,
  loading,
}: {
  src: string;
  alt: string;
  loading: "eager" | "lazy";
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        role="img"
        aria-label="Media unavailable"
        className="flex h-full min-h-40 w-full items-center justify-center bg-tint-1 px-4 text-center text-ui-xs font-medium text-ink-3"
      >
        Media unavailable
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-contain"
      loading={loading}
      referrerPolicy="no-referrer"
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onError={() => setFailed(true)}
    />
  );
}

function shouldRenderInstagramMediaAsVideo(item: EmbedMedia): boolean {
  if (item.type === "video" || item.isGif === true) {
    return true;
  }

  const contentType = item.contentType?.toLowerCase();
  if (contentType?.startsWith("video/")) {
    return true;
  }

  try {
    return /\.(mp4|m4v|mov|webm)$/i.test(new URL(item.url).pathname);
  } catch {
    return /\.(mp4|m4v|mov|webm)(?:$|\?)/i.test(item.url);
  }
}

function isWeakInstagramHydrationPayload(
  payload: InstagramHydrationPayload,
): boolean {
  const media = payload.media ?? [];
  const hasVideo =
    Boolean(payload.videoUrl) || media.some((entry) => entry.type === "video");
  const hasMultipleMediaItems = media.length > 1;
  return !hasVideo && !hasMultipleMediaItems;
}

function embedHasDirectInstagramMedia(embed: EmbedInfo): boolean {
  return (
    (embed.media?.length ?? 0) > 1 ||
    Boolean(embed.media?.some((entry) => entry.type === "video")) ||
    Boolean(embed.video?.url && embed.video.kind !== "player")
  );
}

function hydrateInstagramEmbed(
  embed: EmbedInfo,
  payload: InstagramHydrationPayload | null,
): EmbedInfo {
  if (!payload) return embed;

  if (
    isWeakInstagramHydrationPayload(payload) &&
    embedHasDirectInstagramMedia(embed)
  ) {
    return {
      ...embed,
      rawTitle: payload.title ?? embed.rawTitle ?? undefined,
      author: embed.author
        ? {
            ...embed.author,
            iconURL: payload.authorAvatarUrl ?? embed.author.iconURL,
            isVerified: payload.authorVerified ?? embed.author.isVerified,
          }
        : embed.author,
      metrics: {
        ...embed.metrics,
        likes: payload.likeCount ?? embed.metrics?.likes ?? undefined,
        comments: payload.commentCount ?? embed.metrics?.comments ?? undefined,
        views: payload.viewCount ?? embed.metrics?.views ?? undefined,
      },
      timestamp: payload.timestamp ?? embed.timestamp ?? undefined,
      audio: payload.audio ?? embed.audio ?? undefined,
    };
  }

  const media = payload.media?.length ? payload.media : embed.media;
  const firstVideo = media?.find((entry) => entry.type === "video");
  const firstMedia = media?.[0];
  const nextThumbnailUrl =
    payload.thumbnailUrl ??
    firstVideo?.thumbnailUrl ??
    (firstMedia?.type === "image" ? firstMedia.url : undefined) ??
    embed.thumbnail?.url;
  const nextThumbnail = nextThumbnailUrl
    ? {
        url: nextThumbnailUrl,
        width:
          (firstMedia?.type === "image" ? firstMedia.width : undefined) ??
          firstVideo?.width ??
          embed.thumbnail?.width,
        height:
          (firstMedia?.type === "image" ? firstMedia.height : undefined) ??
          firstVideo?.height ??
          embed.thumbnail?.height,
      }
    : embed.thumbnail;
  const nextAuthorIcon =
    payload.authorAvatarUrl ?? embed.author?.iconURL ?? undefined;
  const nextAuthorVerified =
    payload.authorVerified ?? embed.author?.isVerified ?? undefined;
  const nextAuthor = embed.author
    ? {
        ...embed.author,
        iconURL: nextAuthorIcon,
        isVerified: nextAuthorVerified,
      }
    : embed.author;

  return {
    ...embed,
    rawTitle: payload.title ?? embed.rawTitle ?? undefined,
    thumbnail: nextThumbnail,
    media,
    video: payload.videoUrl
      ? {
          url: payload.videoUrl,
          width: firstVideo?.width ?? embed.video?.width ?? 720,
          height: firstVideo?.height ?? embed.video?.height ?? 1280,
          kind: "direct",
          contentType: embed.video?.contentType ?? "video/mp4",
          durationSeconds:
            payload.durationSeconds ??
            embed.video?.durationSeconds ??
            undefined,
        }
      : embed.video?.url && embed.video.kind !== "player"
        ? embed.video
        : embed.video,
    author: nextAuthor,
    metrics: {
      ...embed.metrics,
      likes: payload.likeCount ?? embed.metrics?.likes ?? undefined,
      comments: payload.commentCount ?? embed.metrics?.comments ?? undefined,
      views: payload.viewCount ?? embed.metrics?.views ?? undefined,
    },
    timestamp: payload.timestamp ?? embed.timestamp ?? undefined,
    audio: payload.audio ?? embed.audio ?? undefined,
    footer: {
      text: "Instagram",
      iconURL: INSTAGRAM_ICON_URL,
    },
  };
}

const InstagramEmbed = memo(
  ({
    embed,
    onMediaPlay,
    onMediaStop,
    messageId,
    onJumpToMessage,
  }: {
    embed: EmbedInfo;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
    messageId?: string;
    onJumpToMessage?: (messageId: string) => void;
  }) => {
    const instagramHydrationKey = hydrationKey(
      "/api/instagram-video",
      embed.url,
    );
    const [cachedHydration] = useState(() =>
      peekEmbedHydration<InstagramHydrationPayload>(instagramHydrationKey),
    );
    const [hydratedPayload, setHydratedPayload] =
      useState<InstagramHydrationPayload | null>(() =>
        cachedHydration?.status === "ok" ? cachedHydration.payload : null,
      );
    const [isGone, setIsGone] = useState(
      () => cachedHydration?.status === "missing",
    );
    const [activeIndex, setActiveIndex] = useState(0);
    const [dragOffset, setDragOffset] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isAudioPlaying, setIsAudioPlaying] = useState(false);
    const trackRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const audioActiveRef = useRef(false);
    const fetchedRef = useRef(false);
    const suppressViewerClickRef = useRef(false);
    const handledPointerOpenRef = useRef(false);
    const dragStateRef = useRef<{
      pointerId: number | null;
      startX: number;
      deltaX: number;
      pressedImageIndex: number | null;
    }>({
      pointerId: null,
      startX: 0,
      deltaX: 0,
      pressedImageIndex: null,
    });
    const { open } = useImageViewerActions();
    const needsHydration = needsInstagramHydration(embed);
    const displayEmbed = useMemo(
      () => hydrateInstagramEmbed(embed, hydratedPayload),
      [embed, hydratedPayload],
    );
    const media = useMemo(
      () => getInstagramRenderableMedia(displayEmbed),
      [displayEmbed],
    );
    const resolvedActiveIndex = Math.min(
      activeIndex,
      Math.max(media.length - 1, 0),
    );
    const viewerAttachments = useMemo(
      () =>
        mediaToAttachments(media, embed.url, messageId, {
          filenamePrefix: "instagram",
          proxyAllMedia: true,
        }),
      [embed.url, media, messageId],
    );
    const activeMedia = media[resolvedActiveIndex] ?? media[0];
    const captionText = displayEmbed.rawDescription ?? displayEmbed.rawTitle;
    const commentCount = displayEmbed.metrics?.comments;
    const likeCount = displayEmbed.metrics?.likes;
    const viewCount = displayEmbed.metrics?.views;
    const slideWidthPercent = media.length > 0 ? 100 / media.length : 100;
    const audioArtworkSrc = displayEmbed.audio?.artworkUrl
      ? getAuthAssetUrl(
          buildProxyMediaPath(displayEmbed.audio.artworkUrl, embed.url),
        )
      : null;
    const audioPlaybackUrl = displayEmbed.audio?.url
      ? getMediaUrl(buildProxyMediaPath(displayEmbed.audio.url, embed.url))
      : null;
    const aspectRatioStyle =
      activeMedia?.width && activeMedia?.height
        ? `${activeMedia.width}/${activeMedia.height}`
        : displayEmbed.thumbnail?.width && displayEmbed.thumbnail?.height
          ? `${displayEmbed.thumbnail.width}/${displayEmbed.thumbnail.height}`
          : "1/1";

    useEffect(() => {
      if (!embed.url || fetchedRef.current || !needsHydration) return;
      if (cachedHydration) {
        fetchedRef.current = true;
        return;
      }
      if (typeof IntersectionObserver === "undefined") return;

      const el = trackRef.current;
      if (!el) return;
      let isActive = true;

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries[0]?.isIntersecting || fetchedRef.current) return;
          fetchedRef.current = true;
          observer.disconnect();

          void loadEmbedHydration<InstagramHydrationPayload>(
            instagramHydrationKey,
            apiUrl(
              `/api/instagram-video?videoUrl=${encodeURIComponent(embed.url)}`,
            ),
          ).then((result) => {
            if (!isActive) return;
            if (result.status === "ok") setHydratedPayload(result.payload);
            if (result.status === "missing") setIsGone(true);
          });
        },
        { threshold: 0.2 },
      );

      observer.observe(el);
      return () => {
        isActive = false;
        observer.disconnect();
      };
    }, [cachedHydration, embed.url, instagramHydrationKey, needsHydration]);

    const goToIndex = useCallback(
      (index: number) => {
        if (media.length === 0) return;
        const bounded = Math.max(0, Math.min(index, media.length - 1));
        setActiveIndex(bounded);
        setDragOffset(0);
      },
      [media.length],
    );

    const openViewer = useCallback(
      (index: number) => {
        if (viewerAttachments.length === 0) return;

        const context: ViewerContext = {
          username: displayEmbed.author?.name,
          avatar_url: displayEmbed.author?.iconURL
            ? buildProxyMediaPath(displayEmbed.author.iconURL, embed.url)
            : null,
          avatar_display: null,
          created_at: displayEmbed.timestamp,
          onJumpToMessage,
          onIndexChange: goToIndex,
        };

        open(viewerAttachments, index, context);
      },
      [
        displayEmbed.author,
        displayEmbed.timestamp,
        embed.url,
        goToIndex,
        onJumpToMessage,
        open,
        viewerAttachments,
      ],
    );

    const showPrev = useCallback(() => {
      goToIndex(resolvedActiveIndex - 1);
    }, [goToIndex, resolvedActiveIndex]);

    const showNext = useCallback(() => {
      goToIndex(resolvedActiveIndex + 1);
    }, [goToIndex, resolvedActiveIndex]);

    const getPressedImageIndex = useCallback(
      (target: EventTarget | null): number | null => {
        if (!(target instanceof HTMLElement)) return null;
        const indexText = target.closest<HTMLElement>(
          "[data-instagram-image-index]",
        )?.dataset.instagramImageIndex;
        if (!indexText) return null;

        const index = Number(indexText);
        return Number.isInteger(index) && index >= 0 ? index : null;
      },
      [],
    );

    const handleCarouselKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          showPrev();
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          showNext();
        }
      },
      [showNext, showPrev],
    );

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.isPrimary || event.button !== 0) return;

        suppressViewerClickRef.current = false;
        handledPointerOpenRef.current = false;
        setIsDragging(true);
        dragStateRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          deltaX: 0,
          pressedImageIndex: getPressedImageIndex(event.target),
        };

        if (media.length > 1) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      },
      [getPressedImageIndex, media.length],
    );

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragStateRef.current.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - dragStateRef.current.startX;
        dragStateRef.current.deltaX = deltaX;
        if (Math.abs(deltaX) > 8) {
          suppressViewerClickRef.current = true;
        }
        setDragOffset(deltaX);
      },
      [],
    );

    const handlePointerEnd = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragStateRef.current.pointerId !== event.pointerId) return;
        const width = event.currentTarget.clientWidth || 1;
        const threshold = Math.max(48, width * 0.18);
        const deltaX = dragStateRef.current.deltaX;
        const pressedImageIndex = dragStateRef.current.pressedImageIndex;

        dragStateRef.current = {
          pointerId: null,
          startX: 0,
          deltaX: 0,
          pressedImageIndex: null,
        };
        setDragOffset(0);
        setIsDragging(false);

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }

        if (deltaX <= -threshold) {
          handledPointerOpenRef.current = true;
          showNext();
          return;
        }
        if (deltaX >= threshold) {
          handledPointerOpenRef.current = true;
          showPrev();
          return;
        }

        if (pressedImageIndex !== null) {
          handledPointerOpenRef.current = true;
          openViewer(pressedImageIndex);
        }
      },
      [openViewer, showNext, showPrev],
    );

    const handleImageClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>, index: number) => {
        event.stopPropagation();
        if (handledPointerOpenRef.current) {
          handledPointerOpenRef.current = false;
          return;
        }
        if (suppressViewerClickRef.current) {
          suppressViewerClickRef.current = false;
          return;
        }
        openViewer(index);
      },
      [openViewer],
    );

    const handleImageKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openViewer(index);
      },
      [openViewer],
    );

    const handlePrevButtonClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        showPrev();
      },
      [showPrev],
    );

    const handleNextButtonClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        showNext();
      },
      [showNext],
    );

    const handleDotClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>, index: number) => {
        event.stopPropagation();
        goToIndex(index);
      },
      [goToIndex],
    );

    const preventNativeDrag = useCallback(
      (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
      },
      [],
    );

    const stopChromePointerPropagation = useCallback(
      (event: React.PointerEvent<HTMLElement>) => {
        event.stopPropagation();
      },
      [],
    );

    const handleAudioToggle = useCallback(async () => {
      const audioElement = audioRef.current;
      if (!audioElement) return;

      if (audioElement.paused) {
        try {
          await audioElement.play();
          setIsAudioPlaying(true);
          audioActiveRef.current = true;
          onMediaPlay?.();
        } catch {
          setIsAudioPlaying(false);
        }
        return;
      }

      audioElement.pause();
      setIsAudioPlaying(false);
      if (audioActiveRef.current) {
        audioActiveRef.current = false;
        onMediaStop?.();
      }
    }, [onMediaPlay, onMediaStop]);

    useEffect(() => {
      const audioElement = audioRef.current;
      if (!audioElement) return;
      audioElement.pause();
      audioElement.currentTime = 0;
    }, [audioPlaybackUrl]);

    useEffect(
      () => () => {
        audioRef.current?.pause();
        if (audioActiveRef.current) {
          audioActiveRef.current = false;
          onMediaStop?.();
        }
      },
      [onMediaStop],
    );

    const handleAudioStopped = useCallback(() => {
      setIsAudioPlaying(false);
      if (audioActiveRef.current) {
        audioActiveRef.current = false;
        onMediaStop?.();
      }
    }, [onMediaStop]);

    if (isGone) {
      return <UnavailableSocialEmbed embed={displayEmbed} />;
    }

    return (
      <BaseEmbed embed={displayEmbed} width="compact" bare>
        <article className="flex flex-col gap-2">
          <EmbedHeader
            provider="Instagram"
            color={displayEmbed.color}
            timestamp={displayEmbed.timestamp}
            openHref={embed.url}
            openLabel="Open in Instagram"
          />

          <SocialAuthorRow
            name={displayEmbed.author?.name}
            url={displayEmbed.author?.url}
            avatarSrc={
              displayEmbed.author?.iconURL
                ? getAuthAssetUrl(
                    buildProxyMediaPath(displayEmbed.author.iconURL, embed.url),
                  )
                : null
            }
            verified={displayEmbed.author?.isVerified}
            keyPrefix={`${embed.id}-instagram-author`}
          />

          <div className="relative overflow-hidden rounded-md bg-black">
            <div
              ref={trackRef}
              className="relative w-full overflow-hidden"
              style={{
                aspectRatio: aspectRatioStyle,
                maxHeight: EMBED_PORTRAIT_MAX_HEIGHT,
                touchAction: media.length > 1 ? "pan-y" : undefined,
              }}
              tabIndex={media.length > 1 ? 0 : -1}
              onKeyDown={handleCarouselKeyDown}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            >
              <div
                data-testid="instagram-carousel-track"
                className="flex h-full"
                style={carouselTrackStyle(
                  media.length,
                  resolvedActiveIndex,
                  dragOffset,
                  isDragging,
                )}
              >
                {media.map((item, index) => {
                  const imageSrc = getAuthAssetUrl(
                    buildProxyMediaPath(item.url, embed.url),
                  );
                  const videoSrc = buildProxyMediaUrl(item.url, embed.url);
                  const posterSrc = item.thumbnailUrl
                    ? getAuthAssetUrl(
                        buildProxyMediaPath(item.thumbnailUrl, embed.url),
                      )
                    : displayEmbed.thumbnail?.url
                      ? getAuthAssetUrl(
                          buildProxyMediaPath(
                            displayEmbed.thumbnail.url,
                            embed.url,
                          ),
                        )
                      : undefined;
                  const rendersAsVideo =
                    shouldRenderInstagramMediaAsVideo(item);
                  const playbackMode = item.isGif ? "animated" : "default";

                  return (
                    <div
                      key={`${item.type}-${item.url}-${index}`}
                      data-media-element="true"
                      data-media-url={item.url}
                      data-media-download-url={
                        rendersAsVideo ? videoSrc : imageSrc
                      }
                      className="relative h-full shrink-0 bg-black"
                      style={{ width: `${slideWidthPercent}%` }}
                    >
                      {rendersAsVideo ? (
                        <div
                          className="flex h-full w-full items-center justify-center bg-black"
                          onPointerDown={stopChromePointerPropagation}
                        >
                          <DirectVideoEmbed
                            src={videoSrc}
                            filename={
                              item.isGif
                                ? `instagram-animated-${index + 1}.mp4`
                                : `instagram-${index + 1}.mp4`
                            }
                            maxWidth={4096}
                            maxHeight={4096}
                            aspectRatio={getAspectRatio(
                              item.width,
                              item.height,
                            )}
                            poster={posterSrc}
                            fallbackToPosterOnError={!!posterSrc}
                            referrerPolicy="no-referrer"
                            surfaceClassName="bg-black"
                            mediaClassName="h-full w-full object-contain"
                            showDurationBadge
                            durationBadgeSeconds={item.durationSeconds}
                            embeddedChrome={false}
                            onPlay={onMediaPlay}
                            onStop={onMediaStop}
                            playbackMode={playbackMode}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => handleImageClick(event, index)}
                          onKeyDown={(event) =>
                            handleImageKeyDown(event, index)
                          }
                          onDragStart={preventNativeDrag}
                          className="block h-full w-full cursor-zoom-in select-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                          aria-label={`Open media ${index + 1} of ${media.length}`}
                          data-instagram-image-index={index}
                        >
                          <InstagramImage
                            src={imageSrc}
                            alt={
                              item.altText ||
                              displayEmbed.rawTitle ||
                              "Instagram post media"
                            }
                            loading={index === 0 ? "eager" : "lazy"}
                          />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <CarouselControls
                count={media.length}
                activeIndex={resolvedActiveIndex}
                dotKeyPrefix={`${embed.id}-instagram-dot`}
                onPrev={handlePrevButtonClick}
                onNext={handleNextButtonClick}
                onDot={handleDotClick}
                onPointerDown={stopChromePointerPropagation}
              />
            </div>
          </div>

          <SocialMetrics
            likes={likeCount}
            comments={commentCount}
            views={viewCount}
          />

          {captionText && (
            <p className="text-ui-sm leading-5 text-pretty break-words text-ink-1">
              {displayEmbed.author?.name && (
                <span className="mr-1 font-semibold">
                  {displayEmbed.author.name}
                </span>
              )}
              <EmbedInlineText
                text={captionText}
                keyPrefix={`${embed.id}-instagram-caption`}
                linkClassName={EMBED_TEXT_LINK}
              />
            </p>
          )}

          {typeof commentCount === "number" && commentCount > 0 && (
            <a
              href={embed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit text-ui-xs text-ink-3 transition-colors duration-(--dur-1) ease-out pointer-fine:hover:text-ink-1"
            >
              View all <Num size="sm">{commentCount.toLocaleString()}</Num>{" "}
              comments
            </a>
          )}

          {displayEmbed.audio &&
            (displayEmbed.audio.title || displayEmbed.audio.artist) && (
              <SocialAudioChip
                audio={displayEmbed.audio}
                artworkSrc={audioArtworkSrc}
                playbackUrl={audioPlaybackUrl}
                playing={isAudioPlaying}
                audioRef={audioRef}
                keyPrefix={`${embed.id}-instagram`}
                onToggle={handleAudioToggle}
                onAudioPlay={() => setIsAudioPlaying(true)}
                onAudioStop={handleAudioStopped}
              />
            )}
        </article>
      </BaseEmbed>
    );
  },
);

function getInstagramFallbackTitle(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.includes("/reel/")) return "Instagram reel";
    if (pathname.includes("/p/")) return "Instagram post";
    return "Instagram";
  } catch {
    return "Instagram";
  }
}

const LinkEmbed_ = memo(({ embed }: { embed: EmbedInfo }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const providerName = embed.provider?.name?.toLowerCase();
  const displayEmbed = useMemo<EmbedInfo>(
    () =>
      providerName === "instagram" && !embed.rawTitle && !embed.rawDescription
        ? { ...embed, rawTitle: getInstagramFallbackTitle(embed.url) }
        : embed,
    [embed, providerName],
  );
  const thumbnailSrc =
    providerName === "instagram" && embed.thumbnail?.url
      ? getAuthAssetUrl(buildProxyMediaPath(embed.thumbnail.url, embed.url))
      : embed.thumbnail?.url;
  const width = embed.thumbnail?.width;
  const height = embed.thumbnail?.height;
  const showImage = Boolean(thumbnailSrc) && !imageFailed;
  // Pages that ask for a summary card (or send a small/square image) get a
  // thumbnail beside the text; a square logo blown up to full width read as
  // a broken layout. Embeds stored before `imageLayout` existed stay large.
  const layout = embed.imageLayout ?? "large";

  if (showImage && layout === "thumbnail") {
    return (
      <BaseEmbed embed={displayEmbed} width="compact" bare>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <EmbedCardText embed={displayEmbed} />
          </div>
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
            tabIndex={-1}
            aria-hidden="true"
          >
            <img
              src={thumbnailSrc}
              alt=""
              loading="lazy"
              className="size-20 rounded-md bg-tint-1 object-cover"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
              data-media-element="true"
              data-media-url={embed.thumbnail?.url || embed.url}
              data-media-download-url={thumbnailSrc}
            />
          </a>
        </div>
      </BaseEmbed>
    );
  }

  return (
    // A large image takes the standard width; a text-only card the compact.
    <BaseEmbed embed={displayEmbed} width={showImage ? "standard" : "compact"}>
      {showImage && (
        <a
          href={embed.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${displayEmbed.rawTitle || displayEmbed.provider?.name || "link"}`}
        >
          <img
            src={thumbnailSrc}
            alt=""
            loading="lazy"
            width={width}
            height={height}
            className="w-full rounded-md bg-tint-1 object-cover max-h-[300px]"
            // Reserve the box so the row does not grow when the image loads.
            style={{
              aspectRatio:
                width && height ? `${width} / ${height}` : "1.91 / 1",
            }}
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            data-media-element="true"
            data-media-url={embed.thumbnail?.url || embed.url}
            data-media-download-url={thumbnailSrc}
          />
        </a>
      )}
    </BaseEmbed>
  );
});

/** Header, title and description for a card laid out by its caller. */
function EmbedCardText({ embed }: { embed: EmbedInfo }) {
  return (
    <>
      <EmbedCardHeader embed={embed} />
      <EmbedTitle embed={embed} />
      <EmbedDescription embed={embed} />
    </>
  );
}

function getUnavailableMessage(embed: EmbedInfo): string {
  const provider = embed.provider?.name?.toLowerCase();
  if (provider === "tiktok") return "This TikTok is no longer available";
  if (provider === "youtube") return "This video is no longer available";
  return "This post is no longer available";
}

const UnavailableSocialEmbed = memo(({ embed }: { embed: EmbedInfo }) => {
  return (
    <BaseEmbed embed={embed} width="compact" bare>
      <EmbedHeader
        provider={
          embed.provider?.name ? (
            <EmbedInlineText
              text={embed.provider.name}
              keyPrefix={`${embed.id}-unavailable-provider`}
            />
          ) : undefined
        }
        color={embed.color}
      />
      <div className="flex items-center gap-3" data-testid="embed-unavailable">
        <img
          src={SOCIAL_UNAVAILABLE_IMAGE}
          alt=""
          className="size-16 shrink-0 rounded-md"
          draggable={false}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          {embed.author?.name ? (
            <div className="truncate text-ui-sm font-semibold text-ink-1">
              <EmbedInlineText
                text={embed.author.name}
                keyPrefix={`${embed.id}-unavailable-author`}
              />
            </div>
          ) : null}
          <p className="text-ui-sm text-ink-2">
            {getUnavailableMessage(embed)}
          </p>
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-ui-sm font-medium text-accent-ink underline-offset-3 pointer-fine:hover:underline"
          >
            View original
          </a>
        </div>
      </div>
    </BaseEmbed>
  );
});

// ─── Direct media links ──────────────────────────────────────────────────

function getDirectMediaFilename(url: string, fallback: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : fallback;
  } catch {
    return fallback;
  }
}

function DirectMediaFallback({ embed }: { embed: EmbedInfo }) {
  let host = embed.url;
  try {
    host = new URL(embed.url).hostname.replace(/^www\./, "");
  } catch {
    /* keep raw */
  }
  return (
    <EmbedFrame width="compact">
      <a
        href={embed.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group/fallback flex items-center gap-3 p-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-tint-2 text-ink-2">
          <Icon name="imageBroken" size="lg" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-ui-sm font-medium text-accent-ink underline-offset-3 pointer-fine:group-hover/fallback:underline">
            {getDirectMediaFilename(embed.url, "Media")}
          </span>
          <span className="block truncate text-ui-xs text-ink-3">{host}</span>
        </span>
      </a>
    </EmbedFrame>
  );
}

/**
 * A link straight to an image, GIF or video file: the media itself, no card
 * (like an attachment). The box is reserved from the sizes the server read
 * out of the file header, so the message row does not jump when it loads.
 */
const DirectMediaEmbed = memo(
  ({
    embed,
    messageId,
    onJumpToMessage,
    onMediaPlay,
    onMediaStop,
  }: {
    embed: EmbedInfo;
    messageId?: string;
    onJumpToMessage?: (messageId: string) => void;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
  }) => {
    const [failed, setFailed] = useState(false);
    const { open } = useImageViewerActions();
    const image = embed.media?.find((item) => item.type === "image");
    const video =
      embed.video?.kind === "direct" && embed.video.url ? embed.video : null;

    if (failed || (!image && !video)) {
      return <DirectMediaFallback embed={embed} />;
    }

    if (video) {
      const box = getDirectMediaBox(video.width, video.height);
      return (
        <div className="max-w-full" data-testid="direct-media-video">
          <DirectVideoEmbed
            src={video.url}
            filename={getDirectMediaFilename(video.url, "video.mp4")}
            maxWidth={box?.width ?? DIRECT_MEDIA_MAX_WIDTH}
            maxHeight={DIRECT_MEDIA_MAX_HEIGHT}
            aspectRatio={box?.aspectRatio}
            referrerPolicy="no-referrer"
            onVideoError={() => setFailed(true)}
            showDurationBadge
            durationBadgeSeconds={video.durationSeconds}
            onPlay={onMediaPlay}
            onStop={onMediaStop}
          />
        </div>
      );
    }

    const item = image!;
    const box = getDirectMediaBox(item.width, item.height);
    const filename = getDirectMediaFilename(item.url, "image");
    const openViewer = () => {
      open(
        [
          {
            id: `direct-${messageId ?? "embed"}-${item.url}`,
            message_id: messageId,
            filename,
            file_key: item.url,
            url: item.url,
            content_type: item.contentType || "image/jpeg",
            size_bytes: 0,
            alt_text: item.altText ?? null,
          },
        ],
        0,
        { onJumpToMessage },
      );
    };

    return (
      <button
        type="button"
        onClick={openViewer}
        // Image attachments are radius 12 (spec §4); the tint fills any
        // letterbox so a transparent PNG or a logo is never cropped.
        className="block max-w-full cursor-zoom-in overflow-hidden rounded-xl border border-line bg-tint-1 p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        style={
          box
            ? {
                width: `min(100%, ${box.width}px)`,
                aspectRatio: box.aspectRatio,
              }
            : { maxWidth: `min(100%, ${DIRECT_MEDIA_MAX_WIDTH}px)` }
        }
        aria-label={item.isGif ? "Open GIF" : "Open image"}
        data-media-element="true"
        data-media-url={item.url}
        data-media-download-url={item.url}
        data-media-filename={filename}
      >
        <img
          src={item.url}
          alt={item.altText || ""}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={cn(
            "block",
            box
              ? "h-full w-full object-contain"
              : "h-auto max-h-100 w-auto max-w-full object-contain",
          )}
          draggable={false}
          onError={() => setFailed(true)}
        />
      </button>
    );
  },
);

// ─── Main Component ─────────────────────────────────────────────────────

export const LinkEmbed = memo(
  ({
    embed,
    messageId,
    onJumpToMessage,
    onRemoveEmbeds,
    onMediaPlay,
    onMediaStop,
  }: {
    embed: EmbedInfo;
    messageId?: string;
    onJumpToMessage?: (messageId: string) => void;
    onRemoveEmbeds?: () => void;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
  }) => {
    const [showModal, setShowModal] = useState(false);
    // Mount the confirm on first use (not per embed up front), then keep it
    // so its close animation can run.
    const [modalMounted, setModalMounted] = useState(false);
    const providerName = embed.provider?.name?.toLowerCase();
    const isXEmbed =
      providerName === "x" ||
      providerName === "twitter" ||
      embed.footer?.text?.toLowerCase() === "x" ||
      /https?:\/\/(?:www\.)?(?:x|twitter|fxtwitter|fixupx)\.com\//i.test(
        embed.url,
      );

    const handleCancel = useCallback(() => {
      setShowModal(false);
    }, []);

    const handleXClick = useCallback(
      (e: React.MouseEvent) => {
        if (!onRemoveEmbeds) return;
        if (e.shiftKey) {
          onRemoveEmbeds();
        } else {
          setModalMounted(true);
          setShowModal(true);
        }
      },
      [onRemoveEmbeds],
    );

    const handleConfirm = useCallback(() => {
      handleCancel();
      onRemoveEmbeds?.();
    }, [handleCancel, onRemoveEmbeds]);

    // Determine which embed to render
    let embedContent: React.ReactNode;

    // Provider-specific routing
    if (embed.unavailable) {
      embedContent = <UnavailableSocialEmbed embed={embed} />;
    } else if (embed.direct) {
      embedContent = (
        <DirectMediaEmbed
          embed={embed}
          messageId={messageId}
          onJumpToMessage={onJumpToMessage}
          onMediaPlay={onMediaPlay}
          onMediaStop={onMediaStop}
        />
      );
    } else if (providerName === "youtube" && embed.video?.url) {
      embedContent = (
        <YouTubeEmbed
          embed={embed}
          onMediaPlay={onMediaPlay}
          onMediaStop={onMediaStop}
        />
      );
    } else if (providerName === "tiktok") {
      embedContent = (
        <TikTokEmbed
          key={getTikTokHydrationSignature(embed)}
          embed={embed}
          onMediaPlay={onMediaPlay}
          onMediaStop={onMediaStop}
          messageId={messageId}
          onJumpToMessage={onJumpToMessage}
        />
      );
    } else if (providerName === "spotify") {
      embedContent = <SpotifyEmbed embed={embed} />;
    } else if (providerName === "instagram") {
      embedContent = (
        <InstagramEmbed
          embed={embed}
          onMediaPlay={onMediaPlay}
          onMediaStop={onMediaStop}
          messageId={messageId}
          onJumpToMessage={onJumpToMessage}
        />
      );
    } else if (isXEmbed) {
      embedContent = (
        <XEmbed
          embed={embed}
          messageId={messageId}
          onJumpToMessage={onJumpToMessage}
          onMediaPlay={onMediaPlay}
          onMediaStop={onMediaStop}
        />
      );
    } else {
      // Type-based routing
      switch (embed.type) {
        case "video":
          embedContent = <VideoEmbed embed={embed} />;
          break;
        case "rich":
          embedContent = (
            <RichEmbed
              embed={embed}
              onMediaPlay={onMediaPlay}
              onMediaStop={onMediaStop}
            />
          );
          break;
        case "link":
        case "image":
        default:
          embedContent = <LinkEmbed_ embed={embed} />;
          break;
      }
    }

    return (
      <>
        <div className="relative mt-2 group/embedwrap inline-block max-w-full">
          {embedContent}
          {onRemoveEmbeds && (
            <button
              type="button"
              onClick={handleXClick}
              className={cn(
                // Fine pointers: just outside the card's corner, revealed on
                // hover. Touch: on the corner itself as a filled chip, since
                // a full-width card on a phone leaves no gutter and the old
                // -right-6 position was clipped off-screen.
                "absolute z-20 flex size-5 items-center justify-center text-ink-3 outline-none pointer-fine:-top-2 pointer-fine:-right-6 pointer-fine:rounded-sm pointer-fine:hover:bg-tint-1 pointer-fine:hover:text-ink-1 pointer-coarse:-top-2 pointer-coarse:-right-2 pointer-coarse:rounded-full pointer-coarse:border pointer-coarse:border-line pointer-coarse:bg-ply-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                HIT,
                // REVEAL, scoped to this embed (the message row is also a
                // `group`): hidden until hover/focus on fine pointers, always
                // visible on touch.
                "pointer-fine:opacity-0 pointer-fine:transition-[color,background-color,opacity] pointer-fine:duration-(--dur-1) pointer-fine:ease-out pointer-fine:group-hover/embedwrap:opacity-100 pointer-fine:group-focus-within/embedwrap:opacity-100 pointer-fine:focus-visible:opacity-100",
              )}
              aria-label="Remove embeds"
              title="Remove all embeds (Shift+click to skip confirmation)"
            >
              <Icon name="close" size="sm" />
            </button>
          )}
        </div>
        {onRemoveEmbeds && modalMounted && (
          <RemoveEmbedsDialog
            open={showModal}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) handleCancel();
            }}
            onConfirm={handleConfirm}
          />
        )}
      </>
    );
  },
);
