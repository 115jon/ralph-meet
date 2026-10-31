/**
 * Dev-only: embed payloads recorded from the real embed pipeline
 * (`extractAndProcessEmbedsWithStatus`) on 2026-10-23. Structure, sizes and
 * text are verbatim. Signed TikTok/Instagram/X media URLs expire within
 * hours, so those are swapped for labelled placeholders of the same size;
 * stable public URLs (YouTube thumbnails, GitHub/OG images, direct files)
 * are kept so the fixtures exercise real loading.
 */
import type { EmbedInfo } from "@/lib/types";

/** A labelled gradient as an SVG data URI (stands in for a signed image). */
function placeholder(
  label: string,
  w: number,
  h: number,
  a = "#1f2937",
  b = "#475569",
) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="${w / 2}" y="${h / 2}" font-family="system-ui,sans-serif" font-size="${Math.round(Math.min(w, h) / 9)}" font-weight="600" fill="rgba(255,255,255,0.9)" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const recordedYouTubeVideo: EmbedInfo = {
  id: "embed_1ydg4un",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  type: "video",
  rawTitle:
    "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
  author: { name: "Rick Astley", url: "https://www.youtube.com/@RickAstleyYT" },
  provider: { name: "YouTube", url: "https://www.youtube.com" },
  color: "#FF0000",
  thumbnail: {
    url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    width: 480,
    height: 360,
  },
  video: {
    url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    width: 3840,
    height: 2160,
    kind: "player",
  },
  fields: [],
};

/** A portrait upload; the recorded Short (tPEE9ZwTmy0) is itself landscape. */
export const recordedYouTubePortrait: EmbedInfo = {
  id: "embed_portrait",
  url: "https://youtu.be/oLb96nwOKDg?si=r0EuY4LzKVy4PziG",
  type: "video",
  rawTitle: "The Hunter Became the Hunted #DEADLOCK",
  author: { name: "72hrs", url: "https://www.youtube.com/@72hrs" },
  provider: { name: "YouTube", url: "https://www.youtube.com" },
  color: "#FF0000",
  thumbnail: {
    url: "https://i.ytimg.com/vi/oLb96nwOKDg/hqdefault.jpg",
    width: 480,
    height: 360,
  },
  video: {
    url: "https://www.youtube.com/embed/oLb96nwOKDg",
    width: 1080,
    height: 1920,
    kind: "player",
  },
  fields: [],
};

export const recordedTikTokVideo: EmbedInfo = {
  id: "embed_de0y92",
  url: "https://www.tiktok.com/@killa_cop_/video/7646427256587308308",
  type: "video",
  rawTitle: "What’s up",
  rawDescription: "What’s up",
  author: {
    name: "Killa Cop",
    url: "https://www.tiktok.com/@killa_cop_",
    iconURL: placeholder("K", 100, 100, "#0f172a", "#e11d48"),
  },
  provider: { name: "TikTok", url: "https://www.tiktok.com" },
  color: "#FF0050",
  video: {
    url: "https://www.tiktok.com/player/v1/7646427256587308308",
    width: 576,
    height: 880,
    kind: "player",
  },
  thumbnail: {
    url: placeholder("TikTok 576×880", 576, 880, "#111827", "#be185d"),
    width: 300,
    height: 400,
  },
  media: [
    {
      type: "video",
      url: "https://example.invalid/tiktok-signed.mp4",
      thumbnailUrl: placeholder(
        "TikTok 576×880",
        576,
        880,
        "#111827",
        "#be185d",
      ),
      width: 576,
      height: 880,
      contentType: "video/mp4",
      durationSeconds: 51,
    },
  ],
  audio: { title: "original sound", artist: "Killa Cop" },
  metrics: { comments: 359, likes: 143600 },
  footer: { text: "TikTok" },
  fields: [],
};

/** Stored before the media resolved: only the player URL, no cover yet. */
export const tiktokAwaitingHydration: EmbedInfo = {
  id: "embed_loading",
  url: "https://www.tiktok.com/@loading.fixture/video/7600000000000000001",
  type: "video",
  rawTitle: "TikTok · loading.fixture",
  provider: { name: "TikTok", url: "https://www.tiktok.com" },
  color: "#FF0050",
  video: {
    url: "https://www.tiktok.com/player/v1/7600000000000000001",
    width: 325,
    height: 738,
    kind: "player",
  },
  fields: [],
};

