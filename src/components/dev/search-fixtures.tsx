/**
 * Dev-only search fixtures (see routes/ui-fixtures.tsx): seeded avatars, a
 * message corpus and a local search backend that applies the same filters as
 * the API, so the real SearchPanel and CommandMenu render without a session.
 *
 *   search            phone/desktop autocomplete for `from:` with avatars
 *   search-idle       panel open, nothing typed
 *   search-results    "token", grouped by channel
 *   search-filtered   from:grace has:file chips
 *   search-empty      no matches
 *   search-loading    skeleton
 *   search-error      failed request
 *   search-dm         a DM search
 *   command-menu      quick switcher (&q= to prefill)
 */

import CommandMenu from "@/components/CommandMenu";
import { openMessageSearch } from "@/components/chat/search/open-message-search";
import {
  SearchFetcherContext,
  type SearchFetcher,
} from "@/components/chat/search/useMessageSearch";
import {
  extractSearchTerms,
  parseSearchParams,
  type MessageSearchResponse,
  type SearchResultMessage,
} from "@/lib/message-search";
import type { ChatMember } from "@/lib/chat-reducer";
import type { Server, User } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SEARCH_FIXTURE_TEXT as SEARCH_TEXT } from "./search-fixture-surfaces";

const NOW = Date.parse("2026-10-22T14:32:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

// ─── Seeded art ─────────────────────────────────────────────────────────────

function svgUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Illustrated avatar: a tinted ground with a soft head-and-shoulders form. */
function avatar(a: string, b: string, skin: string, hair: string): string {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="96" height="96" fill="url(#g)"/>
<path d="M14 96c2-20 16-30 34-30s32 10 34 30z" fill="${hair}" opacity=".9"/>
<circle cx="48" cy="42" r="19" fill="${skin}"/>
<path d="M29 40c0-13 9-22 19-22s19 9 19 22c-4-7-11-10-19-10s-15 3-19 10z" fill="${hair}"/>
</svg>`);
}

function serverArt(a: string, b: string, glyph: string): string {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="96" height="96" fill="url(#g)"/>${glyph}</svg>`);
}

const AVATARS: Record<string, string> = {
  "u-me": avatar("#5865f2", "#3b3fb8", "#f1c9a5", "#2b2118"),
  "u-ada": avatar("#f6a5c0", "#c2557e", "#f3d2b8", "#4a2c2a"),
  "u-grace": avatar("#7dd3a8", "#2f8f6a", "#e8b896", "#e7e2d6"),
  "u-linus": avatar("#fcd581", "#d98f2b", "#f0c8a0", "#c28a4a"),
  "u-margaret": avatar("#9ec5fe", "#4a7bd0", "#c99572", "#1d1d24"),
};

const SERVER_ICONS: Record<string, string> = {
  "s-1": serverArt(
    "#5865f2",
    "#8b5cf6",
    '<circle cx="48" cy="48" r="20" fill="none" stroke="#fff" stroke-width="8"/><circle cx="48" cy="48" r="6" fill="#fff"/>',
  ),
  "s-2": serverArt(
    "#f97316",
    "#ef4444",
    '<path d="M28 66 48 26l20 40z" fill="#fff" opacity=".95"/>',
  ),
};

// ─── Corpus ─────────────────────────────────────────────────────────────────

type Author = Pick<User, "id" | "username" | "display_name">;

function result(
  id: string,
  channel: [string, string],
  author: Author,
  content: string,
  minutesAgo: number,
  extra: Partial<SearchResultMessage> = {},
): SearchResultMessage {
  return {
    id,
    channel_id: channel[0],
    channel_name: channel[1],
    author_id: author.id,
    author: {
      id: author.id,
      username: author.username,
      display_name: author.display_name ?? null,
      avatar_url: AVATARS[author.id] ?? null,
      avatar_display: null,
      display_name_style: null,
    },
    content,
    is_pinned: false,
    created_at: ago(minutesAgo),
    updated_at: null,
    attachments: [],
    embed_count: 0,
    ...extra,
  };
}

const GENERAL: [string, string] = ["ch-general", "general"];
const DESIGN: [string, string] = ["ch-design", "design-system"];
const RANDOM: [string, string] = ["ch-random", "random"];

