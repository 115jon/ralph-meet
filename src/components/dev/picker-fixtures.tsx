/**
 * Dev-only fixtures for the "pk-*" surfaces (see routes/ui-fixtures.tsx).
 * Nothing here ships.
 *
 * Each surface mounts one composer picker open, anchored to a fake composer
 * bar at the bottom of the page, with the network answered from static data
 * below (a fetch stub installed only while the fixture is mounted).
 *
 *   pk-emoji             emoji picker, with a few custom creations
 *   pk-gif               GIF picker, compact, category grid
 *   pk-gif-trending      GIF picker, compact, Trending results (tile stars)
 *   pk-gif-expanded      GIF picker, expanded (desktop), Trending results
 *   pk-gif-favorites     GIF picker, compact, Favorites view
 *   pk-gif-voice         GIF picker in voice-reaction mode (React Mode chips)
 *   pk-soundboard        soundboard grid: favourites, server sounds, defaults
 *
 * Phones get the same surfaces as bottom drawers (PickerSurface).
 */

import EmojiPicker from "@/components/chat/EmojiPicker";
import GifPickerModal from "@/components/chat/GifPickerModal";
import SoundboardPicker from "@/components/chat/SoundboardPicker";
import {
  installPlaceholderSession,
  useFixtureSetup,
} from "@/components/dev/sp-fixtures/api-stub";
import type { GeneratedEmoji } from "@/lib/emoji";
import type { GifPickerCategory, GifPickerItem } from "@/lib/gif-picker";
import type { SFUClient } from "@/lib/sfu-client";
import type { Server } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";
import { useGifFavoritesStore } from "@/stores/useGifFavoritesStore";
import { useEffect, useRef, type ReactNode } from "react";

// ─── Seeded art ─────────────────────────────────────────────────────────────

function svgUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A GIF stand-in: a two-stop gradient with a simple shape and a caption. */
function gifArt(
  a: string,
  b: string,
  w: number,
  h: number,
  caption: string,
): string {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="${w * 0.5}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.18}" fill="#fff" opacity=".85"/>
<circle cx="${w * 0.44}" cy="${h * 0.39}" r="${Math.min(w, h) * 0.025}" fill="#222"/>
<circle cx="${w * 0.56}" cy="${h * 0.39}" r="${Math.min(w, h) * 0.025}" fill="#222"/>
<path d="M${w * 0.43} ${h * 0.47} q${w * 0.07} ${h * 0.07} ${w * 0.14} 0" stroke="#222" stroke-width="${Math.min(w, h) * 0.02}" fill="none" stroke-linecap="round"/>
<text x="50%" y="${h * 0.82}" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="${Math.min(w, h) * 0.13}" fill="#fff" stroke="#000" stroke-width="1.5">${caption}</text>
</svg>`);
}

const GIF_SPECS: Array<[string, string, number, number, string]> = [
  ["#f97316", "#db2777", 320, 240, "LET'S GO"],
  ["#22c55e", "#0ea5e9", 320, 400, "NICE"],
  ["#8b5cf6", "#ec4899", 320, 220, "OMG"],
  ["#eab308", "#f97316", 320, 320, "YES"],
  ["#06b6d4", "#3b82f6", 320, 260, "LOL"],
  ["#ef4444", "#7c3aed", 320, 380, "NO WAY"],
  ["#14b8a6", "#84cc16", 320, 240, "SHIP IT"],
  ["#f43f5e", "#fb923c", 320, 300, "WOW"],
];

function gifItem(index: number): GifPickerItem {
  const [a, b, w, h, caption] = GIF_SPECS[index % GIF_SPECS.length]!;
  const asset = {
    url: gifArt(a, b, w, h, caption),
    width: w,
    height: h,
    sizeBytes: 1024,
    contentType: "image/gif" as const,
  };
  return {
    id: `pk-gif-${index}`,
    title: caption.toLowerCase(),
    altText: `${caption.toLowerCase()} reaction`,
    provider: "klipy",
    preview: asset,
    send: asset,
    sourceUrl: "",
    aspectRatio: w / h,
    mediaType: "gifs",
  };
}

const GIF_RESULTS = Array.from({ length: 12 }, (_, i) => gifItem(i));
const GIF_FAVORITES = [GIF_RESULTS[1]!, GIF_RESULTS[3]!, GIF_RESULTS[6]!];

const GIF_CATEGORIES: GifPickerCategory[] = [
  "happy",
  "excited",
  "thumbs up",
  "facepalm",
  "dance",
  "mind blown",
].map((label, i) => {
  const [a, b] = GIF_SPECS[(i + 2) % GIF_SPECS.length]!;
  return {
    id: `cat-${i}`,
    label,
    query: label,
    imageUrl: gifArt(a, b, 320, 200, ""),
  };
});

function emojiArt(a: string, b: string, glyph: string): string {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><radialGradient id="g"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs>
<circle cx="32" cy="32" r="28" fill="url(#g)"/>${glyph}</svg>`);
}