/**
 * Stored while the post was live; TikTok has since deleted it, so
 * `/api/tiktok-video` now answers 404 (the stub does the same).
 */
export const tiktokDeletedSinceStored: EmbedInfo = {
  ...recordedTikTokVideo,
  id: "embed_gone_live",
  url: "https://www.tiktok.com/@irlquandale/video/7644940658603592973",
  author: {
    name: "Quandale Dingle",
    url: "https://www.tiktok.com/@irlquandale",
    iconURL: placeholder("Q", 100, 100, "#0f172a", "#7c3aed"),
  },
  rawTitle: "LMAO",
  rawDescription: "LMAO",
};

export const recordedTikTokGone: EmbedInfo = {
  id: "embed_10jz40p",
  url: "https://www.tiktok.com/@irlquandale/video/7644940658603592973",
  type: "rich",
  unavailable: true,
  provider: { name: "TikTok", url: "https://www.tiktok.com" },
  footer: { text: "TikTok" },
  color: "#FF0050",
  fields: [],
};

export const recordedXGone: EmbedInfo = {
  id: "embed_t1dtmv",
  url: "https://x.com/NASA/status/1801349146546057624",
  type: "rich",
  unavailable: true,
  provider: { name: "X", url: "https://x.com" },
  footer: {
    text: "X",
    iconURL:
      "https://abs.twimg.com/responsive-web/client-web/icon-default.522d363a.png",
  },
  color: "#1D9BF0",
  fields: [],
};

export const recordedXVideo: EmbedInfo = {
  id: "embed_1up2nj7",
  url: "https://x.com/SpaceX/status/1732824684683784516",
  type: "rich",
  rawDescription:
    "At dawn from the gateway to Mars, the launch of Starship’s second flight test",
  author: {
    name: "SpaceX (@SpaceX)",
    url: "https://twitter.com/SpaceX",
    iconURL: placeholder("S", 200, 200, "#0b0f19", "#334155"),
  },
  provider: { name: "X", url: "https://x.com" },
  footer: { text: "X" },
  color: "#1D9BF0",
  timestamp: "2023-12-07T18:09:33.000Z",
  metrics: {
    replies: 2418,
    retweets: 6551,
    likes: 33812,
    impressions: 5074379,
  },
  media: [
    {
      type: "video",
      url: "https://example.invalid/x-video.mp4",
      width: 1920,
      height: 1080,
      thumbnailUrl: placeholder(
        "X video 1920×1080",
        1920,
        1080,
        "#0f172a",
        "#1e3a8a",
      ),
      contentType: "video/mp4",
      durationSeconds: 114.322,
    },
  ],
  fields: [],
};

/** Stored by the vxtwitter OG fallback: a direct video with no sizes. */
export const xVideoWithoutSize: EmbedInfo = {
  ...recordedXVideo,
  id: "embed_x_nosize",
  media: undefined,
  thumbnail: {
    url: placeholder("X video, no size", 1280, 720, "#0f172a", "#1e3a8a"),
  },
  video: {
    url: "https://example.invalid/x-video-unsized.mp4",
    kind: "direct",
    contentType: "video/mp4",
  },
};

export const recordedGitHub: EmbedInfo = {
  id: "embed_sd061p",
  url: "https://github.com/cloudflare/workers-sdk",
  type: "link",
  rawTitle:
    "GitHub - cloudflare/workers-sdk: ⛅️ Home to Wrangler, the CLI for Cloudflare Workers®",
  rawDescription:
    "⛅️ Home to Wrangler, the CLI for Cloudflare Workers® - cloudflare/workers-sdk",
  provider: { name: "GitHub", url: "https://github.com" },
  thumbnail: {
    url: placeholder("GitHub 1200×600", 1200, 600, "#0d1117", "#30363d"),
    width: 1200,
    height: 600,
  },
  imageLayout: "large",
  fields: [],
};