const ADA: Author = {
  id: "u-ada",
  username: "ada",
  display_name: "Ada Lovelace",
};
const GRACE: Author = {
  id: "u-grace",
  username: "grace",
  display_name: "Grace Hopper",
};
const LINUS: Author = {
  id: "u-linus",
  username: "linus",
  display_name: "Linus",
};
const ME: Author = { id: "u-me", username: "jon", display_name: "Jon" };
const MARGARET: Author = {
  id: "u-margaret",
  username: "mhamilton",
  display_name: "Margaret Hamilton",
};
const KEN: Author = { id: "u-ken", username: "ken", display_name: "Ken" };

const CORPUS: SearchResultMessage[] = [
  result(
    "r-1",
    GENERAL,
    ADA,
    "Morning all. Pushing the new token scale today.",
    95,
  ),
  result(
    "r-2",
    GENERAL,
    ADA,
    "Spacing tokens are now 4/8/12/16/24/32, radii are 6/8/12/16/20. Everything else is a bug.",
    94,
    { is_pinned: true },
  ),
  result(
    "r-3",
    GENERAL,
    LINUS,
    "Can we also kill `transition-all`? @ada the token pass is the perfect excuse.",
    61,
  ),
  result(
    "r-4",
    DESIGN,
    GRACE,
    "Attached the token audit. 214 one-off colours left, most of them in settings.",
    300,
    {
      attachments: [
        {
          id: "a-1",
          filename: "token-audit-2026-10.pdf",
          content_type: "application/pdf",
          size_bytes: 412_000,
        },
        {
          id: "a-2",
          filename: "before-after.png",
          content_type: "image/png",
          size_bytes: 88_000,
        },
      ],
    },
  ),
  result(
    "r-5",
    DESIGN,
    ME,
    "Light theme token contrast is fixed: every ink pair is ≥4.5:1 now. https://ralph.dev/tokens",
    420,
    { embed_count: 1 },
  ),
  result(
    "r-6",
    DESIGN,
    MARGARET,
    "Reminder that a design token is a promise. If two values look the same but mean different things, they are two tokens.",
    1500,
  ),
  result(
    "r-7",
    RANDOM,
    KEN,
    "unrelated but the token ring at the coffee place finally works",
    2900,
  ),
  result(
    "r-8",
    GENERAL,
    GRACE,
    "Shipping the spec after lunch, file incoming.",
    12,
    {
      attachments: [
        {
          id: "a-3",
          filename: "search-spec.fig",
          content_type: "application/octet-stream",
          size_bytes: 2_400_000,
        },
      ],
    },
  ),
  result(
    "r-9",
    GENERAL,
    GRACE,
    "Screenshots of the new search, phone and desktop.",
    9,
    {
      attachments: [
        {
          id: "a-4",
          filename: "search-390.png",
          content_type: "image/png",
          size_bytes: 120_000,
        },
        {
          id: "a-5",
          filename: "search-1280.png",
          content_type: "image/png",
          size_bytes: 240_000,
        },
        {
          id: "a-6",
          filename: "search-dark.png",
          content_type: "image/png",
          size_bytes: 230_000,
        },
      ],
    },
  ),
  result(
    "r-10",
    ["dm-ada", "dm-ada"],
    ADA,
    "Lunch tomorrow? The new place by the station.",
    200,
  ),
];

