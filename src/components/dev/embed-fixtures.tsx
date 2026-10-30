/**
 * Dev-only fixtures for the "embed-*" surfaces (see routes/ui-fixtures.tsx).
 * Nothing here ships.
 *
 * LinkEmbed renders from the `embed` prop, but TikTok and Instagram cards also
 * fetch `/api/tiktok-video` / `/api/instagram-video` to hydrate, and every
 * provider image goes through `/api/proxy-media?url=...`. The fixture stubs
 * both: hydration fetches get a 503 (cards render from the static data), a
 * URL containing `irlquandale` gets the 404 a deleted post returns, one
 * containing `loading.fixture` never answers (the loading state), and
 * proxied media whose real URL is a `data:` image is unwrapped so it loads
 * without the server. Payloads recorded from the real pipeline live in
 * embed-fixture-payloads.ts.
 *
 * Surfaces:
 *   embed-generic   BaseEmbed link with image, without image, colour stripe, unavailable
 *   embed-video     YouTube + generic video/rich
 *   embed-tiktok    TikTok video post
 *   embed-x         X text post + quoted post
 *   embed-x-media   X media grid (2 and 4 images)
 *   embed-social    Instagram single image
 *   embed-carousel  Instagram + TikTok photo carousels (dots, chevrons)
 *   embed-music     Spotify + TikTok audio chip
 *   embed-youtube   recorded YouTube landscape + portrait
 *   embed-links     recorded GitHub, article (large image), Reddit (thumbnail),
 *                   legacy card whose image 404s
 *   embed-direct    direct PNG, GIF and an MP4 the server could not size
 *   embed-x-video   recorded X video, plus one stored without sizes
 *   embed-states    TikTok loading, TikTok deleted after it was stored,
 *                   stored tombstones (TikTok, X)
 *   embed-spotify   recorded Spotify album + track
 */
import type { EmbedInfo, EmbedMedia } from "@/lib/types";
import { LinkEmbed } from "@/components/chat/LinkEmbed";
import {
  legacyLinkBrokenImage,
  recordedArticle,
  recordedDirectGif,
  recordedDirectMp4,
  recordedDirectPng,
  recordedGitHub,
  recordedInstagramReel,
  recordedReddit,
  recordedSpotifyAlbum,
  recordedTikTokGone,
  recordedTikTokVideo,
  recordedXGone,
  recordedXVideo,
  recordedYouTubePortrait,
  recordedYouTubeVideo,
  tiktokAwaitingHydration,
  tiktokDeletedSinceStored,
  xVideoWithoutSize,
} from "./embed-fixture-payloads";

/* ------------------------------------------------------------------ */
/* Stubs                                                                */
/* ------------------------------------------------------------------ */

let stubsInstalled = false;

function unwrapProxied(value: string): string {
  if (!value.includes("/api/proxy-media")) return value;
  try {
    const inner = new URL(value, window.location.origin).searchParams.get(
      "url",
    );
    return inner && inner.startsWith("data:") ? inner : value;
  } catch {
    return value;
  }
}