const EMOJI_EYES =
  '<circle cx="24" cy="28" r="4" fill="#111"/><circle cx="40" cy="28" r="4" fill="#111"/><path d="M22 40q10 8 20 0" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/>';

const CREATED_EMOJIS: GeneratedEmoji[] = [
  ["raccoon_cool", "#a3a3a3", "#525252"],
  ["ship_it", "#fde047", "#f97316"],
  ["party_ralph", "#f472b6", "#7c3aed"],
  ["coffee_time", "#d6a77a", "#7c4a1e"],
  ["big_brain", "#f9a8d4", "#db2777"],
].map(([shortcode, a, b], i) => ({
  id: `pk-emoji-${i}`,
  user_id: "u-me",
  shortcode: shortcode!,
  prompt: shortcode!.replace("_", " "),
  status: "ready",
  image_url: emojiArt(a!, b!, EMOJI_EYES),
  content_type: "image/svg+xml",
  size_bytes: 512,
  created_at: "2026-10-20T12:00:00Z",
  token: `:${shortcode}:`,
}));

const SOUNDBOARD_SERVER: Server = {
  id: "s-pk",
  name: "Ralph HQ",
  owner_id: "u-me",
  created_at: "2026-01-01T00:00:00Z",
};

const SERVER_SOUNDS = [
  ["snd-1", "Airhorn", "📯"],
  ["snd-2", "Rimshot", "🥁"],
  ["snd-3", "Sad trombone", "🎺"],
  ["snd-4", "Crickets", "🦗"],
  ["snd-5", "Applause", "👏"],
  ["snd-6", "Bruh", null],
].map(([id, name, emoji]) => ({
  id: id!,
  name: name!,
  file_url: `/api/soundboard/uploads/${id}`,
  ...(emoji ? { emoji } : {}),
  volume: 1,
  server_id: SOUNDBOARD_SERVER.id,
}));

const SOUNDBOARD_FAVORITES = [
  {
    id: "mi-1",
    title: "Vine boom",
    url: "https://example.invalid/vine-boom.mp3",
    color: "#4f46e5",
    soundType: "myinstants",
  },
  {
    id: "mi-2",
    title: "Emotional damage",
    url: "https://example.invalid/damage.mp3",
    color: "#be123c",
    soundType: "myinstants",
  },
  {
    id: "snd-2",
    title: "Rimshot",
    url: "/api/soundboard/uploads/snd-2",
    color: "#4f46e5",
    emoji: "🥁",
    soundType: "server",
    serverId: SOUNDBOARD_SERVER.id,
    source_server_id: SOUNDBOARD_SERVER.id,
  },
];

// ─── Network stub ───────────────────────────────────────────────────────────

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Answers the pickers' requests from the seeds above. The API client refuses
 * to send without a session token, so a placeholder is stored for the
 * fixture's lifetime when the browser has none (a real one is left alone).
 */
function installPickerStub() {
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/gifs")) {
      const params = new URL(url, window.location.origin).searchParams;
      const mode = params.get("mode");
      if (mode === "categories") return json({ categories: GIF_CATEGORIES });
      if (mode === "favorites") return json({ favorites: GIF_FAVORITES });
      if (mode === "autocomplete" || mode === "suggestions")
        return json({ results: [] });
      const limit = Number(params.get("limit") ?? 24);
      return json({ results: GIF_RESULTS.slice(0, limit), next: null });
    }
    if (url.includes("/api/emojis")) return json({ items: CREATED_EMOJIS });
    if (url.includes("/api/myinstants/favorites"))
      return json({ favorites: SOUNDBOARD_FAVORITES });
    if (url.includes("/api/myinstants")) return json({ results: [] });
    if (url.includes(`/api/servers/${SOUNDBOARD_SERVER.id}/soundboard`))
      return json(SERVER_SOUNDS);
    return original(input, init);
  };
  return () => {
    window.fetch = original;
  };
}