function matches(
  message: SearchResultMessage,
  params: URLSearchParams,
): boolean {
  const parsed = parseSearchParams(params);
  if (!parsed.ok) return false;
  const q = parsed.query;
  const content = message.content.toLowerCase();
  if (
    !extractSearchTerms(q.text).every((t) => content.includes(t.toLowerCase()))
  )
    return false;
  if (q.authorIds.length && !q.authorIds.includes(message.author_id))
    return false;
  if (q.channelIds.length && !q.channelIds.includes(message.channel_id))
    return false;
  if (q.pinned !== null && message.is_pinned !== q.pinned) return false;
  for (const has of q.has) {
    const types = message.attachments.map((a) => a.content_type ?? "");
    if (has === "file" && types.length === 0) return false;
    if (has === "image" && !types.some((t) => t.startsWith("image/")))
      return false;
    if (has === "video" && !types.some((t) => t.startsWith("video/")))
      return false;
    if (has === "sound" && !types.some((t) => t.startsWith("audio/")))
      return false;
    if (has === "embed" && message.embed_count === 0) return false;
    if (has === "link" && !/https?:\/\//.test(message.content)) return false;
  }
  return true;
}

function makeFetcher(mode: "ok" | "loading" | "error"): SearchFetcher {
  return (url, signal) => {
    if (mode === "loading") return new Promise(() => {});
    if (mode === "error")
      return new Promise((_, reject) =>
        setTimeout(() => reject(new Error("offline")), 150),
      );
    const parsedUrl = new URL(url, "http://fixture");
    const params = parsedUrl.searchParams;
    const dmScope = parsedUrl.pathname.startsWith("/api/channels/");
    const parsed = parseSearchParams(params);
    const limit = parsed.ok ? parsed.query.limit : 25;
    const offset = parsed.ok ? parsed.query.offset : 0;
    const sort = parsed.ok ? parsed.query.sort : "newest";
    let hits = CORPUS.filter(
      (m) =>
        (dmScope
          ? m.channel_id.startsWith("dm-")
          : !m.channel_id.startsWith("dm-")) && matches(m, params),
    );
    hits = [...hits].sort((a, b) =>
      sort === "oldest"
        ? a.created_at.localeCompare(b.created_at)
        : b.created_at.localeCompare(a.created_at),
    );
    const page = hits.slice(offset, offset + limit);
    const response: MessageSearchResponse = {
      messages: page,
      total: hits.length,
      limit,
      offset,
      has_more: offset + page.length < hits.length,
    };
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(response), 250);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  };
}

/** Layers avatars and server icons onto the shared fixture store. */
function seedSearchArt() {
  const state = useChatStore.getState();
  const withAvatar = <T extends { id: string }>(user: T): T => ({
    ...user,
    avatar_url: AVATARS[user.id] ?? null,
  });
  const members = (state.members as ChatMember[]).map((m) => ({
    ...m,
    user: withAvatar(m.user),
  }));
  useChatStore.setState({
    user: state.user ? withAvatar(state.user) : state.user,
    members,
    membersByServerId: { ...state.membersByServerId, "s-1": members },
    servers: (state.servers as Server[]).map((s) => ({
      ...s,
      icon_url: SERVER_ICONS[s.id] ?? null,
    })),
    dmChannels: state.dmChannels.map((dm) => ({
      ...dm,
      recipient: dm.recipient ? withAvatar(dm.recipient) : dm.recipient,
    })),
    relationships: state.relationships.map((r) => ({
      ...r,
      user: withAvatar(r.user),
    })),
  } as never);
}

export function SearchFixture({
  surface,
  renderShell,
}: {
  surface: string;
  renderShell: (shellSurface: "shell" | "shell-dm") => ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const fetcher = useMemo(
    () =>
      makeFetcher(
        surface === "search-loading"
          ? "loading"
          : surface === "search-error"
            ? "error"
            : "ok",
      ),
    [surface],
  );

  useEffect(() => {
    seedSearchArt();
    const id = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      if (surface === "command-menu") {
        window.dispatchEvent(new CustomEvent("open-command-menu"));
        const q = new URLSearchParams(window.location.search).get("q");
        if (q) {
          window.setTimeout(() => {
            const input =
              document.querySelector<HTMLInputElement>("[cmdk-input]");
            if (!input) return;
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            )?.set;
            setter?.call(input, q);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }, 50);
        }
      } else {
        openMessageSearch(SEARCH_TEXT[surface] ?? "");
      }
    }, 60);
    return () => window.clearTimeout(id);
  }, [ready, surface]);

  if (!ready) return <div className="h-full w-full bg-rm-bg-primary" />;

  return (
    <SearchFetcherContext.Provider value={fetcher}>
      {renderShell(surface === "search-dm" ? "shell-dm" : "shell")}
      {surface === "command-menu" && <CommandMenu />}
    </SearchFetcherContext.Provider>
  );
}