function installEmbedStubs() {
  if (stubsInstalled || typeof window === "undefined") return;
  stubsInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (/\/api\/(tiktok|instagram)-video\b/.test(url)) {
      const target = decodeURIComponent(url);
      if (target.includes("loading.fixture")) {
        return new Promise<Response>(() => {});
      }
      if (target.includes("irlquandale")) {
        return Promise.resolve(
          Response.json(
            { error: "This TikTok is no longer available", unavailable: true },
            { status: 404 },
          ),
        );
      }
      return Promise.resolve(new Response("{}", { status: 503 }));
    }
    return originalFetch(input, init);
  };

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function setAttribute(name, value) {
    if ((name === "src" || name === "poster") && typeof value === "string") {
      return originalSetAttribute.call(this, name, unwrapProxied(value));
    }
    return originalSetAttribute.call(this, name, value);
  };
  const imgSrc = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "src",
  );
  if (imgSrc?.set) {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...imgSrc,
      set(value: string) {
        imgSrc.set!.call(this, unwrapProxied(String(value)));
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Static media                                                         */
/* ------------------------------------------------------------------ */

/** A labelled gradient as an SVG data URI (stands in for a photo). */
function photo(label: string, w: number, h: number, a: string, b: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.72}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.12}" fill="rgba(255,255,255,0.35)"/><text x="${w / 2}" y="${h / 2}" font-family="system-ui,sans-serif" font-size="${Math.round(Math.min(w, h) / 9)}" font-weight="600" fill="rgba(255,255,255,0.9)" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function avatar(initial: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/><text x="32" y="33" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="middle">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const at = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

const img = (
  label: string,
  w: number,
  h: number,
  a: string,
  b: string,
): EmbedMedia => ({
  type: "image",
  url: photo(label, w, h, a, b),
  width: w,
  height: h,
});

/* ------------------------------------------------------------------ */
/* Embeds                                                               */
/* ------------------------------------------------------------------ */

const genericWithImage: EmbedInfo = {
  id: "fx-generic-img",
  url: "https://ditherwave.dev/blog/ordered-dithering",
  type: "link",
  provider: { name: "ditherwave" },
  rawTitle: "Ordered dithering, explained with one shader",
  rawDescription:
    "Bayer matrices, threshold maps and why a 4x4 pattern reads as a gradient from across the room. With live examples you can drag.",
  thumbnail: {
    url: photo("ditherwave", 864, 432, "#3b3f8f", "#c06c84"),
    width: 864,
    height: 432,
  },
  fields: [],
};

const genericNoImage: EmbedInfo = {
  id: "fx-generic-text",
  url: "https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible",
  type: "link",
  provider: { name: "MDN Web Docs" },
  rawTitle: ":focus-visible - CSS: Cascading Style Sheets",
  rawDescription:
    "The :focus-visible pseudo-class applies while an element matches the :focus pseudo-class and the UA determines via heuristics that the focus should be made evident on the element.",
  fields: [],
};

const genericColour: EmbedInfo = {
  id: "fx-generic-colour",
  url: "https://status.example.dev/incidents/42",
  type: "rich",
  color: "#43b581",
  provider: { name: "Status" },
  rawTitle: "All systems operational",
  rawDescription: "Realtime, media and auth are healthy in every region.",
  footer: { text: "status.example.dev" },
  timestamp: at(90),
  fields: [],
};

const unavailable: EmbedInfo = {
  id: "fx-unavailable",
  url: "https://x.com/someone/status/1",
  type: "rich",
  unavailable: true,
  author: { name: "Someone (@someone)" },
  provider: { name: "X" },
  fields: [],
};

const youtube: EmbedInfo = {
  id: "fx-youtube",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  type: "video",
  provider: { name: "YouTube" },
  author: { name: "Design Systems Weekly" },
  rawTitle: "Building a quiet UI: tokens, tints and one accent",
  video: {
    url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    width: 1280,
    height: 720,
  },
  thumbnail: {
    url: photo("YouTube", 1280, 720, "#1f2937", "#7c3aed"),
    width: 1280,
    height: 720,
  },
  fields: [],
};

const genericVideo: EmbedInfo = {
  id: "fx-video",
  url: "https://vimeo.com/123456",
  type: "video",
  provider: { name: "Vimeo" },
  rawTitle: "Motion under 300ms",
  thumbnail: {
    url: photo("Vimeo", 960, 540, "#0f766e", "#1e3a8a"),
    width: 960,
    height: 540,
  },
  fields: [],
};

const tiktokVideo: EmbedInfo = {
  id: "fx-tiktok",
  url: "https://www.tiktok.com/@ralph.meet/video/7400000000000000001",
  type: "video",
  provider: { name: "TikTok" },
  author: {
    name: "ralph.meet",
    url: "https://www.tiktok.com/@ralph.meet",
    iconURL: avatar("R", "#e11d48"),
  },
  rawDescription: "Voice rooms but they feel like a studio #design #webrtc",
  thumbnail: {
    url: photo("TikTok", 720, 1280, "#111827", "#be185d"),
    width: 720,
    height: 1280,
  },
  media: [
    {
      type: "video",
      url: "https://example.invalid/tiktok.mp4",
      thumbnailUrl: photo("TikTok", 720, 1280, "#111827", "#be185d"),
      width: 720,
      height: 1280,
      durationSeconds: 21,
    },
  ],
  metrics: { likes: 18400, comments: 312, views: 210000 },
  timestamp: at(60 * 5),
  fields: [],
};

const tiktokCarousel: EmbedInfo = {
  id: "fx-tiktok-carousel",
  url: "https://www.tiktok.com/@ralph.meet/photo/7400000000000000002",
  type: "rich",
  provider: { name: "TikTok" },
  author: {
    name: "ralph.meet",
    url: "https://www.tiktok.com/@ralph.meet",
    iconURL: avatar("R", "#e11d48"),
  },
  rawDescription: "Three themes, one layout. Swipe",
  media: [
    img("Dark", 1080, 1350, "#0f172a", "#334155"),
    img("Light", 1080, 1350, "#e2e8f0", "#94a3b8"),
    img("Miku", 1080, 1350, "#0d9488", "#5eead4"),
  ],
  audio: {
    title: "original sound",
    artist: "ralph.meet",
    artworkUrl: avatar("♪", "#7c3aed"),
    url: "https://example.invalid/sound.mp3",
  },
  metrics: { likes: 920, comments: 41 },
  timestamp: at(60 * 26),
  fields: [],
};

const xText: EmbedInfo = {
  id: "fx-x-text",
  url: "https://x.com/adalovelace/status/1800000000000000001",
  type: "rich",
  provider: { name: "X" },
  author: {
    name: "Ada Lovelace (@adalovelace)",
    url: "https://x.com/adalovelace",
    iconURL: avatar("A", "#2563eb"),
  },
  rawDescription:
    "Hot take: hover states should never resize anything. Colour and opacity only, under 150ms, and only for fine pointers. https://example.dev/hover",
  metrics: { replies: 42, retweets: 118, likes: 1640, impressions: 98000 },
  footer: { text: "X" },
  timestamp: at(60 * 3),
  fields: [],
};

const xQuoted: EmbedInfo = {
  id: "fx-x-quoted",
  url: "https://x.com/gracehopper/status/1800000000000000002",
  type: "rich",
  provider: { name: "X" },
  author: {
    name: "Grace Hopper (@gracehopper)",
    url: "https://x.com/gracehopper",
    iconURL: avatar("G", "#059669"),
  },
  rawDescription: "This, but also for focus rings.",
  referencedTweet: {
    type: "quoted",
    url: "https://x.com/adalovelace/status/1800000000000000001",
    rawDescription:
      "Hot take: hover states should never resize anything. Colour and opacity only, under 150ms, and only for fine pointers.",
    author: {
      name: "Ada Lovelace (@adalovelace)",
      url: "https://x.com/adalovelace",
      iconURL: avatar("A", "#2563eb"),
    },
    media: [img("Quoted", 1200, 675, "#1e293b", "#475569")],
    timestamp: at(60 * 3),
  },
  metrics: { replies: 3, retweets: 9, likes: 87 },
  footer: { text: "X" },
  timestamp: at(45),
  fields: [],
};

const xMediaTwo: EmbedInfo = {
  id: "fx-x-media-2",
  url: "https://x.com/linus/status/1800000000000000003",
  type: "rich",
  provider: { name: "X" },
  author: {
    name: "Linus (@linus)",
    url: "https://x.com/linus",
    iconURL: avatar("L", "#d97706"),
  },
  rawDescription: "Before / after on the settings pass.",
  media: [
    img("Before", 1200, 900, "#7f1d1d", "#b91c1c"),
    img("After", 1200, 900, "#14532d", "#16a34a"),
  ],
  metrics: { replies: 12, retweets: 30, likes: 410 },
  footer: { text: "X" },
  timestamp: at(60 * 8),
  fields: [],
};

const xMediaFour: EmbedInfo = {
  id: "fx-x-media-4",
  url: "https://x.com/ken/status/1800000000000000004",
  type: "rich",
  provider: { name: "X" },
  author: {
    name: "Ken (@ken)",
    url: "https://x.com/ken",
    iconURL: avatar("K", "#7c3aed"),
  },
  rawDescription: "Four themes.",
  media: [
    img("1", 1000, 1000, "#0f172a", "#1d4ed8"),
    img("2", 1000, 1000, "#3f0d12", "#a71d31"),
    img("3", 1000, 1000, "#064e3b", "#10b981"),
    img("4", 1000, 1000, "#422006", "#f59e0b"),
  ],
  metrics: { likes: 77 },
  footer: { text: "X" },
  timestamp: at(60 * 30),
  fields: [],
};

const instagramSingle: EmbedInfo = {
  id: "fx-ig-single",
  url: "https://www.instagram.com/p/FIXTURE01/",
  type: "rich",
  provider: { name: "Instagram" },
  author: {
    name: "ralphmeet",
    url: "https://www.instagram.com/ralphmeet/",
    iconURL: avatar("R", "#c026d3"),
    isVerified: true,
  },
  rawTitle: "Studio settings, now on every surface.",
  media: [img("Instagram", 1080, 1080, "#831843", "#f97316")],
  metrics: { likes: 2304, comments: 58 },
  timestamp: at(60 * 50),
  fields: [],
};

const instagramCarousel: EmbedInfo = {
  id: "fx-ig-carousel",
  url: "https://www.instagram.com/p/FIXTURE02/",
  type: "rich",
  provider: { name: "Instagram" },
  author: {
    name: "ralphmeet",
    url: "https://www.instagram.com/ralphmeet/",
    iconURL: avatar("R", "#c026d3"),
  },
  rawTitle: "Swipe through the new pickers",
  media: [
    img("1 / 4", 1080, 1080, "#1e1b4b", "#6366f1"),
    img("2 / 4", 1080, 1080, "#172554", "#0ea5e9"),
    img("3 / 4", 1080, 1080, "#052e16", "#22c55e"),
    img("4 / 4", 1080, 1080, "#450a0a", "#ef4444"),
  ],
  metrics: { likes: 640, comments: 12 },
  timestamp: at(60 * 4),
  fields: [],
};

const spotify: EmbedInfo = {
  id: "fx-spotify",
  url: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  type: "rich",
  provider: { name: "Spotify" },
  rawTitle: "Never Gonna Give You Up",
  fields: [],
};

/* ------------------------------------------------------------------ */
/* Layout                                                               */
/* ------------------------------------------------------------------ */

const noop = () => {};

function Column({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      {/* Wide enough for the 640 media width plus the column padding. */}
      <div className="mx-auto flex w-full max-w-[672px] flex-col gap-6 px-4 py-6">
        {children}
      </div>
    </div>
  );
}

function Row({ label, embed }: { label: string; embed: EmbedInfo }) {
  return (
    <section className="flex flex-col">
      <div className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
        {label}
      </div>
      <LinkEmbed
        embed={embed}
        messageId={`msg-${embed.id}`}
        onRemoveEmbeds={noop}
      />
    </section>
  );
}

const SURFACES: Record<string, Array<[string, EmbedInfo]>> = {
  "embed-generic": [
    ["Link with image", genericWithImage],
    ["Link, no image", genericNoImage],
    ["Rich with colour + footer", genericColour],
    ["Unavailable", unavailable],
  ],
  "embed-video": [
    ["YouTube", youtube],
    ["Video", genericVideo],
  ],
  "embed-tiktok": [["TikTok video", tiktokVideo]],
  "embed-x": [
    ["X text", xText],
    ["X quoted", xQuoted],
  ],
  "embed-x-media": [
    ["X two images", xMediaTwo],
    ["X four images", xMediaFour],
  ],
  "embed-social": [["Instagram", instagramSingle]],
  "embed-carousel": [
    ["Instagram carousel", instagramCarousel],
    ["TikTok photo carousel", tiktokCarousel],
  ],
  "embed-music": [["Spotify", spotify]],
  "embed-youtube": [
    ["YouTube (recorded)", recordedYouTubeVideo],
    ["YouTube portrait (recorded)", recordedYouTubePortrait],
  ],
  "embed-links": [
    ["GitHub repo, large image (recorded)", recordedGitHub],
    ["Article, large image (recorded)", recordedArticle],
    ["Reddit, small thumbnail (recorded)", recordedReddit],
    ["Legacy card, image 404s", legacyLinkBrokenImage],
  ],
  "embed-direct": [
    ["Direct PNG (recorded)", recordedDirectPng],
    ["Direct GIF (recorded)", recordedDirectGif],
    ["Direct MP4, unsized (recorded)", recordedDirectMp4],
  ],
  "embed-x-video": [
    ["X video (recorded)", recordedXVideo],
    ["X video stored without sizes", xVideoWithoutSize],
  ],
  "embed-states": [
    ["TikTok (recorded)", recordedTikTokVideo],
    ["TikTok loading", tiktokAwaitingHydration],
    ["TikTok deleted after it was stored", tiktokDeletedSinceStored],
    ["TikTok tombstone (recorded)", recordedTikTokGone],
    ["X tombstone (recorded)", recordedXGone],
    ["Instagram reel, thumbnail only (recorded)", recordedInstagramReel],
  ],
  "embed-spotify": [
    ["Spotify album (recorded)", recordedSpotifyAlbum],
    ["Spotify track", spotify],
  ],
};

export function EmbedFixture({ surface }: { surface: string }) {
  installEmbedStubs();
  const rows = SURFACES[surface];
  if (!rows) {
    return (
      <div className="grid h-full place-items-center text-ui-sm text-rm-text-muted">
        Unknown fixture: {surface}
      </div>
    );
  }
  return (
    <Column>
      {rows.map(([label, embed]) => (
        <Row key={embed.id} label={label} embed={embed} />
      ))}
    </Column>
  );
}
