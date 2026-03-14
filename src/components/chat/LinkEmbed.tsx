import { cn } from "@/lib/utils";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactPlayer from "react-player";
import { Tweet } from "react-tweet";

// ─── URL pattern matchers ───────────────────────────────────────────────

interface EmbedInfo {
  type: "youtube" | "tiktok" | "twitter" | "instagram" | "spotify" | "twitch" | "soundcloud";
  embedUrl: string;
  originalUrl: string;
  title: string;
  icon: string;
  accentColor: string;
  /** Extra metadata for static card embeds */
  meta?: { username?: string; tweetId?: string };
}

// YouTube: youtube.com/watch, youtu.be, youtube.com/shorts, youtube.com/embed
function matchYouTube(url: string): EmbedInfo | null {
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) {
      // Extract timestamp if present
      const tMatch = url.match(/[?&]t=(\d+)/);
      const start = tMatch ? `&start=${tMatch[1]}` : "";
      return {
        type: "youtube",
        embedUrl: `https://www.youtube.com/embed/${m[1]}?autoplay=0&auto_play=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=0&fs=1&color=white&pageType=2${start}`,
        originalUrl: url,
        title: "YouTube",
        icon: "▶",
        accentColor: "#FF0000",
      };
    }
  }
  return null;
}

// TikTok: tiktok.com/@user/video/ID
function matchTikTok(url: string): EmbedInfo | null {
  const m = url.match(/tiktok\.com\/@([^/]+)\/video\/(\d+)/);
  if (m) {
    return {
      type: "tiktok",
      embedUrl: `https://www.tiktok.com/embed/v2/${m[2]}`,
      originalUrl: url,
      title: "TikTok",
      icon: "♪",
      accentColor: "#00F2EA",
      meta: { username: m[1] },
    };
  }
  return null;
}

// X / Twitter: twitter.com or x.com status links
function matchTwitter(url: string): EmbedInfo | null {
  const m = url.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/(\d+)/);
  if (m) {
    return {
      type: "twitter",
      embedUrl: url, // Not used for iframe - we render a static card
      originalUrl: url.replace("twitter.com", "x.com"),
      title: `@${m[1]} on X`,
      icon: "𝕏",
      accentColor: "#000000",
      meta: { username: m[1], tweetId: m[2] },
    };
  }
  return null;
}

// Instagram: instagram.com/p/ or instagram.com/reel/
function matchInstagram(url: string): EmbedInfo | null {
  const m = url.match(/instagram\.com\/(p|reel|tv)\/([a-zA-Z0-9_-]+)/);
  if (m) {
    return {
      type: "instagram",
      embedUrl: `https://www.instagram.com/${m[1]}/${m[2]}/embed/`,
      originalUrl: url,
      title: `Instagram ${m[1] === "reel" ? "Reel" : "Post"}`,
      icon: "📷",
      accentColor: "#E4405F",
    };
  }
  return null;
}

// Spotify: track, album, playlist, episode
function matchSpotify(url: string): EmbedInfo | null {
  const m = url.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/);
  if (m) {
    return {
      type: "spotify",
      embedUrl: `https://open.spotify.com/embed/${m[1]}/${m[2]}?theme=0`,
      originalUrl: url,
      title: `Spotify ${m[1].charAt(0).toUpperCase() + m[1].slice(1)}`,
      icon: "🎵",
      accentColor: "#1DB954",
    };
  }
  return null;
}

// Twitch: clips, channels, videos
function matchTwitch(url: string): EmbedInfo | null {
  const clipMatch = url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/);
  if (clipMatch) {
    return {
      type: "twitch",
      embedUrl: `https://clips.twitch.tv/embed?clip=${clipMatch[1]}&parent=${window.location.hostname}&autoplay=false`,
      originalUrl: url,
      title: "Twitch Clip",
      icon: "📺",
      accentColor: "#9146FF",
    };
  }
  const channelMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)(?:\?|$)/);
  if (channelMatch) {
    return {
      type: "twitch",
      embedUrl: `https://player.twitch.tv/?channel=${channelMatch[1]}&parent=${window.location.hostname}&muted=true`,
      originalUrl: url,
      title: `${channelMatch[1]} on Twitch`,
      icon: "📺",
      accentColor: "#9146FF",
    };
  }
  return null;
}

