import type { Attachment, EmbedAuthor, EmbedInfo, EmbedMedia } from "@/lib/types";
import { apiUrl, getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import { createExternalGifFavorite, getFxTwitterGifWebpUrl, unwrapProxyMediaUrl } from "@/lib/gif-favorite-item";
import { buildProxyMediaPath, buildProxyMediaUrl } from "@/lib/proxy-media-url";
import { primeVideoPlaybackAvailability } from "@/lib/video-playback-availability";
import { cn } from "@/lib/utils";
import type { ViewerContext } from "@/stores/useImageViewerStore";
import { useImageViewerActions } from "@/stores/useImageViewerStore";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { GifFavoriteButton } from "./GifFavoriteButton";
import VideoAttachment from "./VideoAttachment";

// ─── Shared Base Components ───────────────────────────────────────────────

interface BaseEmbedProps {
  embed: EmbedInfo;
  children: React.ReactNode;
  width?: number;
  /** If true, skip rendering rawTitle/rawDescription/provider inside the wrapper */
  bare?: boolean;
}

const BaseEmbed = memo(({ embed, children, width, bare }: BaseEmbedProps) => {
  const timestampText = formatEmbedTimestamp(embed.timestamp);

  return (
    <div
      className="overflow-hidden rounded-md border border-rm-border bg-rm-bg-elevated/40 text-rm-text-primary"
      style={{
        borderLeftColor: embed.color || "#202225",
        borderLeftWidth: 4,
        width: width ? `${width}px` : "100%",
        maxWidth: "100%"
      }}
    >
      <div className="p-3 flex flex-col gap-1.5">
        {!bare && embed.provider && (
          <div className="text-[12px] font-semibold text-rm-text-muted/80">
            {embed.provider.name}
          </div>
        )}

        {!bare && embed.rawTitle && (
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[15px] font-bold text-[#00A8FC] hover:underline leading-snug break-words"
          >
            {embed.rawTitle}
          </a>
        )}

        {!bare && embed.rawDescription && (
          <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words mt-0.5 opacity-90 line-clamp-3">
            {embed.rawDescription}
          </div>
        )}

        {children}

        {!bare && embed.footer && (
          <div className="flex items-center gap-2 text-[12px] text-rm-text-muted/80 mt-1">
            {embed.footer.iconURL && (
              <img src={embed.footer.iconURL} alt="" className="w-4 h-4 rounded-full" />
            )}
            <span>{embed.footer.text}</span>
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
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDelta = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);
  const timeText = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  if (dayDelta === 0) return `Today at ${timeText}`;
  if (dayDelta === 1) return `Yesterday at ${timeText}`;

  const dateText = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);

  return `${dateText} ${timeText}`;
}

const RemoveEmbedsModal = memo(({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={onCancel}>
    <div
      className="w-full max-w-[440px] rounded-xl bg-rm-bg-surface border border-rm-border shadow-2xl p-6"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="text-xl font-bold text-rm-text-primary mb-2">Are you sure?</h2>
      <p className="text-[14px] text-rm-text-secondary leading-relaxed">
        This will remove all embeds on this message for everyone.
      </p>
      <p className="text-[12px] text-rm-text-muted mt-2 mb-6">
        Hold shift when clearing embeds to skip this modal.
      </p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 rounded-md text-[14px] font-medium text-rm-text-secondary hover:text-rm-text-primary hover:bg-rm-bg-hover transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-5 py-2.5 rounded-md text-[14px] font-medium text-white bg-[#da373c] hover:bg-[#a12828] transition-colors"
        >
          Remove All Embeds
        </button>
      </div>
    </div>
  </div>
));

// ─── Overlay Button ───────────────────────────────────────────────────────

const PlayIcon = ({ className = "w-7 h-7 ml-0.5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="white" className={className}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

const ExternalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
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

const DirectVideoEmbed = memo(({
  src,
  filename,
  maxWidth,
  maxHeight,
  poster,
  referrerPolicy,
  onVideoError,
}: {
  src: string;
  filename: string;
  maxWidth: number;
  maxHeight: number;
  poster?: string;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  onVideoError?: () => void;
}) => (
  <VideoAttachment
    src={src}
    filename={filename}
    maxWidth={maxWidth}
    maxHeight={maxHeight}
    poster={poster}
    referrerPolicy={referrerPolicy}
    showDownload={false}
    onVideoError={onVideoError}
  />
));

// ─── Platform-specific Renderers ──────────────────────────────────────────

const YouTubeEmbed = memo(({ embed, onMediaPlay }: { embed: EmbedInfo; onMediaPlay?: () => void }) => {
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
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
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
});

type TikTokPlayerState =
  | { mode: "idle" }
  | { mode: "loading" }
  | { mode: "direct"; videoUrl: string; coverUrl: string | null }
  | { mode: "iframe" }
  | { mode: "error" };

function getTikTokVideoId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.match(/(?:\/video\/|\/player\/v1\/)(\d+)/)?.[1] ?? null;
  } catch {
    return rawUrl.match(/(?:\/video\/|\/player\/v1\/)(\d+)/)?.[1] ?? null;
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

const TikTokEmbed = memo(({ embed, onMediaPlay }: { embed: EmbedInfo; onMediaPlay?: () => void }) => {
  const iframeUrl = embed.video?.url && embed.video.kind !== "direct"
    ? withTikTokPlayerOptions(embed.video.url)
    : (() => {
      const videoId = getTikTokVideoId(embed.url);
      return videoId
        ? withTikTokPlayerOptions(`https://www.tiktok.com/player/v1/${videoId}`)
        : null;
    })();

  const [player, setPlayer] = useState<TikTokPlayerState>({ mode: "idle" });
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  // Fetch direct video URL when the embed enters the viewport
  useEffect(() => {
    if (!embed.url || fetchedRef.current) return;

    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || fetchedRef.current) return;
        fetchedRef.current = true;
        observer.disconnect();

        setPlayer({ mode: "loading" });
        fetch(apiUrl(`/api/tiktok-video?videoUrl=${encodeURIComponent(embed.url)}`))
          .then((res) => {
            if (!res.ok) throw new Error(`${res.status}`);
            return res.json() as Promise<{ videoUrl: string; coverUrl: string | null }>;
          })
          .then(({ videoUrl, coverUrl }) => {
            setPlayer({ mode: "direct", videoUrl: buildProxyMediaUrl(videoUrl, embed.url), coverUrl });
          })
          .catch(() => {
            // tikwm failed or rate-limited — fall straight through to iframe
            setPlayer({ mode: "iframe" });
          });
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [embed.url]);

  const handleVideoError = useCallback(() => {
    // Signed direct URL expired mid-session — fall back to iframe
    setPlayer({ mode: "iframe" });
  }, []);

  return (
    <BaseEmbed embed={embed} width={300}>
      {/* Direct custom player — same player stack as X embeds */}
      {player.mode === "direct" && (
        <DirectVideoEmbed
          src={player.videoUrl}
          filename="tiktok-video.mp4"
          maxWidth={300}
          maxHeight={450}
          poster={player.coverUrl ?? embed.thumbnail?.url}
          referrerPolicy="no-referrer"
          onVideoError={handleVideoError}
        />
      )}

      {/* Fixed-height container for iframe, idle, and loading states */}
      {player.mode !== "direct" && (
        <div
          ref={containerRef}
          className="relative rounded-md overflow-hidden bg-black"
          style={{ height: 450, maxWidth: 300 }}
        >
          {/* Idle: just the thumbnail until the embed scrolls into view */}
          {player.mode === "idle" && (
            <>
              {embed.thumbnail?.url && (
                <img
                  src={embed.thumbnail.url}
                  alt={embed.rawTitle || "TikTok video"}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center">
                  <PlayIcon />
                </div>
              </div>
            </>
          )}

          {/* Loading: spinner while tikwm resolves */}
          {player.mode === "loading" && (
            <>
              {embed.thumbnail?.url && (
                <img
                  src={embed.thumbnail.url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-50"
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              </div>
            </>
          )}

          {/* Iframe fallback — tikwm unavailable or direct URL expired */}
          {(player.mode === "iframe" || player.mode === "error") && iframeUrl && (
            <iframe
              src={iframeUrl}
              className="absolute inset-0 h-full w-full border-0"
              allow="fullscreen; autoplay"
              allowFullScreen
              loading="lazy"
              onLoad={onMediaPlay}
              title={embed.rawTitle || "TikTok video"}
            />
          )}

          {/* No video URL at all — link out */}
          {(player.mode === "iframe" || player.mode === "error") && !iframeUrl && (
            <a
              href={embed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute inset-0 flex items-center justify-center"
              title="Open in TikTok"
            >
              <ExternalIcon />
            </a>
          )}
        </div>
      )}
    </BaseEmbed>
  );
});

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
        frameBorder="0"
        sandbox="allow-forms allow-modals allow-same-origin allow-scripts"
        allow="clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        className="rounded-xl"
        style={{ width: "100%", maxWidth: 400, minWidth: 280, height: 80 }}
        loading="lazy"
      />
    </BaseEmbed>
  );
});

const InstagramEmbed = memo(({ embed }: { embed: EmbedInfo }) => {
  const parsed = new URL(embed.url);
  // The embed path is /p/POSTID/embed/ or /reel/POSTID/embed/
  let embedPath = parsed.pathname;
  if (!embedPath.endsWith('/')) embedPath += '/';
  // Use Instagram's official iframe endpoint
  const embedUrl = `https://www.instagram.com${embedPath}embed/captioned/`;

  return (
    <BaseEmbed embed={embed} width={360} bare>
      <iframe
        src={embedUrl}
        className="rounded-xl w-full border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black"
        style={{ minWidth: 320, maxWidth: 360, height: 500 }}
        scrolling="vertical"
        frameBorder="0"
        // @ts-ignore
        allowtransparency={"true"}
        allowFullScreen={true}
        sandbox="allow-forms allow-modals allow-same-origin allow-scripts allow-presentation"
      />
    </BaseEmbed>
  );
});

const XEmbed = memo(({
  embed,
  messageId,
  onJumpToMessage,
}: {
  embed: EmbedInfo;
  messageId?: string;
  onJumpToMessage?: (messageId: string) => void;
}) => {
  const timestampText = formatEmbedTimestamp(embed.timestamp);
  const footerIcon = embed.footer?.iconURL || "https://abs.twimg.com/responsive-web/client-web/icon-default.522d363a.png";
  const mainMedia = Array.isArray(embed.media) && embed.media.length > 0
    ? embed.media
    : (embed.video?.url && embed.video.kind !== "player"
      ? [{
        type: "video" as const,
        url: embed.video.url,
        width: embed.video.width,
        height: embed.video.height,
        thumbnailUrl: embed.thumbnail?.url,
        contentType: embed.video.contentType,
      }]
      : embed.thumbnail?.url
        ? [{ type: "image" as const, url: embed.thumbnail.url, width: embed.thumbnail.width, height: embed.thumbnail.height }]
        : []);
  const hasMainMedia = mainMedia.length > 0;

  return (
    <BaseEmbed embed={embed} width={520} bare>
      <div className="flex flex-col gap-3">
        {embed.author && (
          <div className="flex items-center gap-2 min-w-0">
            {embed.author.iconURL && (
              <img
                src={embed.author.iconURL}
                alt=""
                className="w-5 h-5 rounded-full object-cover shrink-0"
                loading="lazy"
              />
            )}
            <a
              href={embed.author.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate font-semibold text-[14px] leading-tight text-rm-text-primary hover:underline"
            >
              {embed.author.name}
            </a>
          </div>
        )}

        {embed.rawDescription && (
          <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words text-rm-text-primary/95">
            {embed.rawDescription}
          </div>
        )}

        {hasMainMedia && (
          <XMediaGrid
            media={mainMedia}
            url={embed.url}
            author={embed.author}
            createdAt={embed.timestamp}
            messageId={messageId}
            onJumpToMessage={onJumpToMessage}
          />
        )}

        {embed.referencedTweet && <XReferencedTweetCard tweet={embed.referencedTweet} />}

        {embed.footer && (
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-rm-text-muted/85">
            <img src={footerIcon} alt="" className="w-4 h-4 rounded-full" loading="lazy" />
            <span>{embed.footer.text || "X"}</span>
            {timestampText && (
              <>
                <span className="opacity-60">&middot;</span>
                <span>{timestampText}</span>
              </>
            )}
          </div>
        )}
      </div>
    </BaseEmbed>
  );
});

const XReferencedTweetCard = memo(({ tweet }: { tweet: NonNullable<EmbedInfo["referencedTweet"]> }) => {
  const timestampText = formatEmbedTimestamp(tweet.timestamp);
  const media = tweet.media ?? [];

  return (
    <div className="overflow-hidden rounded-lg border border-rm-border/80 bg-rm-bg-surface/35 shadow-inner">
      <div className="flex flex-col gap-2.5 p-3">
        {tweet.author && (
          <div className="flex items-center gap-2 min-w-0">
            {tweet.author.iconURL && (
              <img src={tweet.author.iconURL} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" loading="lazy" />
            )}
            <span className="min-w-0 truncate text-[13px] font-semibold text-rm-text-primary">
              {tweet.author.name}
            </span>
            {timestampText && <span className="shrink-0 text-[12px] text-rm-text-muted/80">· {timestampText}</span>}
            {tweet.url && (
              <a href={tweet.url} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-[12px] font-medium text-[#5865F2] hover:underline">
                Open on X
              </a>
            )}
          </div>
        )}

        {tweet.rawDescription && (
          <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words text-rm-text-primary/90">
            {tweet.rawDescription}
          </div>
        )}

        {media.length > 0 && (
          <XMediaGrid
            media={media}
            url={tweet.url}
            author={tweet.author}
            createdAt={tweet.timestamp}
            compact
          />
        )}
      </div>
    </div>
  );
});

type XMediaAttachment = Attachment & {
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  sourceUrl?: string;
};

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}

const XMediaGrid = memo(({
  media,
  url,
  author,
  createdAt,
  compact = false,
  messageId,
  onJumpToMessage,
}: {
  media: EmbedMedia[];
  url?: string;
  author?: EmbedAuthor;
  createdAt?: string;
  compact?: boolean;
  messageId?: string;
  onJumpToMessage?: (messageId: string) => void;
}) => {
  const attachments = mediaToAttachments(media, url, messageId);
  const visibleAttachments = attachments.slice(0, 4);
  const extraCount = Math.max(0, attachments.length - visibleAttachments.length);
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
      />
    );
  }

  const heightClass = compact ? "h-[180px] sm:h-[220px]" : "h-[220px] sm:h-[300px]";
  const gridClass = count === 2
    ? cn("grid-cols-2", heightClass)
    : cn("grid-cols-2 grid-rows-2", heightClass);

  return (
    <div className={cn("grid max-w-full gap-1 overflow-hidden rounded-lg border border-rm-border/40 bg-black/30", gridClass)}>
      {visibleAttachments.map((attachment, index) => (
        <XMediaTile
          key={attachment.id}
          attachment={attachment}
          index={index}
          onOpen={openViewer}
          onKeyDown={handleKeyDown}
          url={url}
          className={count === 3 && index === 0 ? "row-span-2" : undefined}
          extraCount={index === visibleAttachments.length - 1 ? extraCount : 0}
        />
      ))}
    </div>
  );
});

const XMediaTile = memo(({
  attachment,
  index,
  onOpen,
  onKeyDown,
  url,
  className = "",
  single = false,
  extraCount = 0,
}: {
  attachment: XMediaAttachment;
  index: number;
  onOpen: (index: number) => void;
  onKeyDown: (event: React.KeyboardEvent, index: number) => void;
  url?: string;
  className?: string;
  single?: boolean;
  extraCount?: number;
}) => {
  const mediaUrl = getXAttachmentUrl(attachment);
  const isVideo = attachment.content_type?.startsWith("video/");
  const isGif = attachment.isGif === true;
  const posterUrl = !isGif && attachment.thumbnailUrl
    ? getAuthAssetUrl(buildProxyMediaPath(attachment.thumbnailUrl, attachment.sourceUrl))
    : undefined;

  useEffect(() => {
    if (!isVideo || isGif || !posterUrl) return;

    void primeVideoPlaybackAvailability({
      src: getMediaUrl(mediaUrl),
      contentType: attachment.content_type,
      posterUrl,
      sourceUrl: attachment.sourceUrl,
      isAnimated: false,
    });
  }, [attachment.content_type, attachment.sourceUrl, isGif, isVideo, mediaUrl, posterUrl]);

  const content = isVideo ? (
    isGif ? (
      <XGifTile attachment={attachment} src={mediaUrl} single={single} onOpenViewer={() => onOpen(index)} />
    ) : (
      <div className="h-full w-full flex items-center justify-center bg-black">
        <DirectVideoEmbed
          src={getMediaUrl(mediaUrl)}
          filename={attachment.filename}
          maxWidth={520}
          maxHeight={single ? 420 : 300}
          poster={posterUrl}
          referrerPolicy="no-referrer"
        />
      </div>
    )
  ) : (
    <img
      src={mediaUrl}
      alt={attachment.filename}
      className={single ? "h-auto max-h-[420px] w-full object-contain transition-all duration-300 hover:brightness-105" : "h-full w-full object-cover transition-all duration-300 hover:brightness-105"}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );

  return (
    <div
      className={cn(
        "relative block overflow-hidden bg-black/30",
        single ? "rounded-lg" : "",
        (!isVideo || isGif) ? "cursor-zoom-in" : "",
        className
      )}
      onClick={(!isVideo || isGif) ? () => openViewerSafely(onOpen, index) : undefined}
      onKeyDown={(!isVideo || isGif) ? (event) => onKeyDown(event, index) : undefined}
      role={(!isVideo || isGif) ? "button" : undefined}
      tabIndex={(!isVideo || isGif) ? 0 : undefined}
      title={url ? (isGif ? "Open GIF viewer" : (!isVideo ? "Open media viewer" : undefined)) : undefined}
    >
      {content}
      {extraCount > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-bold text-white">
          +{extraCount}
        </div>
      )}
    </div>
  );
});

function openViewerSafely(openViewer: (index: number) => void, index: number): void {
  openViewer(index);
}

const XGifTile = memo(({ attachment, src, single = false, onOpenViewer }: { attachment: XMediaAttachment; src: string; single?: boolean; onOpenViewer: () => void }) => {
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
    ? getAuthAssetUrl(buildProxyMediaPath(attachment.thumbnailUrl, attachment.sourceUrl))
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
    <div className={cn("relative flex h-full w-full items-center justify-center bg-black", single && "max-h-[420px]")} data-x-gif="true">
      {loadError ? (
        <img
          src={favoriteWebpUrl || posterUrl}
          alt={attachment.filename}
          className={cn(single ? "h-auto max-h-[420px] w-full object-contain" : "h-full w-full object-contain")}
          loading="lazy"
        />
      ) : (
        <video
          ref={videoRef}
          src={src}
          poster={posterUrl}
          className={cn(single ? "h-auto max-h-[420px] w-full object-contain" : "h-full w-full object-contain")}
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
            {paused ? <PlayIcon className="h-3.5 w-3.5" /> : <PauseIcon className="h-3.5 w-3.5" />}
            <span className="sr-only" id={titleId}>{paused ? "Play GIF" : "Pause GIF"}</span>
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
                  altPinned ? "opacity-100" : "opacity-0"
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
});

function mediaToAttachments(media: EmbedMedia[], sourceUrl?: string, messageId?: string): XMediaAttachment[] {
  return media.map((item, index) => ({
    id: `x-media-${index}-${item.url}`,
    message_id: messageId,
    filename: item.type === "video" ? `x-video-${index + 1}.mp4` : `x-image-${index + 1}`,
    file_key: item.type === "video" ? buildProxyMediaPath(item.url, sourceUrl) : item.url,
    content_type: item.type === "video" ? item.contentType || "video/mp4" : "image/jpeg",
    size_bytes: 0,
    url: item.type === "video" ? buildProxyMediaPath(item.url, sourceUrl) : item.url,
    thumbnailUrl: item.thumbnailUrl,
    width: item.width,
    height: item.height,
    isGif: item.isGif,
    alt_text: item.altText ?? null,
    sourceUrl,
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
            <img src={embed.thumbnail.url} alt="Video thumbnail" className="w-full h-auto object-cover max-h-[400px]" />
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

const RichEmbed = memo(({ embed, onMediaPlay }: { embed: EmbedInfo; onMediaPlay?: () => void }) => {
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
              {embed.author.name}
            </a>
          </div>
        )}

        {embed.thumbnail?.url && (
          <div className="relative rounded-md overflow-hidden border border-rm-border/30">
            {playing && embed.video?.url ? (
              <iframe
                src={embed.video.url}
                className="w-full border-0"
                style={{ aspectRatio: `${embed.video.width || 16}/${embed.video.height || 9}` }}
                allow="autoplay; fullscreen; encrypted-media"
                sandbox="allow-forms allow-modals allow-same-origin allow-scripts allow-presentation"
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
});

const LinkEmbed_ = memo(({ embed }: { embed: EmbedInfo }) => {
  return (
    <BaseEmbed embed={embed} width={432}>
      {embed.thumbnail?.url && (
        <a href={embed.url} target="_blank" rel="noopener noreferrer">
          <img src={embed.thumbnail.url} alt="Thumbnail" className="w-full h-auto rounded-md object-cover max-h-[300px]" />
        </a>
      )}
    </BaseEmbed>
  );
});

// ─── Main Component ─────────────────────────────────────────────────────

export const LinkEmbed = memo(({
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
  const isXEmbed = providerName === "x" || providerName === "twitter" || embed.footer?.text?.toLowerCase() === "x" || /https?:\/\/(?:www\.)?(?:x|twitter|fxtwitter|fixupx)\.com\//i.test(embed.url);

  const handleXClick = useCallback((e: React.MouseEvent) => {
    if (!onRemoveEmbeds) return;
    if (e.shiftKey) {
      onRemoveEmbeds();
    } else {
      setShowModal(true);
    }
  }, [onRemoveEmbeds]);

  const handleConfirm = useCallback(() => {
    setShowModal(false);
    onRemoveEmbeds?.();
  }, [onRemoveEmbeds]);

  // Determine which embed to render
  let embedContent: React.ReactNode;

  // Provider-specific routing
  if (providerName === "youtube" && embed.video?.url) {
    embedContent = <YouTubeEmbed embed={embed} onMediaPlay={onMediaPlay} />;
  } else if (providerName === "tiktok") {
    embedContent = <TikTokEmbed embed={embed} onMediaPlay={onMediaPlay} />;
  } else if (providerName === "spotify") {
    embedContent = <SpotifyEmbed embed={embed} />;
  } else if (providerName === "instagram") {
    // Both Spotify and Instagram handles inline iframe inherently.
    // If they have explicit play buttons, they can trigger keepMounted, but they are direct iframes.
    // Let's just track Youtube and explicit "Play" clicks since those are what get destroyed painfully.
    embedContent = <InstagramEmbed embed={embed} />;
  } else if (isXEmbed) {
    embedContent = <XEmbed embed={embed} messageId={messageId} onJumpToMessage={onJumpToMessage} />;
  } else {
    // Type-based routing
    switch (embed.type) {
      case "video": embedContent = <VideoEmbed embed={embed} />; break;
      case "rich": embedContent = <RichEmbed embed={embed} onMediaPlay={onMediaPlay} />; break;
      case "link":
      case "image":
      default: embedContent = <LinkEmbed_ embed={embed} />; break;
    }
  }

  return (
    <>
      <div className="relative mt-2 group/embedwrap inline-block max-w-full">
        {embedContent}
        {onRemoveEmbeds && (
          <button
            onClick={handleXClick}
            className="absolute -top-2 -right-6 z-20 w-5 h-5 flex items-center justify-center rounded text-rm-text-muted hover:text-rm-text-primary hover:bg-rm-bg-hover opacity-0 group-hover/embedwrap:opacity-100 transition-all"
            aria-label="Remove embeds"
            title="Remove all embeds (Shift+click to skip confirmation)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      {showModal && (
        <RemoveEmbedsModal
          onConfirm={handleConfirm}
          onCancel={() => setShowModal(false)}
        />
      )}
    </>
  );
});