/**
 * Installs the stub and seeds stores before the first child render; the
 * fixture renders nothing until this reports ready (see useFixtureSetup).
 */
function usePickerSetup(): boolean {
  return useFixtureSetup(() => {
    useGifFavoritesStore.setState({
      favorites: GIF_FAVORITES,
      loaded: true,
      loading: false,
      error: null,
    });
    useChatStore.setState({ servers: [SOUNDBOARD_SERVER] });
    window.localStorage.setItem(
      "chat:gifs:recent:gifs",
      JSON.stringify(["good morning", "cat"]),
    );
    const clearSession = installPlaceholderSession();
    const restoreFetch = installPickerStub();
    return () => {
      restoreFetch();
      clearSession();
    };
  });
}

/** Clicks the first button matching `match` once it renders. */
function useAutoClick(match: ((button: HTMLButtonElement) => boolean) | null) {
  useEffect(() => {
    if (!match) return;
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      ).find(match);
      if (button) {
        button.click();
        window.clearInterval(id);
      } else if (tries > 40) {
        window.clearInterval(id);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [match]);
}

const clickTrending = (button: HTMLButtonElement) =>
  (button.textContent ?? "").includes("Trending");
const clickFavorites = (button: HTMLButtonElement) =>
  button.getAttribute("aria-label") === "View favorites";

// ─── Page ───────────────────────────────────────────────────────────────────

/** A stand-in composer row the pickers anchor to. */
function ComposerFrame({
  children,
}: {
  children: (markerRef: React.RefObject<HTMLSpanElement | null>) => ReactNode;
}) {
  const markerRef = useRef<HTMLSpanElement | null>(null);
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1" />
      <div className="relative mx-4 mb-4 flex h-11 items-center rounded-lg border border-rm-border bg-rm-bg-surface px-3 text-ui-sm text-rm-text-muted">
        <span ref={markerRef} className="absolute left-3 top-0" />
        Message #general
      </div>
      {children(markerRef)}
    </div>
  );
}

const noop = () => {};
const noopAsync = async () => {};

const FAKE_SFU = {
  voiceGW: { sendAppEvent: () => true },
  on: () => noop,
} as unknown as SFUClient;

export function PickerFixture({ surface }: { surface: string }) {
  const ready = usePickerSetup();
  const autoClick =
    surface === "pk-gif-trending" ||
    surface === "pk-gif-expanded" ||
    surface === "pk-gif-voice"
      ? clickTrending
      : surface === "pk-gif-favorites"
        ? clickFavorites
        : null;
  useAutoClick(autoClick);
  if (!ready) return null;

  switch (surface) {
    case "pk-emoji":
      return (
        <ComposerFrame>
          {(markerRef) => (
            <EmojiPicker
              open
              onSelect={noop}
              onClose={noop}
              placement="top-end"
              markerRef={markerRef}
            />
          )}
        </ComposerFrame>
      );
    case "pk-gif":
    case "pk-gif-trending":
    case "pk-gif-expanded":
    case "pk-gif-favorites":
    case "pk-gif-voice":
      return (
        <ComposerFrame>
          {(markerRef) => (
            <GifPickerModal
              open
              onClose={noop}
              onSelect={noopAsync}
              markerRef={markerRef}
              initialExpanded={surface === "pk-gif-expanded"}
              voiceMode={
                surface === "pk-gif-voice" ? { sfu: FAKE_SFU } : undefined
              }
            />
          )}
        </ComposerFrame>
      );
    case "pk-soundboard":
      return (
        <ComposerFrame>
          {(markerRef) => (
            <SoundboardPicker
              open
              onClose={noop}
              markerRef={markerRef}
              sfu={null}
              serverId={SOUNDBOARD_SERVER.id}
              channelId="ch-voice"
              localUserId="u-me"
            />
          )}
        </ComposerFrame>
      );
    default:
      return (
        <div className="grid h-full place-items-center text-ui-sm text-rm-text-muted">
          Unknown fixture: {surface}
        </div>
      );
  }
}