// SoundCloud: any soundcloud.com link
function matchSoundCloud(url: string): EmbedInfo | null {
  if (/soundcloud\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/.test(url)) {
    return {
      type: "soundcloud",
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=true`,
      originalUrl: url,
      title: "SoundCloud",
      icon: "☁",
      accentColor: "#FF5500",
    };
  }
  return null;
}

const matchers = [
  matchYouTube,
  matchTikTok,
  matchTwitter,
  matchInstagram,
  matchSpotify,
  matchTwitch,
  matchSoundCloud,
];

/** Extract all embeddable URLs from a message string */
export function extractEmbedUrls(content: string): EmbedInfo[] {
  const urlRegex = /https?:\/\/[^\s<>"'`)]+/gi;
  const urls = content.match(urlRegex);
  if (!urls) return [];

  const seen = new Set<string>();
  const embeds: EmbedInfo[] = [];

  for (const url of urls) {
    // Clean trailing punctuation that might be part of a sentence
    const cleanUrl = url.replace(/[.,;:!?)]+$/, "");
    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);

    for (const matcher of matchers) {
      const info = matcher(cleanUrl);
      if (info) {
        embeds.push(info);
        break;
      }
    }
  }
  return embeds;
}

// ─── Embed Components ───────────────────────────────────────────────────

interface EmbedFrameProps {
  embed: EmbedInfo;
  aspectRatio?: string;
  maxWidth?: number;
  height?: number;
}

const EmbedFrame = memo(({ embed, aspectRatio, maxWidth = 480, height }: EmbedFrameProps) => {
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="mt-2 flex items-center gap-2 rounded-lg border border-rm-border bg-rm-bg-elevated/50 px-3 py-2 text-[12px] font-semibold text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text-secondary"
      >
        <span style={{ color: embed.accentColor }}>{embed.icon}</span>
        <span>{embed.title}</span>
        <span className="opacity-50">— Click to expand</span>
      </button>
    );
  }

  return (
    <div
      className="mt-2 overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated shadow-lg group/embed"
      style={{ maxWidth, borderLeftColor: embed.accentColor, borderLeftWidth: 3 }}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-rm-border/50 bg-rm-bg-surface/50">
        <span className="text-sm" style={{ color: embed.accentColor }}>{embed.icon}</span>
        <span className="text-[12px] font-bold text-rm-text-muted tracking-wide uppercase">{embed.title}</span>
        <div className="flex-1" />
        <a
          href={embed.originalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-semibold text-rm-text-muted hover:text-primary transition-colors"
          title="Open original"
        >
          ↗ Open
        </a>
        <button
          onClick={() => setCollapsed(true)}
          className="text-[10px] font-semibold text-rm-text-muted hover:text-rm-text-secondary transition-colors ml-1"
          title="Collapse embed"
        >
          ▾
        </button>
      </div>

      {/* Iframe container */}
      <div
        className="relative bg-black"
        style={aspectRatio ? { aspectRatio } : height ? { height } : { aspectRatio: "16/9" }}
      >
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div
                className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: `${embed.accentColor}40`, borderTopColor: "transparent" }}
              />
              <span className="text-[11px] text-rm-text-muted">Loading {embed.title}...</span>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={embed.embedUrl}
          title={embed.title}
          className={cn(
            "absolute inset-0 w-full h-full border-0 transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0"
          )}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          onLoad={handleLoad}
        />
      </div>
    </div>
  );
});

// ─── Platform-specific wrappers ─────────────────────────────────────────