export const recordedArticle: EmbedInfo = {
  id: "embed_15rll8h",
  url: "https://blog.cloudflare.com/workers-ai-large-models/",
  type: "link",
  rawTitle:
    "Powering the agents: Workers AI now runs large models, starting with Kimi K2.5",
  rawDescription:
    "Kimi K2.5 is now on Workers AI, helping you power agents entirely on Cloudflare’s Developer Platform. Learn how we optimized our inference stack and reduced inference costs for internal agent use cases.",
  provider: { name: "Cloudflare Blog", url: "https://blog.cloudflare.com" },
  thumbnail: {
    url: placeholder("Article 1200×628", 1200, 628, "#7c2d12", "#f97316"),
    width: 1200,
    height: 628,
  },
  imageLayout: "large",
  fields: [],
};

export const recordedReddit: EmbedInfo = {
  id: "embed_1ioaq5q",
  url: "https://www.reddit.com/r/programming/",
  type: "link",
  rawTitle: "r/programming",
  rawDescription: "Computer Programming",
  provider: { name: "Reddit", url: "https://www.reddit.com" },
  thumbnail: {
    url: placeholder("r/", 256, 256, "#ff4500", "#ff8717"),
    width: 256,
    height: 256,
  },
  imageLayout: "thumbnail",
  fields: [],
};

/** Stored before image sizes were recorded, with an image that 404s. */
export const legacyLinkBrokenImage: EmbedInfo = {
  id: "embed_legacy",
  url: "https://news.example/story",
  type: "link",
  rawTitle: "A story whose preview image no longer loads",
  rawDescription: "The card should collapse the image, not show a broken icon.",
  provider: { name: "news.example" },
  thumbnail: { url: "https://example.invalid/missing-og.jpg" },
  fields: [],
};

export const recordedDirectPng: EmbedInfo = {
  id: "embed_40t1yz",
  url: "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
  type: "image",
  direct: true,
  thumbnail: {
    url: "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
    width: 544,
    height: 184,
  },
  media: [
    {
      type: "image",
      url: "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
      contentType: "image/png",
      width: 544,
      height: 184,
    },
  ],
  fields: [],
};

export const recordedDirectGif: EmbedInfo = {
  id: "embed_gde3z0",
  url: "https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif",
  type: "image",
  direct: true,
  thumbnail: {
    url: "https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif",
    width: 400,
    height: 400,
  },
  media: [
    {
      type: "image",
      url: "https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif",
      contentType: "image/gif",
      width: 400,
      height: 400,
      isGif: true,
    },
  ],
  fields: [],
};

/** moov sits at the end of this file, so the server could not size it. */
export const recordedDirectMp4: EmbedInfo = {
  id: "embed_gdxew0",
  url: "https://www.w3schools.com/html/mov_bbb.mp4",
  type: "video",
  direct: true,
  video: {
    url: "https://www.w3schools.com/html/mov_bbb.mp4",
    kind: "direct",
    contentType: "video/mp4",
  },
  fields: [],
};

export const recordedSpotifyAlbum: EmbedInfo = {
  id: "embed_1652hrc",
  url: "https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv",
  type: "link",
  rawTitle: "The Dark Side of the Moon",
  rawDescription: "Spotify",
  provider: { name: "Spotify", url: "https://spotify.com/" },
  color: "#1DB954",
  thumbnail: {
    url: "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02db216ca805faf5fe35df4ee6",
    width: 300,
    height: 300,
  },
  fields: [],
};

export const recordedInstagramReel: EmbedInfo = {
  id: "embed_1beqgux",
  url: "https://www.instagram.com/reel/DXU4PV2AGJU/",
  type: "rich",
  rawTitle:
    "some of my craziest work... guacamole seperately. #chardanceswag #food #funny",
  author: {
    name: "chardanceswag",
    url: "https://www.instagram.com/chardanceswag",
  },
  provider: { name: "Instagram", url: "https://www.instagram.com" },
  color: "#E1306C",
  thumbnail: {
    url: placeholder("Reel 640×1137", 640, 1137, "#4a044e", "#db2777"),
    width: 640,
    height: 1137,
  },
  footer: { text: "Instagram" },
  fields: [],
};
