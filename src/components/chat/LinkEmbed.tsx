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
import { cn } from "@/lib/utils";
import { useCustomEmojiLookup } from "@/hooks/useCustomEmojiLookup";
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
import EmojiToken from "./EmojiToken";
import { GifFavoriteButton } from "./GifFavoriteButton";
import VideoAttachment from "./VideoAttachment";

const EMBED_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const EMBED_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

const X_HEADER_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const X_HEADER_DATE_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

// TikTok's player bootstrap reads its own cookies; without allow-same-origin
// the iframe fallback logs SecurityError and never finishes initialising.
const EMBED_PLAYER_SANDBOX =
  "allow-presentation allow-same-origin allow-scripts";
const EMBED_WIDGET_SANDBOX =
  "allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts";

const X_FOOTER_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

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
  width?: number;
  /** If true, skip rendering rawTitle/rawDescription/provider inside the wrapper */
  bare?: boolean;
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

const BaseEmbed = memo(({ embed, children, width, bare }: BaseEmbedProps) => {
  const timestampText = formatEmbedTimestamp(embed.timestamp);

  return (
    <div
      className="overflow-hidden rounded-md border border-rm-border bg-rm-bg-elevated/40 text-rm-text-primary"
      style={{
        borderLeftColor: embed.color || "#202225",
        borderLeftWidth: 4,
        width: width ? `${width}px` : "100%",
        maxWidth: "100%",
      }}
    >
      <div className="p-3 flex flex-col gap-1.5">
        {!bare && embed.provider && (
          <div className="text-[12px] font-semibold text-rm-text-muted/80">
            <EmbedInlineText
              text={embed.provider.name}
              keyPrefix={`${embed.id}-provider`}
            />
          </div>
        )}

        {!bare && embed.rawTitle && (
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[15px] font-bold text-[#00A8FC] hover:underline leading-snug break-words"
          >
            <EmbedInlineText
              text={embed.rawTitle}
              keyPrefix={`${embed.id}-title`}
            />
          </a>
        )}

        {!bare && embed.rawDescription && (
          <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words mt-0.5 opacity-90 line-clamp-3">
            <EmbedInlineText
              text={embed.rawDescription}
              keyPrefix={`${embed.id}-description`}
            />
          </div>
        )}

        {children}

        {!bare && embed.footer && (
          <div className="flex items-center gap-2 text-[12px] text-rm-text-muted/80 mt-1">
            {embed.footer.iconURL && (
              <img
                src={embed.footer.iconURL}
                alt=""
                className="w-4 h-4 rounded-full"
              />
            )}
            <span>
              <EmbedInlineText
                text={embed.footer.text}
                keyPrefix={`${embed.id}-footer`}
              />
            </span>
            {timestampText && (
              <>
                <span className="opacity-50">·</span>
                <span>{timestampText}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Remove Embeds Confirmation Modal ─────────────────────────────────────

function formatEmbedTimestamp(timestamp?: string): string | null {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDelta = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );
  const timeText = EMBED_TIME_FORMATTER.format(date);

  if (dayDelta === 0) return `Today at ${timeText}`;
  if (dayDelta === 1) return `Yesterday at ${timeText}`;

  const dateText = EMBED_DATE_FORMATTER.format(date);

  return `${dateText} ${timeText}`;
}

function formatXHeaderTimestamp(timestamp?: string): string | null {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) return `${Math.max(1, diffSeconds)}s`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  if (date.getFullYear() === now.getFullYear()) {
    return X_HEADER_DATE_FORMATTER.format(date);
  }

  return X_HEADER_DATE_WITH_YEAR_FORMATTER.format(date);
}

function formatXFooterTimestamp(timestamp?: string): string | null {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  return X_FOOTER_DATE_TIME_FORMATTER.format(date);
}

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

const RemoveEmbedsModal = memo(
  ({
    onConfirm,
    onCancel,
  }: {
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onCancel}
        aria-label="Close remove embeds confirmation"
      />
      <div
        className="relative w-full max-w-[440px] rounded-xl bg-rm-bg-surface border border-rm-border shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-rm-text-primary mb-2">
          Are you sure?
        </h2>
        <p className="text-[14px] text-rm-text-secondary leading-relaxed">
          This will remove all embeds on this message for everyone.
        </p>
        <p className="text-[12px] text-rm-text-muted mt-2 mb-6">
          Hold shift when clearing embeds to skip this modal.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-md text-[14px] font-medium text-rm-text-secondary hover:text-rm-text-primary hover:bg-rm-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-md text-[14px] font-medium text-white bg-[#da373c] hover:bg-[#a12828] transition-colors"
          >
            Remove All Embeds
          </button>
        </div>
      </div>
    </div>
  ),
);

// ─── Overlay Button ───────────────────────────────────────────────────────

const PlayIcon = ({ className = "w-7 h-7 ml-0.5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="white" className={className}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

const ExternalIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="white"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-5 h-5"
  >
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const PauseIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="white" className={className}>
    <path d="M7 5h3v14H7zm7 0h3v14h-3z" />
  </svg>
);

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
      playbackMode={playbackMode}
    />
  ),
);

// ─── Platform-specific Renderers ──────────────────────────────────────────

const YouTubeEmbed = memo(
  ({ embed, onMediaPlay }: { embed: EmbedInfo; onMediaPlay?: () => void }) => {
    const [playing, setPlaying] = useState(false);

    const handlePlay = useCallback(() => {
      setPlaying(true);
      onMediaPlay?.();
    }, [onMediaPlay]);

    const w = embed.video?.width ?? 1280;
    const h = embed.video?.height ?? 720;
    const isPortrait = h > w;
    // Cap portrait embeds at 400px wide so they don't dominate the chat
    const embedWidth = isPortrait ? 280 : 432;

    return (
      <BaseEmbed embed={embed} width={embedWidth}>
        <div
          className="relative rounded-md overflow-hidden bg-black w-full"
          style={{ aspectRatio: `${w}/${h}` }}
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
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              {/* Overlay buttons */}
              <div className="absolute inset-0 flex items-center justify-center gap-3">
                {/* Play button */}
                <button
                  onClick={handlePlay}
                  className="w-16 h-11 bg-[#FF0000] hover:bg-[#FF0000]/80 rounded-xl flex items-center justify-center transition-colors cursor-pointer shadow-lg"
                  title="Play"
                >
                  <PlayIcon />
                </button>
                {/* Open in new tab */}
                <a
                  href={embed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors backdrop-blur-sm shadow-lg"
                  title="Open in YouTube"
                >
                  <ExternalIcon />
                </a>
              </div>
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
  | { mode: "error" };

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

function hydrateTikTokEmbed(
  embed: EmbedInfo,
  payload: TikTokHydrationPayload | null,
): EmbedInfo {
  if (!payload) return embed;

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
  const nextAuthorIcon =
    embed.author?.iconURL || payload.authorAvatarUrl || undefined;
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
    audio: embed.audio ?? payload.audio ?? undefined,
    footer: {
      text: "TikTok",
    },
  };
}

const TikTokEmbed = memo(
  ({
    embed,
    onMediaPlay,
    messageId,
    onJumpToMessage,
  }: {
    embed: EmbedInfo;
    onMediaPlay?: () => void;
    messageId?: string;
    onJumpToMessage?: (messageId: string) => void;
  }) => {
    const [hydratedPayload, setHydratedPayload] =
      useState<TikTokHydrationPayload | null>(null);
    const [player, setPlayer] = useState<TikTokPlayerState>(() => ({
      mode: getTikTokRenderableMedia(embed).length === 0 ? "loading" : "idle",
    }));
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
    const prefersReducedMotion = usePrefersReducedMotion();
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
    const timestampText = formatInstagramTimestamp(displayEmbed.timestamp);
    const likeCount = displayEmbed.metrics?.likes;
    const commentCount = displayEmbed.metrics?.comments;
    const viewCount = displayEmbed.metrics?.views;
    const slideWidthPercent = media.length > 0 ? 100 / media.length : 100;
    const audioArtworkSrc = displayEmbed.audio?.artworkUrl
      ? getAuthAssetUrl(
          buildProxyMediaPath(displayEmbed.audio.artworkUrl, displayEmbed.url),
        )
      : null;
    const audioPlaybackUrl = displayEmbed.audio?.url
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
      if (!displayEmbed.url || fetchedRef.current) return;

      fetchedRef.current = true;
      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      let isActive = true;

      fetch(
        apiUrl(
          `/api/tiktok-video?videoUrl=${encodeURIComponent(displayEmbed.url)}`,
        ),
        controller ? { signal: controller.signal } : undefined,
      )
        .then((res) => {
          if (!res.ok) throw new Error(`${res.status}`);
          return res.json() as Promise<TikTokHydrationPayload>;
        })
        .then((payload) => {
          if (!isActive) return;
          setHydratedPayload(payload);
          setPlayer(
            payload.videoUrl ||
              payload.media?.length ||
              payload.coverUrl ||
              payload.audio ||
              payload.title
              ? { mode: "ready" }
              : hasPersistentInlineMedia || hasDirectVideoMedia
                ? { mode: "error" }
                : { mode: "iframe" },
          );
        })
        .catch((error) => {
          if (!isActive) return;
          if (error instanceof DOMException && error.name === "AbortError")
            return;
          setPlayer(
            hasPersistentInlineMedia || hasDirectVideoMedia
              ? { mode: "error" }
              : { mode: "iframe" },
          );
        });

      return () => {
        isActive = false;
        controller?.abort();
      };
    }, [
      displayEmbed.url,
      hasDirectVideoMedia,
      hasPersistentInlineMedia,
      media.length,
      hydrationSignature,
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
          onMediaPlay?.();
        } catch {
          setIsAudioPlaying(false);
        }
        return;
      }

      audioElement.pause();
      setIsAudioPlaying(false);
    }, [onMediaPlay]);

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

    return (
      <BaseEmbed embed={displayEmbed} width={360} bare>
        <article ref={containerRef} className="flex flex-col gap-3">
          <header className="flex items-center gap-3">
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-rm-bg-surface/70 ring-1 ring-rm-border/60">
              {displayEmbed.author?.iconURL ? (
                <img
                  src={getAuthAssetUrl(
                    buildProxyMediaPath(
                      displayEmbed.author.iconURL,
                      displayEmbed.url,
                    ),
                  )}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-full w-full bg-[radial-gradient(circle_at_top,_rgba(255,0,128,0.42),transparent_68%)]" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold leading-tight text-rm-text-primary">
                {displayEmbed.author?.url ? (
                  <a
                    href={displayEmbed.author.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    <EmbedInlineText
                      text={displayEmbed.author.name}
                      keyPrefix={`${embed.id}-tiktok-author`}
                    />
                  </a>
                ) : (
                  <EmbedInlineText
                    text={displayEmbed.author?.name || "TikTok"}
                    keyPrefix={`${embed.id}-tiktok-author`}
                  />
                )}
              </div>
              <div className="text-[12px] text-rm-text-muted/82">
                {timestampText || "TikTok"}
              </div>
            </div>

            <a
              href={displayEmbed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/72 text-white shadow-sm transition-colors hover:bg-black/85"
              title="Open in TikTok"
              aria-label="Open in TikTok"
            >
              <ExternalIcon />
            </a>
          </header>

          {hasRenderableMedia ? (
            <>
              <div className="relative overflow-hidden rounded-[24px] border border-rm-border/55 bg-black/95 shadow-[0_12px_36px_rgba(0,0,0,0.32)]">
                <div
                  ref={trackRef}
                  className="relative w-full overflow-hidden"
                  style={{
                    aspectRatio: aspectRatioStyle,
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
                    style={{
                      width: `${Math.max(media.length, 1) * 100}%`,
                      transform: `translate3d(calc(${-resolvedActiveIndex * slideWidthPercent}% + ${dragOffset}px), 0, 0)`,
                      transition: !isDragging
                        ? `transform ${prefersReducedMotion ? 0 : 260}ms cubic-bezier(0.22, 1, 0.36, 1)`
                        : "none",
                      willChange: "transform",
                    }}
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
                              className="block h-full w-full cursor-zoom-in select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-0"
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
                                className="h-full w-full object-cover"
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

                  {resolvedMedia.length > 1 && (
                    <>
                      {resolvedActiveIndex > 0 && (
                        <button
                          type="button"
                          onClick={handlePrevButtonClick}
                          onPointerDown={stopChromePointerPropagation}
                          className="absolute left-3 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/72"
                          aria-label="Previous media"
                        >
                          <InstagramChevronIcon direction="left" />
                        </button>
                      )}
                      {resolvedActiveIndex < resolvedMedia.length - 1 && (
                        <button
                          type="button"
                          onClick={handleNextButtonClick}
                          onPointerDown={stopChromePointerPropagation}
                          className="absolute right-3 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/72"
                          aria-label="Next media"
                        >
                          <InstagramChevronIcon direction="right" />
                        </button>
                      )}
                      <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-1.5">
                        {resolvedMedia.map((_, index) => (
                          <button
                            type="button"
                            key={`${embed.id}-tiktok-dot-${index}`}
                            onClick={(event) => handleDotClick(event, index)}
                            onPointerDown={stopChromePointerPropagation}
                            aria-label={`Go to media ${index + 1}`}
                            aria-current={index === resolvedActiveIndex}
                            className={cn(
                              "h-1.5 w-1.5 rounded-full transition-all",
                              index === resolvedActiveIndex
                                ? "bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.18)]"
                                : "bg-white/45",
                            )}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 text-rm-text-primary">
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center gap-1.5 text-[13px] font-medium [font-variant-numeric:tabular-nums]">
                    <InstagramHeartIcon />
                    {formatInstagramMetricCount(likeCount) && (
                      <span>{formatInstagramMetricCount(likeCount)}</span>
                    )}
                  </div>
                  <div className="inline-flex items-center gap-1.5 text-[13px] font-medium [font-variant-numeric:tabular-nums]">
                    <InstagramCommentIcon />
                    {formatInstagramMetricCount(commentCount) && (
                      <span>{formatInstagramMetricCount(commentCount)}</span>
                    )}
                  </div>
                  {formatInstagramMetricCount(viewCount) && (
                    <div className="inline-flex items-center gap-1.5 text-[13px] font-medium text-rm-text-muted/85 [font-variant-numeric:tabular-nums]">
                      <InstagramViewsIcon />
                      <span>{formatInstagramMetricCount(viewCount)}</span>
                    </div>
                  )}
                </div>
              </div>

              {captionText && (
                <p className="text-[13px] leading-relaxed text-rm-text-primary">
                  <EmbedInlineText
                    text={captionText}
                    keyPrefix={`${embed.id}-tiktok-caption`}
                    linkClassName="text-[color-mix(in_srgb,var(--rm-accent)_78%,white)] hover:underline"
                  />
                </p>
              )}

              {displayEmbed.audio &&
                (displayEmbed.audio.title || displayEmbed.audio.artist) && (
                  <div className="flex items-center gap-2 rounded-2xl border border-rm-border/55 bg-rm-bg-surface/55 px-3 py-2 text-[12px] text-rm-text-secondary">
                    {audioPlaybackUrl ? (
                      <button
                        type="button"
                        onClick={handleAudioToggle}
                        className="group relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/75 shadow-sm ring-1 ring-rm-border/45 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--rm-accent)_68%,white)] focus-visible:ring-offset-0"
                        aria-label={
                          isAudioPlaying
                            ? "Pause audio preview"
                            : "Play audio preview"
                        }
                      >
                        {audioArtworkSrc ? (
                          <img
                            src={audioArtworkSrc}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className="inline-flex h-full w-full items-center justify-center bg-rm-bg-surface text-rm-text-primary">
                            <InstagramMusicIcon />
                          </span>
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/28 backdrop-blur-[1px]">
                          {isAudioPlaying ? (
                            <PauseIcon className="h-4 w-4" />
                          ) : (
                            <PlayIcon className="h-4 w-4" />
                          )}
                        </span>
                      </button>
                    ) : (
                      <>
                        {audioArtworkSrc ? (
                          <img
                            src={audioArtworkSrc}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-xl object-cover"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rm-bg-surface text-rm-text-primary">
                            <InstagramMusicIcon />
                          </span>
                        )}
                      </>
                    )}
                    <div className="min-w-0 flex-1 leading-tight">
                      {displayEmbed.audio.title && (
                        <div className="truncate font-semibold text-rm-text-primary">
                          <EmbedInlineText
                            text={displayEmbed.audio.title}
                            keyPrefix={`${embed.id}-tiktok-audio-title`}
                          />
                        </div>
                      )}
                      {displayEmbed.audio.artist && (
                        <div className="truncate text-rm-text-muted/86">
                          <EmbedInlineText
                            text={displayEmbed.audio.artist}
                            keyPrefix={`${embed.id}-tiktok-audio-artist`}
                          />
                        </div>
                      )}
                    </div>
                    {audioPlaybackUrl && (
                      <audio
                        ref={audioRef}
                        src={audioPlaybackUrl}
                        preload="none"
                        onPlay={() => setIsAudioPlaying(true)}
                        onPause={() => setIsAudioPlaying(false)}
                        onEnded={() => setIsAudioPlaying(false)}
                      />
                    )}
                  </div>
                )}

              <div className="flex items-center gap-2 text-[11px] text-rm-text-muted/78">
                <img
                  src={TIKTOK_ICON_URL}
                  alt=""
                  className="h-3.5 w-3.5 rounded-sm"
                />
                <span>TikTok</span>
                {displayEmbed.timestamp && (
                  <>
                    <span className="opacity-45">·</span>
                    <span>
                      {formatEmbedTimestamp(displayEmbed.timestamp) ||
                        displayEmbed.timestamp}
                    </span>
                  </>
                )}
              </div>
            </>
          ) : (
            <div
              className="relative overflow-hidden rounded-[24px] border border-rm-border/55 bg-black/95 shadow-[0_12px_36px_rgba(0,0,0,0.32)]"
              style={{ aspectRatio: "9/16" }}
            >
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
                    className="absolute inset-0 flex items-center justify-center"
                    title="Open in TikTok"
                  >
                    <ExternalIcon />
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
                        "absolute inset-0 h-full w-full object-cover",
                        player.mode === "loading" ? "opacity-50" : undefined,
                      )}
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    {player.mode === "loading" ? (
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50">
                        <PlayIcon />
                      </div>
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
  // Build the embed URL from the original Spotify URL
  const spotifyEmbedUrl = embed.url
    .replace("open.spotify.com/", "open.spotify.com/embed/")
    .replace(/\?.*$/, "");

  // Spotify iframe handles ALL rendering — we use a bare BaseEmbed (no title/desc/thumbnail)
  return (
    <BaseEmbed embed={embed} width={400} bare>
      <iframe
        src={`${spotifyEmbedUrl}?utm_source=generator&theme=0`}
        title="Spotify player"
        frameBorder="0"
        sandbox={EMBED_WIDGET_SANDBOX}
        allow="clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        className="rounded-xl"
        style={{ width: "100%", maxWidth: 400, minWidth: 280, height: 80 }}
        loading="lazy"
      />
    </BaseEmbed>
  );
});

const XReplyIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M8 10.5H5.5a2.5 2.5 0 010-5h9A4.5 4.5 0 0119 10v2a4.5 4.5 0 01-4.5 4.5H12" />
    <path d="M8 10.5l-4 4 4 4" />
  </svg>
);

const XRetweetIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M17 3l4 4-4 4" />
    <path d="M3 7h18" />
    <path d="M7 21l-4-4 4-4" />
    <path d="M21 17H3" />
  </svg>
);

const XHeartIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 20.5l-1.2-1.08C5.4 14.53 2 11.45 2 7.67 2 4.79 4.27 2.5 7.1 2.5c1.62 0 3.18.76 4.2 1.96A5.56 5.56 0 0115.5 2.5C18.33 2.5 20.6 4.79 20.6 7.67c0 3.78-3.4 6.86-8.8 11.75L12 20.5z" />
  </svg>
);

const XImpressionsIcon = ({
  className = "h-4 w-4",
}: {
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M4 19V9" />
    <path d="M10 19V5" />
    <path d="M16 19v-7" />
    <path d="M22 19v-4" />
  </svg>
);

const XBrandIcon = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M4.75 4h4.04l4.12 5.56L17.83 4h1.92l-5.99 6.85L20 20h-4.04l-4.44-5.99L6.28 20H4.36l6.31-7.22L4.75 4Zm2.02 1.1 9.73 13.8h1.47L8.24 5.1H6.77Z" />
  </svg>
);

const XOpenInNewIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M14 5h5v5" />
    <path d="M10 14L19 5" />
    <path d="M19 14v4a1 1 0 01-1 1h-12a1 1 0 01-1-1V6a1 1 0 011-1h4" />
  </svg>
);

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

function hasXMetrics(metrics?: EmbedMetrics): boolean {
  return (
    metrics?.replies !== undefined ||
    metrics?.retweets !== undefined ||
    metrics?.likes !== undefined ||
    metrics?.impressions !== undefined
  );
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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rm-border/45 pt-2.5 text-[12px] text-rm-text-muted/85 [font-variant-numeric:tabular-nums]">
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
            <span className="text-rm-text-muted/80">{item.icon}</span>
            {formattedValue && <span>{formattedValue}</span>}
          </div>
        );
      })}
    </div>
  );
});

const XFooterBar = memo(
  ({
    label,
    keyPrefix,
    timestamp,
    bordered = false,
  }: {
    label: string;
    keyPrefix: string;
    timestamp?: string | null;
    bordered?: boolean;
  }) => {
    if (!label && !timestamp) return null;

    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-rm-text-muted/80",
          bordered ? "border-t border-rm-border/45 pt-2.5" : "pt-0.5",
        )}
      >
        <span className="text-rm-text-muted/75">
          <XBrandIcon />
        </span>
        {label && (
          <span className="font-medium text-rm-text-muted/85">
            <EmbedInlineText text={label} keyPrefix={`${keyPrefix}-label`} />
          </span>
        )}
        {timestamp && (
          <>
            <span className="opacity-50">·</span>
            <span>{timestamp}</span>
          </>
        )}
      </div>
    );
  },
);

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
        <div className="max-w-[calc(100%-1.5rem)] rounded-md bg-black/82 px-2.5 py-1.5 text-[12px] leading-snug text-white shadow-sm backdrop-blur-sm">
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
  }: {
    embed: EmbedInfo;
    messageId?: string;
    onJumpToMessage?: (messageId: string) => void;
  }) => {
    const headerTimestampText = formatXHeaderTimestamp(embed.timestamp);
    const footerTimestampText = formatXFooterTimestamp(embed.timestamp);
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
      <BaseEmbed embed={embed} width={520} bare>
        <div className="flex flex-col gap-3">
          {embed.author && (
            <div className="flex items-start gap-3 min-w-0">
              {embed.author.iconURL && (
                <img
                  src={embed.author.iconURL}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover shrink-0"
                  loading="lazy"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5 text-[14px] leading-tight">
                  <a
                    href={embed.author.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate font-semibold text-rm-text-primary hover:underline"
                  >
                    <EmbedInlineText
                      text={authorParts.displayName || embed.author.name}
                      keyPrefix={`${embed.id}-author-name`}
                    />
                  </a>
                  {authorParts.handle && (
                    <span className="min-w-0 truncate text-rm-text-muted/85">
                      <EmbedInlineText
                        text={authorParts.handle}
                        keyPrefix={`${embed.id}-author-handle`}
                      />
                    </span>
                  )}
                  {headerTimestampText && (
                    <span className="shrink-0 text-rm-text-muted/85">
                      &middot; {headerTimestampText}
                    </span>
                  )}
                </div>
              </div>
              <a
                href={embed.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 shrink-0 text-rm-text-muted/80 transition-colors hover:text-rm-text-primary"
                aria-label="Open post on X"
                title="Open on X"
              >
                <XOpenInNewIcon />
              </a>
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
            />
          )}

          {hasMainMedia && externalCardDomain && embed.externalCard?.url && (
            <a
              href={embed.externalCard.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] leading-none text-rm-text-muted/82 transition-colors hover:text-rm-text-primary"
            >
              <span className="text-rm-text-muted/72">From </span>
              <span className="font-medium">{externalCardDomain}</span>
            </a>
          )}

          {embed.referencedTweet && (
            <XReferencedTweetCard
              tweet={embed.referencedTweet}
              compactMedia={hasMainMedia}
            />
          )}

          <XMetricBar metrics={embed.metrics} />
          <XFooterBar
            label={embed.footer?.text || embed.provider?.name || "X"}
            keyPrefix={`${embed.id}-footer`}
            timestamp={footerTimestampText}
            bordered={!hasXMetrics(embed.metrics)}
          />
        </div>
      </BaseEmbed>
    );
  },
);

const XReferencedTweetCard = memo(
  ({
    tweet,
    compactMedia = true,
  }: {
    tweet: NonNullable<EmbedInfo["referencedTweet"]>;
    compactMedia?: boolean;
  }) => {
    const timestampText = formatXHeaderTimestamp(tweet.timestamp);
    const media = tweet.media ?? [];
    const authorParts = useMemo(
      () => getXAuthorParts(tweet.author),
      [tweet.author],
    );

    return (
      <div className="overflow-hidden rounded-lg border border-rm-border/75 bg-rm-bg-surface/35">
        <div className="flex flex-col gap-2.5 p-3">
          {tweet.author && (
            <div className="flex items-start gap-2.5 min-w-0">
              {tweet.author.iconURL && (
                <img
                  src={tweet.author.iconURL}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-full object-cover"
                  loading="lazy"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-tight">
                  <span className="min-w-0 truncate font-semibold text-rm-text-primary">
                    <EmbedInlineText
                      text={authorParts.displayName || tweet.author.name}
                      keyPrefix={`${tweet.url || "tweet"}-author-name`}
                    />
                  </span>
                  {authorParts.handle && (
                    <span className="min-w-0 truncate text-rm-text-muted/85">
                      <EmbedInlineText
                        text={authorParts.handle}
                        keyPrefix={`${tweet.url || "tweet"}-author-handle`}
                      />
                    </span>
                  )}
                  {timestampText && (
                    <span className="shrink-0 text-rm-text-muted/85">
                      &middot; {timestampText}
                    </span>
                  )}
                </div>
              </div>
              {tweet.url && (
                <a
                  href={tweet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 shrink-0 text-rm-text-muted/80 transition-colors hover:text-rm-text-primary"
                  aria-label="Open quoted post on X"
                  title="Open on X"
                >
                  <XOpenInNewIcon className="h-3.5 w-3.5" />
                </a>
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
            linkClassName="text-primary transition-colors hover:underline"
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
      textClassName="text-[14px] leading-relaxed whitespace-pre-wrap break-words text-rm-text-primary/95"
      collapsedLabel="Show more"
      expandedLabel="Show less"
      expandAriaLabel="Expand post text"
      collapseAriaLabel="Collapse post text"
      buttonClassName="inline-flex w-fit items-center rounded-md py-0.5 text-[14px] font-medium text-primary transition-colors hover:text-primary hover:underline"
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
      textClassName="text-[13px] leading-5 whitespace-pre-wrap break-words text-rm-text-primary/90"
      collapsedLabel="..."
      expandedLabel="Show less"
      expandAriaLabel="Expand quoted post text"
      collapseAriaLabel="Collapse quoted post text"
      buttonClassName="inline-flex w-fit items-center rounded-md px-1 py-0.5 text-[12px] font-medium text-rm-text-muted/80 transition-colors hover:text-rm-text-primary data-[expanded=false]:tracking-[0.24em]"
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
  }) => {
    const attachments = mediaToAttachments(media, url, messageId);
    const visibleAttachments = attachments.slice(0, 4);
    const extraCount = Math.max(
      0,
      attachments.length - visibleAttachments.length,
    );
    const count = visibleAttachments.length;
    const { open } = useImageViewerActions();
    if (count === 0) return null;

    const openViewer = (index: number) => {
      const context: ViewerContext = {
        username: author?.name,
        avatar_url: author?.iconURL ?? null,
        created_at: createdAt,
        onJumpToMessage,
      };
      open(attachments, index, context);
    };

    const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openViewer(index);
    };

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
        />
      );
    }

    const heightClass = compact
      ? "h-[140px] sm:h-[180px]"
      : "h-[220px] sm:h-[300px]";
    const gridClass =
      count === 2
        ? cn("grid-cols-2", heightClass)
        : cn("grid-cols-2 grid-rows-2", heightClass);

    return (
      <div
        className={cn(
          "grid max-w-full gap-1 overflow-hidden rounded-[18px] border border-rm-border/45 bg-rm-bg-surface/30",
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
  }) => {
    const mediaUrl = getXAttachmentUrl(attachment);
    const isVideo = attachment.content_type?.startsWith("video/");
    const isGif = attachment.isGif === true;
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
          />
        </div>
      )
    ) : (
      <img
        src={mediaUrl}
        alt={attachment.filename}
        className={
          single
            ? compact
              ? `h-[180px] w-auto max-w-full object-contain ${singleObjectPositionClass} transition-all duration-300 hover:brightness-105`
              : `h-auto max-h-[420px] w-auto max-w-full object-contain ${singleObjectPositionClass} transition-all duration-300 hover:brightness-105`
            : "h-full w-full object-cover transition-all duration-300 hover:brightness-105"
        }
        loading="lazy"
        referrerPolicy="no-referrer"
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
                "rounded-[18px] border border-rm-border/45 bg-rm-bg-surface/30",
            )
          : cn(
              "block w-fit max-w-full",
              !isVideo &&
                usesFramedSingleChrome &&
                "rounded-[20px] border border-rm-border/45 bg-rm-bg-surface/30",
              isVideo && usesFramedSingleChrome && "rounded-[20px]",
            )
        : "block",
      !isVideo || isGif ? "cursor-zoom-in" : "",
      className,
    );

    if (!isVideo) {
      return (
        <button
          type="button"
          className={cn(wrapperClassName, "appearance-none p-0 text-left")}
          onClick={() => openViewerSafely(onOpen, index)}
          onKeyDown={(event) => onKeyDown(event, index)}
          aria-label={isGif ? "Open GIF viewer" : "Open media viewer"}
          title={
            url ? (isGif ? "Open GIF viewer" : "Open media viewer") : undefined
          }
        >
          {content}
          {overlay}
          {extraCount > 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-bold text-white">
              +{extraCount}
            </div>
          )}
        </button>
      );
    }

    if (isGif) {
      return (
        <div
          role="button"
          tabIndex={0}
          className={cn(
            wrapperClassName,
            "text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-0",
          )}
          onClick={() => openViewerSafely(onOpen, index)}
          onKeyDown={(event) => onKeyDown(event, index)}
          aria-label="Open GIF viewer"
          title={url ? "Open GIF viewer" : undefined}
        >
          {content}
          {overlay}
          {extraCount > 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-bold text-white">
              +{extraCount}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className={wrapperClassName}>
        {content}
        {overlay}
        {extraCount > 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-bold text-white">
            +{extraCount}
          </div>
        )}
      </div>
    );
  },
);

function openViewerSafely(
  openViewer: (index: number) => void,
  index: number,
): void {
  openViewer(index);
}

const XGifTile = memo(
  ({
    attachment,
    src,
    single = false,
    compact = false,
    onOpenViewer,
  }: {
    attachment: XMediaAttachment;
    src: string;
    single?: boolean;
    compact?: boolean;
    onOpenViewer: () => void;
  }) => {
    const [paused, setPaused] = useState(false);
    const [altPinned, setAltPinned] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const altControlRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = usePrefersReducedMotion();
    const titleId = useId();
    const altTextId = useId();
    const altText = attachment.alt_text?.trim() || "";
    const hasAltText = altText.length > 0;
    const sourceUrl = unwrapProxyMediaUrl(src);
    const favoriteWebpUrl = getFxTwitterGifWebpUrl(sourceUrl);
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
      previewUrl: favoriteWebpUrl || src,
      sendUrl: favoriteWebpUrl || src,
      width: attachment.width,
      height: attachment.height,
      sizeBytes: attachment.size_bytes,
      contentType: favoriteWebpUrl ? "image/webp" : attachment.content_type,
    });
    const singleMediaClass = compact
      ? "h-full w-full object-contain object-left"
      : "h-auto max-h-[420px] w-full object-contain object-left";

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      if (prefersReducedMotion || paused) {
        video.pause();
        return;
      }

      void video.play().catch(() => {
        // Browser/autoplay support decides whether inline GIF playback starts.
      });
    }, [paused, prefersReducedMotion]);

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

    return (
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center bg-transparent",
          single && !compact && "max-h-[420px]",
        )}
        data-x-gif="true"
      >
        {loadError ? (
          <img
            src={favoriteWebpUrl || posterUrl}
            alt={attachment.filename}
            className={cn(
              single ? singleMediaClass : "h-full w-full object-contain",
            )}
            loading="lazy"
          />
        ) : (
          <video
            ref={videoRef}
            src={src}
            poster={posterUrl}
            className={cn(
              single ? singleMediaClass : "h-full w-full object-contain",
            )}
            autoPlay={!prefersReducedMotion}
            loop
            muted
            playsInline
            preload="metadata"
            aria-labelledby={titleId}
            onError={() => setLoadError(true)}
          >
            <track kind="captions" />
          </video>
        )}
        <GifFavoriteButton gif={favorite} />
        <div className="absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-black/70 via-black/20 to-transparent px-2 pb-2 pt-8">
          <div className="flex items-center gap-2 text-white">
            <button
              type="button"
              onClick={handleTogglePaused}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-black/45 transition-colors hover:bg-black/65"
              aria-label={paused ? "Play GIF" : "Pause GIF"}
              title={paused ? "Play GIF" : "Pause GIF"}
            >
              {paused ? (
                <PlayIcon className="h-3.5 w-3.5" />
              ) : (
                <PauseIcon className="h-3.5 w-3.5" />
              )}
              <span className="sr-only" id={titleId}>
                {paused ? "Play GIF" : "Pause GIF"}
              </span>
            </button>

            <button
              type="button"
              onClick={handleOpenViewer}
              className="rounded-md bg-black/45 px-2 py-1 text-[12px] font-bold tracking-[0.12em] transition-colors hover:bg-black/65"
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
                  className="rounded-md bg-black/45 px-2 py-1 text-[12px] font-bold transition-colors hover:bg-black/65"
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
                    "pointer-events-none absolute bottom-full left-0 mb-2 w-[min(18rem,calc(100vw-3rem))] rounded-lg border border-white/10 bg-black/90 px-3 py-2 text-[12px] leading-relaxed text-white shadow-xl transition-opacity duration-150 group-hover/x-gif-alt:opacity-100",
                    altPinned ? "opacity-100" : "opacity-0",
                  )}
                  role="tooltip"
                >
                  {altText}
                </div>
              </div>
            )}
          </div>
        </div>
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
    id: `${filenamePrefix}-media-${index}-${item.url}`,
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
    <BaseEmbed embed={embed} width={432}>
      {embed.thumbnail?.url && (
        <div className="relative rounded-md overflow-hidden">
          <a href={embed.url} target="_blank" rel="noopener noreferrer">
            <img
              src={embed.thumbnail.url}
              alt="Video thumbnail"
              className="w-full h-auto object-cover max-h-[400px]"
            />
          </a>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-14 h-14 bg-black/50 rounded-full flex items-center justify-center">
              <PlayIcon />
            </div>
          </div>
        </div>
      )}
    </BaseEmbed>
  );
});

const RichEmbed = memo(
  ({ embed, onMediaPlay }: { embed: EmbedInfo; onMediaPlay?: () => void }) => {
    const [playing, setPlaying] = useState(false);

    const handlePlay = useCallback(() => {
      setPlaying(true);
      onMediaPlay?.();
    }, [onMediaPlay]);

    return (
      <BaseEmbed embed={embed} width={432}>
        <div className="flex flex-col gap-2">
          {embed.author && (
            <div className="flex items-center gap-2">
              <a
                href={embed.author.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-[14px] text-rm-text-primary hover:underline"
              >
                <EmbedInlineText
                  text={embed.author.name}
                  keyPrefix={`${embed.id}-rich-author`}
                />
              </a>
            </div>
          )}

          {embed.thumbnail?.url && (
            <div className="relative rounded-md overflow-hidden border border-rm-border/30">
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
                    className="w-full h-auto object-cover max-h-[300px]"
                  />
                  {embed.video && (
                    <div className="absolute inset-0 flex items-center justify-center gap-3">
                      <button
                        onClick={handlePlay}
                        className="w-12 h-12 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                        aria-label="Play video"
                      >
                        <PlayIcon />
                      </button>
                      <a
                        href={embed.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-10 h-10 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors"
                        aria-label="Open in new tab"
                      >
                        <ExternalIcon />
                      </a>
                    </div>
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

const TIKTOK_ICON_URL = "https://www.tiktok.com/favicon.ico";
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

const InstagramChevronIcon = ({
  direction,
  className = "h-4 w-4",
}: {
  direction: "left" | "right";
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {direction === "left" ? (
      <path d="m15 5-7 7 7 7" />
    ) : (
      <path d="m9 5 7 7-7 7" />
    )}
  </svg>
);

const InstagramHeartIcon = ({
  className = "h-5 w-5",
}: {
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 20.8 10.8 19.7C5.4 14.9 2 11.8 2 7.9 2 4.9 4.3 2.6 7.2 2.6c1.8 0 3.5.8 4.8 2.2 1.3-1.4 3-2.2 4.8-2.2 2.9 0 5.2 2.3 5.2 5.3 0 3.9-3.4 7-8.8 11.8L12 20.8Z" />
  </svg>
);

const InstagramCommentIcon = ({
  className = "h-5 w-5",
}: {
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M20 14.5a4.5 4.5 0 0 1-4.5 4.5H8l-4 3V7.5A4.5 4.5 0 0 1 8.5 3h7A4.5 4.5 0 0 1 20 7.5Z" />
  </svg>
);

const InstagramSendIcon = ({
  className = "h-5 w-5",
}: {
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4Z" />
  </svg>
);

const InstagramBookmarkIcon = ({
  className = "h-5 w-5",
}: {
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4.2-7 4.2v-16a1 1 0 0 1 1-1Z" />
  </svg>
);

const InstagramViewsIcon = ({
  className = "h-5 w-5",
}: {
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const InstagramVerifiedIcon = ({
  className = "h-4 w-4",
}: {
  className?: string;
}) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4c98ff"
      d="M12 2.7 14 4l2.4-.1 1 2.1 2.2 1 .1 2.4 1.3 2-1.3 2 .1 2.4-2.2 1-1 2.1-2.4-.1L12 21.3l-2-1.3-2.4.1-1-2.1-2.2-1 .1-2.4-1.3-2 1.3-2-.1-2.4 2.2-1 1-2.1L10 4Z"
    />
    <path
      fill="#fff"
      d="m10.6 15.9-3-3 1.2-1.2 1.8 1.8 4.6-4.7 1.2 1.2-5.8 5.9Z"
    />
  </svg>
);

const InstagramMusicIcon = ({
  className = "h-4 w-4",
}: {
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M9 18V6l10-2v12" />
    <path d="M9 10 19 8" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="16" cy="16" r="3" />
  </svg>
);

function formatInstagramMetricCount(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  return value > 0 ? formatXMetricCount(value) : "0";
}

function formatInstagramTimestamp(timestamp?: string): string | null {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) return "just now";

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60)
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24)
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;

  return X_HEADER_DATE_WITH_YEAR_FORMATTER.format(date);
}

function needsInstagramHydration(embed: EmbedInfo): boolean {
  const hasMedia = Array.isArray(embed.media) && embed.media.length > 0;
  const hasCounts =
    embed.metrics?.likes !== undefined ||
    embed.metrics?.comments !== undefined ||
    embed.metrics?.views !== undefined;

  return (
    !hasMedia ||
    !embed.author?.iconURL ||
    embed.author?.isVerified === undefined ||
    !hasCounts ||
    !embed.timestamp
  );
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

function hydrateInstagramEmbed(
  embed: EmbedInfo,
  payload: InstagramHydrationPayload | null,
): EmbedInfo {
  if (!payload) return embed;

  const media = payload.media?.length ? payload.media : embed.media;
  const firstVideo = media?.find((entry) => entry.type === "video");
  const firstMedia = media?.[0];
  const nextThumbnailUrl =
    embed.thumbnail?.url ??
    payload.thumbnailUrl ??
    firstVideo?.thumbnailUrl ??
    firstMedia?.url;
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
  const nextAuthorIcon =
    embed.author?.iconURL ?? payload.authorAvatarUrl ?? undefined;
  const nextAuthorVerified =
    embed.author?.isVerified ?? payload.authorVerified ?? undefined;
  const nextAuthor = embed.author
    ? {
        ...embed.author,
        iconURL: nextAuthorIcon,
        isVerified: nextAuthorVerified,
      }
    : embed.author;

  return {
    ...embed,
    rawTitle: embed.rawTitle ?? payload.title ?? undefined,
    thumbnail: nextThumbnail,
    media,
    video:
      embed.video?.url && embed.video.kind !== "player"
        ? embed.video
        : payload.videoUrl
          ? {
              url: payload.videoUrl,
              width: firstVideo?.width ?? embed.video?.width ?? 720,
              height: firstVideo?.height ?? embed.video?.height ?? 1280,
              kind: "direct",
              contentType: embed.video?.contentType ?? "video/mp4",
              durationSeconds:
                embed.video?.durationSeconds ??
                payload.durationSeconds ??
                undefined,
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
    audio: embed.audio ?? payload.audio ?? undefined,
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
    messageId,
    onJumpToMessage,
  }: {
    embed: EmbedInfo;
    onMediaPlay?: () => void;
    messageId?: string;
    onJumpToMessage?: (messageId: string) => void;
  }) => {
    const [hydratedPayload, setHydratedPayload] =
      useState<InstagramHydrationPayload | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [dragOffset, setDragOffset] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isAudioPlaying, setIsAudioPlaying] = useState(false);
    const trackRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
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
    const prefersReducedMotion = usePrefersReducedMotion();
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
    const timestampText = formatInstagramTimestamp(displayEmbed.timestamp);
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

      const el = trackRef.current;
      if (!el) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries[0]?.isIntersecting || fetchedRef.current) return;
          fetchedRef.current = true;
          observer.disconnect();

          fetch(
            apiUrl(
              `/api/instagram-video?videoUrl=${encodeURIComponent(embed.url)}`,
            ),
          )
            .then((res) => {
              if (!res.ok) throw new Error(`${res.status}`);
              return res.json() as Promise<InstagramHydrationPayload>;
            })
            .then((payload) => {
              setHydratedPayload(payload);
            })
            .catch(() => {
              setHydratedPayload(null);
            });
        },
        { threshold: 0.2 },
      );

      observer.observe(el);
      return () => observer.disconnect();
    }, [embed.url, needsHydration]);

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
          onMediaPlay?.();
        } catch {
          setIsAudioPlaying(false);
        }
        return;
      }

      audioElement.pause();
      setIsAudioPlaying(false);
    }, [onMediaPlay]);

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

    return (
      <BaseEmbed embed={displayEmbed} width={392} bare>
        <article className="flex flex-col gap-3">
          <header className="flex items-center gap-3">
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-rm-bg-surface/70 ring-1 ring-rm-border/60">
              {displayEmbed.author?.iconURL ? (
                <img
                  src={getAuthAssetUrl(
                    buildProxyMediaPath(displayEmbed.author.iconURL, embed.url),
                  )}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-full w-full bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--rm-accent)_55%,transparent),transparent_65%)]" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[14px] leading-tight">
                {displayEmbed.author?.url ? (
                  <a
                    href={displayEmbed.author.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-semibold text-rm-text-primary hover:underline"
                  >
                    <EmbedInlineText
                      text={displayEmbed.author.name}
                      keyPrefix={`${embed.id}-instagram-author`}
                    />
                  </a>
                ) : (
                  <span className="truncate font-semibold text-rm-text-primary">
                    <EmbedInlineText
                      text={displayEmbed.author?.name || "Instagram"}
                      keyPrefix={`${embed.id}-instagram-author`}
                    />
                  </span>
                )}
                {displayEmbed.author?.isVerified && (
                  <InstagramVerifiedIcon className="h-3.5 w-3.5 shrink-0" />
                )}
              </div>
              {timestampText && (
                <div className="text-[12px] text-rm-text-muted/82">
                  {timestampText}
                </div>
              )}
            </div>

            <a
              href={embed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/72 text-white shadow-sm transition-colors hover:bg-black/85"
              title="Open in Instagram"
              aria-label="Open in Instagram"
            >
              <ExternalIcon />
            </a>
          </header>

          <div className="relative overflow-hidden rounded-[22px] border border-rm-border/55 bg-black/95 shadow-[0_12px_36px_rgba(0,0,0,0.28)]">
            <div
              ref={trackRef}
              className="relative w-full overflow-hidden"
              style={{
                aspectRatio: aspectRatioStyle,
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
                style={{
                  width: `${Math.max(media.length, 1) * 100}%`,
                  transform: `translate3d(calc(${-resolvedActiveIndex * slideWidthPercent}% + ${dragOffset}px), 0, 0)`,
                  transition: !isDragging
                    ? `transform ${prefersReducedMotion ? 0 : 260}ms cubic-bezier(0.22, 1, 0.36, 1)`
                    : "none",
                  willChange: "transform",
                }}
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
                          className="block h-full w-full cursor-zoom-in select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-0"
                          aria-label={`Open media ${index + 1} of ${media.length}`}
                          data-instagram-image-index={index}
                        >
                          <img
                            src={imageSrc}
                            alt={
                              item.altText ||
                              displayEmbed.rawTitle ||
                              "Instagram post media"
                            }
                            className="h-full w-full object-cover"
                            loading={index === 0 ? "eager" : "lazy"}
                            referrerPolicy="no-referrer"
                            draggable={false}
                            onDragStart={preventNativeDrag}
                          />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {media.length > 1 && (
                <>
                  {resolvedActiveIndex > 0 && (
                    <button
                      type="button"
                      onClick={handlePrevButtonClick}
                      onPointerDown={stopChromePointerPropagation}
                      className="absolute left-3 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/72"
                      aria-label="Previous media"
                    >
                      <InstagramChevronIcon direction="left" />
                    </button>
                  )}
                  {resolvedActiveIndex < media.length - 1 && (
                    <button
                      type="button"
                      onClick={handleNextButtonClick}
                      onPointerDown={stopChromePointerPropagation}
                      className="absolute right-3 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/72"
                      aria-label="Next media"
                    >
                      <InstagramChevronIcon direction="right" />
                    </button>
                  )}
                  <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-1.5">
                    {media.map((_, index) => (
                      <button
                        type="button"
                        key={`${embed.id}-instagram-dot-${index}`}
                        onClick={(event) => handleDotClick(event, index)}
                        onPointerDown={stopChromePointerPropagation}
                        aria-label={`Go to media ${index + 1}`}
                        aria-current={index === resolvedActiveIndex}
                        className={cn(
                          "h-1.5 w-1.5 rounded-full transition-all",
                          index === resolvedActiveIndex
                            ? "bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.18)]"
                            : "bg-white/45",
                        )}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 text-rm-text-primary">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-1.5 text-[13px] font-medium [font-variant-numeric:tabular-nums]">
                <InstagramHeartIcon />
                {formatInstagramMetricCount(likeCount) && (
                  <span>{formatInstagramMetricCount(likeCount)}</span>
                )}
              </div>
              <div className="inline-flex items-center gap-1.5 text-[13px] font-medium [font-variant-numeric:tabular-nums]">
                <InstagramCommentIcon />
                {formatInstagramMetricCount(commentCount) && (
                  <span>{formatInstagramMetricCount(commentCount)}</span>
                )}
              </div>
              {formatInstagramMetricCount(viewCount) && (
                <div className="inline-flex items-center gap-1.5 text-[13px] font-medium text-rm-text-muted/85 [font-variant-numeric:tabular-nums]">
                  <InstagramViewsIcon />
                  <span>{formatInstagramMetricCount(viewCount)}</span>
                </div>
              )}
            </div>

            <div className="inline-flex items-center gap-3 text-rm-text-muted/82">
              <InstagramSendIcon />
              <InstagramBookmarkIcon />
            </div>
          </div>

          {captionText && (
            <p className="text-[13px] leading-relaxed text-rm-text-primary">
              {displayEmbed.author?.name && (
                <span className="mr-1 font-semibold">
                  {displayEmbed.author.name}
                </span>
              )}
              <EmbedInlineText
                text={captionText}
                keyPrefix={`${embed.id}-instagram-caption`}
                linkClassName="text-[color-mix(in_srgb,var(--rm-accent)_78%,white)] hover:underline"
              />
            </p>
          )}

          {typeof commentCount === "number" && commentCount > 0 && (
            <a
              href={embed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-rm-text-muted/86 transition-colors hover:text-rm-text-primary"
            >
              View all {commentCount.toLocaleString()} comments
            </a>
          )}

          {displayEmbed.audio &&
            (displayEmbed.audio.title || displayEmbed.audio.artist) && (
              <div className="flex items-center gap-2 rounded-2xl border border-rm-border/55 bg-rm-bg-surface/55 px-3 py-2 text-[12px] text-rm-text-secondary">
                {audioPlaybackUrl ? (
                  <button
                    type="button"
                    onClick={handleAudioToggle}
                    className="group relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/75 shadow-sm ring-1 ring-rm-border/45 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--rm-accent)_68%,white)] focus-visible:ring-offset-0"
                    aria-label={
                      isAudioPlaying
                        ? "Pause audio preview"
                        : "Play audio preview"
                    }
                  >
                    {audioArtworkSrc ? (
                      <img
                        src={audioArtworkSrc}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="inline-flex h-full w-full items-center justify-center bg-rm-bg-surface text-rm-text-primary">
                        <InstagramMusicIcon />
                      </span>
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/28 backdrop-blur-[1px]">
                      {isAudioPlaying ? (
                        <PauseIcon className="h-4 w-4" />
                      ) : (
                        <PlayIcon className="h-4 w-4" />
                      )}
                    </span>
                  </button>
                ) : (
                  <>
                    {audioArtworkSrc ? (
                      <img
                        src={audioArtworkSrc}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-xl object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rm-bg-surface text-rm-text-primary">
                        <InstagramMusicIcon />
                      </span>
                    )}
                  </>
                )}
                <div className="min-w-0 flex-1 leading-tight">
                  {displayEmbed.audio.title && (
                    <div className="truncate font-semibold text-rm-text-primary">
                      {displayEmbed.audio.title}
                    </div>
                  )}
                  {displayEmbed.audio.artist && (
                    <div className="truncate text-rm-text-muted/86">
                      {displayEmbed.audio.artist}
                    </div>
                  )}
                </div>
                {audioPlaybackUrl && (
                  <audio
                    ref={audioRef}
                    src={audioPlaybackUrl}
                    preload="none"
                    onPlay={() => setIsAudioPlaying(true)}
                    onPause={() => setIsAudioPlaying(false)}
                    onEnded={() => setIsAudioPlaying(false)}
                  />
                )}
              </div>
            )}

          <div className="flex items-center gap-2 text-[11px] text-rm-text-muted/78">
            <img
              src={INSTAGRAM_ICON_URL}
              alt=""
              className="h-3.5 w-3.5 rounded-sm"
            />
            <span>Instagram</span>
            {displayEmbed.timestamp && (
              <>
                <span className="opacity-45">·</span>
                <span>
                  {formatEmbedTimestamp(displayEmbed.timestamp) ||
                    displayEmbed.timestamp}
                </span>
              </>
            )}
          </div>
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
  const providerName = embed.provider?.name?.toLowerCase();
  const displayEmbed = useMemo<EmbedInfo>(
    () =>
      providerName === "instagram" && !embed.rawTitle && !embed.rawDescription
        ? { ...embed, rawTitle: getInstagramFallbackTitle(embed.url) }
        : embed,
    [embed, providerName],
  );
  const thumbnailSrc =
    embed.provider?.name?.toLowerCase() === "instagram" && embed.thumbnail?.url
      ? getAuthAssetUrl(buildProxyMediaPath(embed.thumbnail.url, embed.url))
      : embed.thumbnail?.url;

  return (
    <BaseEmbed embed={displayEmbed} width={432}>
      {thumbnailSrc && (
        <a href={embed.url} target="_blank" rel="noopener noreferrer">
          <img
            src={thumbnailSrc}
            alt="Thumbnail"
            className="w-full h-auto rounded-md object-cover max-h-[300px]"
            referrerPolicy="no-referrer"
          />
        </a>
      )}
    </BaseEmbed>
  );
});

// ─── Main Component ─────────────────────────────────────────────────────

export const LinkEmbed = memo(
  ({
    embed,
    messageId,
    onJumpToMessage,
    onRemoveEmbeds,
    onMediaPlay,
  }: {
    embed: EmbedInfo;
    messageId?: string;
    onJumpToMessage?: (messageId: string) => void;
    onRemoveEmbeds?: () => void;
    onMediaPlay?: () => void;
  }) => {
    const [showModal, setShowModal] = useState(false);
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
    if (providerName === "youtube" && embed.video?.url) {
      embedContent = <YouTubeEmbed embed={embed} onMediaPlay={onMediaPlay} />;
    } else if (providerName === "tiktok") {
      embedContent = (
        <TikTokEmbed
          key={getTikTokHydrationSignature(embed)}
          embed={embed}
          onMediaPlay={onMediaPlay}
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
        />
      );
    } else {
      // Type-based routing
      switch (embed.type) {
        case "video":
          embedContent = <VideoEmbed embed={embed} />;
          break;
        case "rich":
          embedContent = <RichEmbed embed={embed} onMediaPlay={onMediaPlay} />;
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
              className="absolute -top-2 -right-6 z-20 w-5 h-5 flex items-center justify-center rounded text-rm-text-muted hover:text-rm-text-primary hover:bg-rm-bg-hover opacity-0 group-hover/embedwrap:opacity-100 transition-all"
              aria-label="Remove embeds"
              title="Remove all embeds (Shift+click to skip confirmation)"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        {showModal && (
          <RemoveEmbedsModal
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        )}
      </>
    );
  },
);
