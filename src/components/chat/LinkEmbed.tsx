import type { EmbedInfo } from "@/lib/types";
import { apiUrl } from "@/lib/platform";
import { memo, useCallback, useEffect, useRef, useState } from "react";
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

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="white" className="w-7 h-7 ml-0.5">
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

function buildProxyMediaUrl(rawUrl: string): string {
  return apiUrl(`/api/proxy-media?url=${encodeURIComponent(rawUrl)}`);
}

// ─── Platform-specific Renderers ──────────────────────────────────────────

const YouTubeEmbed = memo(({ embed, onMediaPlay }: { embed: EmbedInfo; onMediaPlay?: () => void }) => {
  const [playing, setPlaying] = useState(false);

  const handlePlay = useCallback(() => {
    setPlaying(true);
    onMediaPlay?.();
  }, [onMediaPlay]);

  return (
    <BaseEmbed embed={embed} width={432}>
      <div className="relative rounded-md overflow-hidden bg-black w-full" style={{ aspectRatio: "16/9" }}>
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

const TikTokEmbed = memo(({ embed, onMediaPlay }: { embed: EmbedInfo; onMediaPlay?: () => void }) => {
  const iframeUrl = embed.video?.url
    ? `${embed.video.url}?description=1&music_info=1`
    : null;

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
            setPlayer({ mode: "direct", videoUrl: buildProxyMediaUrl(videoUrl), coverUrl });
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

        {/* Direct native player — best UX */}
        {player.mode === "direct" && (
          <VideoAttachment
            src={player.videoUrl}
            filename="tiktok-video.mp4"
            maxWidth={300}
            maxHeight={450}
            poster={player.coverUrl ?? embed.thumbnail?.url}
            referrerPolicy="no-referrer"
            showDownload={false}
            onVideoError={handleVideoError}
          />
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

const XEmbed = memo(({ embed }: { embed: EmbedInfo }) => {
  const timestampText = formatEmbedTimestamp(embed.timestamp);
  const footerIcon = embed.footer?.iconURL || "https://abs.twimg.com/responsive-web/client-web/icon-default.522d363a.png";
  const videoUrl = getPlayableXVideoUrl(embed);

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

        {videoUrl ? (
          <VideoAttachment
            src={videoUrl}
            filename="x-video.mp4"
            maxWidth={520}
            maxHeight={420}
            poster={embed.thumbnail?.url}
            referrerPolicy="no-referrer"
            showDownload={false}
          />
        ) : null}

        {!embed.video?.url && embed.thumbnail?.url && (
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded bg-black/20"
          >
            <img
              src={embed.thumbnail.url}
              alt="X media"
              className="w-full h-auto max-h-[420px] object-contain"
              loading="lazy"
            />
          </a>
        )}

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

function getPlayableXVideoUrl(embed: EmbedInfo): string | null {
  const rawUrl = embed.video?.url;
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);

    if (parsed.hostname === "twitter.com" && parsed.pathname.startsWith("/i/videos/tweet/")) {
      const tweetId = parsed.pathname.split("/").pop();
      const originalTweetId = new URL(embed.url).pathname.split("/").pop();

      if (tweetId && originalTweetId && tweetId === originalTweetId) {
        return null;
      }
    }

    if (parsed.hostname === "video.twimg.com" || parsed.hostname === "vxtwitter.com") {
      return buildProxyMediaUrl(rawUrl);
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
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

export const LinkEmbed = memo(({ embed, onRemoveEmbeds, onMediaPlay }: { embed: EmbedInfo; onRemoveEmbeds?: () => void; onMediaPlay?: () => void }) => {
  const [showModal, setShowModal] = useState(false);
  const providerName = embed.provider?.name?.toLowerCase();
  const isXEmbed = providerName === "x" || providerName === "twitter" || embed.footer?.text?.toLowerCase() === "x" || /https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(embed.url);

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
    embedContent = <XEmbed embed={embed} />;
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