const YouTubeEmbed = memo(({ embed }: { embed: EmbedInfo }) => {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="mt-2 flex items-center gap-2 rounded-lg border border-rm-border bg-rm-bg-elevated/50 px-3 py-2 text-[12px] font-semibold text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text-secondary"
      >
        <span style={{ color: embed.accentColor }}>{embed.icon}</span>
        <span>{embed.title}</span>
        <span className="opacity-50">— Click to expand</span>
      </button>
    );
  }

  return (
    <div
      className="mt-2 overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated shadow-lg"
      style={{ maxWidth: 440, borderLeftColor: embed.accentColor, borderLeftWidth: 3 }}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-rm-border/50 bg-rm-bg-surface/50">
        <span className="text-sm" style={{ color: embed.accentColor }}>{embed.icon}</span>
        <span className="text-[12px] font-bold text-rm-text-muted tracking-wide uppercase">{embed.title}</span>
        <div className="flex-1" />
        <a
          href={embed.originalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-semibold text-rm-text-muted hover:text-primary transition-colors"
          title="Open original"
        >
          ↗ Open
        </a>
        <button
          onClick={() => setCollapsed(true)}
          className="text-[10px] font-semibold text-rm-text-muted hover:text-rm-text-secondary transition-colors ml-1"
          title="Collapse embed"
        >
          ▾
        </button>
      </div>

      <div className="relative w-full bg-black group/play" style={{ paddingTop: '56.25%' }}>
        <ReactPlayer
          url={embed.originalUrl}
          className="absolute inset-0"
          width="100%"
          height="100%"
          controls={true}
          light={true}
          playing={true}
          playIcon={
            <div className="flex h-16 w-20 items-center justify-center rounded-[16px] bg-[#FF0000]/90 backdrop-blur-sm shadow-xl transition-all group-hover/play:bg-[#FF0000] group-hover/play:scale-105 z-10 cursor-pointer">
              <svg className="h-8 w-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          }
        />
      </div>
    </div>
  );
});

const TikTokEmbed = memo(({ embed }: { embed: EmbedInfo }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [thumb, setThumb] = useState<{ url: string; title: string; author: string } | null>(null);

  // Fetch thumbnail via TikTok oEmbed API
  useEffect(() => {
    const controller = new AbortController();
    fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(embed.originalUrl)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.thumbnail_url) {
          setThumb({
            url: data.thumbnail_url,
            title: data.title || "",
            author: data.author_name || embed.meta?.username || "",
          });
        }
      })
      .catch(() => { });
    return () => controller.abort();
  }, [embed.originalUrl, embed.meta?.username]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="mt-2 flex items-center gap-2 rounded-lg border border-rm-border bg-rm-bg-elevated/50 px-3 py-2 text-[12px] font-semibold text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text-secondary"
      >
        <span style={{ color: embed.accentColor }}>{embed.icon}</span>
        <span>{embed.title}</span>
        <span className="opacity-50">— Click to expand</span>
      </button>
    );
  }

  const videoId = embed.embedUrl.split("/").pop() || "";

  return (
    <div
      className="mt-2 overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated shadow-lg"
      style={{ maxWidth: 300, borderLeftColor: embed.accentColor, borderLeftWidth: 3 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-rm-border/50 bg-rm-bg-surface/50">
        <span className="text-sm" style={{ color: embed.accentColor }}>{embed.icon}</span>
        <span className="text-[12px] font-bold text-rm-text-muted tracking-wide uppercase">{embed.title}</span>
        {embed.meta?.username && (
          <span className="text-[11px] text-rm-text-muted truncate">@{embed.meta.username}</span>
        )}
        <div className="flex-1" />
        <a
          href={embed.originalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-semibold text-rm-text-muted hover:text-primary transition-colors"
        >
          ↗ Open
        </a>
        <button
          onClick={() => setCollapsed(true)}
          className="text-[10px] font-semibold text-rm-text-muted hover:text-rm-text-secondary transition-colors ml-1"
          title="Collapse embed"
        >
          ▾
        </button>
      </div>

      {/* Player area */}
      <div className="relative bg-black" style={{ width: 270, height: 480 }}>
        {playing ? (
          <>
            {!iframeLoaded && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <div
                  className="h-10 w-10 rounded-full border-3 border-t-transparent animate-spin"
                  style={{ borderColor: `${embed.accentColor}60`, borderTopColor: "transparent" }}
                />
              </div>
            )}
            <iframe
              src={`https://www.tiktok.com/player/v1/${videoId}?music_info=0&description=0`}
              title="TikTok video"
              className={cn(
                "absolute inset-0 w-full h-full border-0 transition-opacity duration-300",
                iframeLoaded ? "opacity-100" : "opacity-0"
              )}
              allow="autoplay; encrypted-media"
              allowFullScreen
              onLoad={() => setIframeLoaded(true)}
            />
          </>
        ) : (
          <button
            onClick={() => setPlaying(true)}
            className="w-full h-full relative group/play cursor-pointer"
            aria-label="Play TikTok video"
          >
            {/* Thumbnail */}
            {thumb?.url ? (
              <img
                src={thumb.url}
                alt={thumb.title || "TikTok video"}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 to-zinc-900 flex items-center justify-center">
                <span className="text-4xl opacity-20">♪</span>
              </div>
            )}

            {/* Dark overlay on hover */}
            <div className="absolute inset-0 bg-black/20 group-hover/play:bg-black/40 transition-colors" />

            {/* Play button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm border border-white/20 shadow-2xl transition-transform group-hover/play:scale-110">
                <svg className="h-6 w-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>

            {/* Bottom info overlay */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-3">
              {thumb?.title && (
                <p className="text-[12px] text-white/90 font-medium line-clamp-2 leading-relaxed">
                  {thumb.title}
                </p>
              )}
              <div className="flex items-center gap-1.5 mt-1">
                {/* TikTok logo */}
                <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none">
                  <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.18 8.18 0 004.77 1.52V6.82a4.84 4.84 0 01-1-.13z" fill="#00F2EA" />
                </svg>
                <span className="text-[10px] text-white/70 font-medium">
                  @{thumb?.author || embed.meta?.username}
                </span>
              </div>
            </div>
          </button>
        )}
      </div>
    </div>
  );
});

// X/Twitter: Fetches tweet data via FixTweet API to show actual content + video
const TwitterEmbed = memo(({ embed }: { embed: EmbedInfo }) => {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="mt-2 flex items-center gap-2 rounded-lg border border-rm-border bg-rm-bg-elevated/50 px-3 py-2 text-[12px] font-semibold text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text-secondary"
      >
        <span className="text-sm font-bold">𝕏</span>
        <span>{embed.title}</span>
        <span className="opacity-50">— Click to expand</span>
      </button>
    );
  }

  if (!embed.meta?.tweetId) return null;

  return (
    <div className="mt-2 text-rm-text [&_.react-tweet-theme]:!m-0 relative group/xcard max-w-[440px]">
      <button
        onClick={() => setCollapsed(true)}
        className="absolute top-4 right-4 z-10 text-[10px] font-semibold text-rm-text-muted hover:text-rm-text bg-rm-bg-elevated/80 hover:bg-rm-bg-elevated backdrop-blur-md rounded-full px-2 py-1 opacity-0 group-hover/xcard:opacity-100 transition-all border border-rm-border/50 shadow-lg"
        title="Collapse embed"
      >
        COLLAPSE
      </button>
      <div className="rounded-[14px] border border-rm-border shadow-lg overflow-hidden [&_.react-tweet-theme]:!bg-rm-bg-elevated [&_.react-tweet-theme]:!border-0">
        <Tweet id={embed.meta.tweetId} />
      </div>
    </div>
  );
});

const InstagramEmbed = memo(({ embed }: { embed: EmbedInfo }) => (
  <EmbedFrame embed={embed} maxWidth={480} height={580} />
));

const SpotifyEmbed = memo(({ embed }: { embed: EmbedInfo }) => {
  // Spotify embeds are compact or large depending on type
  const isTrack = embed.embedUrl.includes("/track/");
  return (
    <EmbedFrame
      embed={embed}
      maxWidth={460}
      height={isTrack ? 152 : 352}
    />
  );
});

const TwitchEmbed = memo(({ embed }: { embed: EmbedInfo }) => (
  <EmbedFrame embed={embed} aspectRatio="16/9" maxWidth={520} />
));

const SoundCloudEmbed = memo(({ embed }: { embed: EmbedInfo }) => (
  <EmbedFrame embed={embed} maxWidth={480} height={166} />
));

// ─── Main Component ─────────────────────────────────────────────────────

const EMBED_RENDERERS: Record<EmbedInfo["type"], React.FC<{ embed: EmbedInfo }>> = {
  youtube: YouTubeEmbed,
  tiktok: TikTokEmbed,
  twitter: TwitterEmbed,
  instagram: InstagramEmbed,
  spotify: SpotifyEmbed,
  twitch: TwitchEmbed,
  soundcloud: SoundCloudEmbed,
};

interface LinkEmbedProps {
  content: string;
}

export const LinkEmbed = memo(({ content }: LinkEmbedProps) => {
  const embeds = extractEmbedUrls(content);
  if (embeds.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-1">
      {embeds.map((embed, i) => {
        const Renderer = EMBED_RENDERERS[embed.type];
        return <Renderer key={`${embed.type}-${i}`} embed={embed} />;
      })}
    </div>
  );
});
