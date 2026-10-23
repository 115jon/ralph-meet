/**
 * Message search: the filter grammar shared by the search UI and the search
 * API. Pure functions only, so both sides (and tests) agree on one model.
 *
 * The UI speaks Discord-style tokens (`from:ada has:image before:2026-10-01`)
 * and turns each resolved token into a filter chip that carries ids, not
 * names. The wire format is plain query params built from those chips:
 *
 *   q        free text, every term must match (quoted "phrases" stay whole)
 *   from     author ids, comma separated, any of
 *   mentions user ids, comma separated, any of
 *   in       channel ids, comma separated, any of
 *   has      link | embed | file | image | video | sound, all of
 *   before   ISO instant, exclusive
 *   after    ISO instant, inclusive
 *   pinned   true | false
 *   sort     newest | oldest | relevant
 *   limit    1..50, offset >= 0
 */

export const SEARCH_FILTER_KEYS = [
  "from",
  "mentions",
  "in",
  "has",
  "before",
  "after",
  "during",
  "pinned",
] as const;
export type SearchFilterKey = (typeof SEARCH_FILTER_KEYS)[number];

export const SEARCH_HAS_VALUES = [
  "link",
  "embed",
  "file",
  "image",
  "video",
  "sound",
] as const;
export type SearchHasValue = (typeof SEARCH_HAS_VALUES)[number];

export const SEARCH_SORTS = ["newest", "oldest", "relevant"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_PAGE_SIZE = 25;
export const SEARCH_MAX_LIMIT = 50;
export const SEARCH_MIN_TEXT = 2;
export const SEARCH_MAX_TEXT = 200;
export const SEARCH_MAX_TERMS = 8;
export const SEARCH_MAX_IDS = 10;

/** Wire-level query, identical on client and server. */
export interface MessageSearchQuery {
  text: string;
  authorIds: string[];
  mentionIds: string[];
  channelIds: string[];
  has: SearchHasValue[];
  before: string | null;
  after: string | null;
  pinned: boolean | null;
  sort: SearchSort;
  limit: number;
  offset: number;
}

export interface SearchResultAttachment {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number;
}

export interface SearchResultAuthor {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_display: string | null;
  display_name_style: string | null;
}

export interface SearchResultMessage {
  id: string;
  channel_id: string;
  channel_name: string | null;
  author_id: string;
  author: SearchResultAuthor;
  content: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string | null;
  attachments: SearchResultAttachment[];
  embed_count: number;
}

export interface MessageSearchResponse {
  messages: SearchResultMessage[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

// ─── Filter chips (client model) ────────────────────────────────────────────

export type SearchFilter =
  | {
      key: "from" | "mentions";
      userId: string;
      label: string;
      username: string;
    }
  | { key: "in"; channelId: string; label: string }
  | { key: "has"; value: SearchHasValue }
  | { key: "before" | "after" | "during"; date: string }
  | { key: "pinned"; value: boolean };

export function filterId(filter: SearchFilter): string {
  switch (filter.key) {
    case "from":
    case "mentions":
      return `${filter.key}:${filter.userId}`;
    case "in":
      return `in:${filter.channelId}`;
    case "has":
      return `has:${filter.value}`;
    case "pinned":
      return "pinned";
    default:
      return `${filter.key}:${filter.date}`;
  }
}

/** The value half of a chip as the user reads it. */
export function filterValueLabel(filter: SearchFilter): string {
  switch (filter.key) {
    case "from":
    case "mentions":
      return filter.label;
    case "in":
      return filter.label;
    case "has":
      return filter.value;
    case "pinned":
      return filter.value ? "yes" : "no";
    default:
      return filter.date;
  }
}

/**
 * Adds a chip, replacing one it contradicts. `pinned` and date keys hold one
 * value; the rest stack (from/in/mentions widen, has narrows).
 */
export function addFilter(
  filters: readonly SearchFilter[],
  next: SearchFilter,
): SearchFilter[] {
  const id = filterId(next);
  const single =
    next.key === "pinned" ||
    next.key === "before" ||
    next.key === "after" ||
    next.key === "during";
  const kept = filters.filter((f) => {
    if (filterId(f) === id) return false;
    if (single && f.key === next.key) return false;
    // `during` pins the day; drop open-ended bounds it replaces, and the
    // reverse.
    if (next.key === "during" && (f.key === "before" || f.key === "after"))
      return false;
    if ((next.key === "before" || next.key === "after") && f.key === "during")
      return false;
    return true;
  });
  const sameKey = kept.filter((f) => f.key === next.key).length;
  if (!single && sameKey >= SEARCH_MAX_IDS) return kept;
  return [...kept, next];
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses YYYY-MM-DD as a local calendar day. */
export function parseLocalDate(value: string): Date | null {
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(m) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Accepts YYYY-MM-DD plus `today` / `yesterday`, relative to `now`. */
export function resolveDateValue(value: string, now: Date): string | null {
  const v = value.trim().toLowerCase();
  if (v === "today") return formatLocalDate(now);
  if (v === "yesterday") return formatLocalDate(addDays(now, -1));
  const parsed = parseLocalDate(v);
  return parsed ? formatLocalDate(parsed) : null;
}

/**
 * Turns date chips into one [after, before) window of ISO instants, using
 * the viewer's local day boundaries. Several chips intersect.
 */
export function dateFiltersToRange(filters: readonly SearchFilter[]): {
  after: string | null;
  before: string | null;
} {
  let after: Date | null = null;
  let before: Date | null = null;
  const narrowAfter = (d: Date) => {
    if (!after || d > after) after = d;
  };
  const narrowBefore = (d: Date) => {
    if (!before || d < before) before = d;
  };
  for (const f of filters) {
    if (f.key !== "before" && f.key !== "after" && f.key !== "during") continue;
    const day = parseLocalDate(f.date);
    if (!day) continue;
    if (f.key === "before") narrowBefore(day);
    if (f.key === "after") narrowAfter(addDays(day, 1));
    if (f.key === "during") {
      narrowAfter(day);
      narrowBefore(addDays(day, 1));
    }
  }
  return {
    after: after ? (after as Date).toISOString() : null,
    before: before ? (before as Date).toISOString() : null,
  };
}

// ─── Text terms and highlighting ────────────────────────────────────────────

/**
 * Splits free text into match terms. "Quoted phrases" stay whole; bare words
 * split on whitespace. Single characters are dropped unless quoted.
 */
export function extractSearchTerms(text: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const phrase = match[1]?.trim();
    const word = match[2]?.replace(/^"+|"+$/g, "");
    if (phrase) terms.push(phrase);
    else if (word && word.length >= 2) terms.push(word);
  }
  const seen = new Set<string>();
  return terms
    .filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, SEARCH_MAX_TERMS);
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Case-insensitive, overlap-safe highlight of every term occurrence. */
export function highlightSegments(
  content: string,
  terms: readonly string[],
): HighlightSegment[] {
  if (!content) return [];
  const lower = content.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    const t = term.toLowerCase();
    if (!t) continue;
    let from = 0;
    while (from <= lower.length) {
      const idx = lower.indexOf(t, from);
      if (idx === -1) break;
      ranges.push([idx, idx + t.length]);
      from = idx + t.length;
    }
  }
  if (ranges.length === 0) return [{ text: content, match: false }];
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: HighlightSegment[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) out.push({ text: content.slice(cursor, s), match: false });
    out.push({ text: content.slice(s, e), match: true });
    cursor = e;
  }
  if (cursor < content.length)
    out.push({ text: content.slice(cursor), match: false });
  return out;
}

/**
 * Long messages are clamped in the result list, so a match deep in the text
 * would be cut off. Start the excerpt shortly before the first match.
 */
export function excerptAroundMatch(
  content: string,
  terms: readonly string[],
  maxChars = 320,
  lead = 60,
): string {
  if (content.length <= maxChars) return content;
  const lower = content.toLowerCase();
  let first = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1 && (first === -1 || idx < first)) first = idx;
  }
  if (first === -1 || first < maxChars - lead * 2) {
    return `${content.slice(0, maxChars).trimEnd()}…`;
  }
  let start = Math.max(0, first - lead);
  const space = content.lastIndexOf(" ", start);
  if (space > start - 20 && space > 0) start = space + 1;
  const end = Math.min(content.length, start + maxChars);
  return `…${content.slice(start, end).trim()}${end < content.length ? "…" : ""}`;
}

// ─── Typed tokens and autocomplete context ──────────────────────────────────

const KEY_ALTERNATION = SEARCH_FILTER_KEYS.join("|");
const TOKEN_RE = new RegExp(
  `(^|\\s)(${KEY_ALTERNATION}):(?:"([^"]*)"|(\\S+))(?=\\s|$)`,
  "gi",
);

export interface TypedToken {
  key: SearchFilterKey;
  value: string;
  start: number;
  end: number;
}

/** Complete `key:value` tokens in typed text, in order. */
export function findTypedTokens(input: string): TypedToken[] {
  const tokens: TypedToken[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(input)) !== null) {
    const lead = match[1] ?? "";
    const value = match[3] ?? match[4] ?? "";
    if (!value) continue;
    tokens.push({
      key: match[2]!.toLowerCase() as SearchFilterKey,
      value,
      start: match.index + lead.length,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

export type AutocompleteContext =
  | { kind: "key"; query: string; start: number; end: number }
  | {
      kind: "value";
      key: SearchFilterKey;
      query: string;
      start: number;
      end: number;
    };

/**
 * What the caret is in the middle of typing: a filter key (`fr`), a filter
 * value (`from:ad`), or a fresh word (empty query, offer every key). Returns
 * null inside ordinary search words.
 */
export function getAutocompleteContext(
  input: string,
  caret: number = input.length,
): AutocompleteContext | null {
  const before = input.slice(0, caret);
  // A quoted value may contain spaces: `from:"Ada Lo`
  const quoted = new RegExp(`(?:^|\\s)(${KEY_ALTERNATION}):"([^"]*)$`, "i");
  const q = quoted.exec(before);
  if (q) {
    const start = before.length - q[0].trimStart().length;
    return {
      kind: "value",
      key: q[1]!.toLowerCase() as SearchFilterKey,
      query: q[2] ?? "",
      start,
      end: wordEnd(input, caret),
    };
  }
  const wordStart = before.search(/\S*$/);
  const word = before.slice(wordStart);
  const end = wordEnd(input, caret);
  const colon = word.indexOf(":");
  if (colon > 0) {
    const key = word.slice(0, colon).toLowerCase();
    if ((SEARCH_FILTER_KEYS as readonly string[]).includes(key)) {
      return {
        kind: "value",
        key: key as SearchFilterKey,
        query: word.slice(colon + 1),
        start: wordStart,
        end,
      };
    }
    return null;
  }
  const lowered = word.toLowerCase();
  if (lowered === "" || SEARCH_FILTER_KEYS.some((k) => k.startsWith(lowered))) {
    return { kind: "key", query: lowered, start: wordStart, end };
  }
  return null;
}

function wordEnd(input: string, caret: number): number {
  const rest = input.slice(caret);
  const m = /^\S*/.exec(rest);
  return caret + (m ? m[0].length : 0);
}

/** Removes [start, end) and tidies the whitespace left behind. */
export function spliceOut(input: string, start: number, end: number): string {
  return `${input.slice(0, start)}${input.slice(end)}`
    .replace(/\s{2,}/g, " ")
    .replace(/^\s+/, "");
}

// ─── Resolving typed tokens into chips ──────────────────────────────────────

export interface SearchMemberSource {
  id: string;
  username: string;
  display_name?: string | null;
}

export interface SearchChannelSource {
  id: string;
  name: string;
}

export interface ResolveSources {
  members: readonly SearchMemberSource[];
  channels: readonly SearchChannelSource[];
  now: Date;
}

export function memberLabel(member: SearchMemberSource): string {
  return member.display_name?.trim() || member.username;
}

export function resolveToken(
  key: SearchFilterKey,
  rawValue: string,
  sources: ResolveSources,
): SearchFilter | null {
  const value = rawValue.trim();
  if (!value) return null;
  const lowered = value.toLowerCase().replace(/^@/, "");
  switch (key) {
    case "from":
    case "mentions": {
      const member =
        sources.members.find((m) => m.username.toLowerCase() === lowered) ??
        sources.members.find(
          (m) => m.display_name?.trim().toLowerCase() === lowered,
        );
      return member
        ? {
            key,
            userId: member.id,
            label: memberLabel(member),
            username: member.username,
          }
        : null;
    }
    case "in": {
      const name = lowered.replace(/^#/, "");
      const channel = sources.channels.find(
        (c) => c.name.toLowerCase() === name,
      );
      return channel
        ? { key, channelId: channel.id, label: channel.name }
        : null;
    }
    case "has":
      return (SEARCH_HAS_VALUES as readonly string[]).includes(lowered)
        ? { key, value: lowered as SearchHasValue }
        : null;
    case "pinned":
      if (["true", "yes"].includes(lowered)) return { key, value: true };
      if (["false", "no"].includes(lowered)) return { key, value: false };
      return null;
    default: {
      const date = resolveDateValue(lowered, sources.now);
      return date ? { key, date } : null;
    }
  }
}

/**
 * Pulls every complete, resolvable token out of the typed text and returns
 * the chips plus the text that is left. Unresolvable tokens stay as text so
 * nothing the user typed disappears silently.
 */
export function commitTypedTokens(
  input: string,
  filters: readonly SearchFilter[],
  sources: ResolveSources,
): { filters: SearchFilter[]; text: string; committed: number } {
  let next = [...filters];
  const resolved: TypedToken[] = [];
  for (const token of findTypedTokens(input)) {
    const filter = resolveToken(token.key, token.value, sources);
    if (!filter) continue;
    next = addFilter(next, filter);
    resolved.push(token);
  }
  let text = input;
  for (let i = resolved.length - 1; i >= 0; i--) {
    const token = resolved[i]!;
    text = `${text.slice(0, token.start)}${text.slice(token.end)}`;
  }
  return {
    filters: next,
    text: text.replace(/\s{2,}/g, " ").trimStart(),
    committed: resolved.length,
  };
}

// ─── Query building and parsing ─────────────────────────────────────────────

export function hasSearchableInput(
  text: string,
  filters: readonly SearchFilter[],
): boolean {
  return filters.length > 0 || text.trim().length >= SEARCH_MIN_TEXT;
}

export function buildSearchQuery(
  text: string,
  filters: readonly SearchFilter[],
  options: { sort: SearchSort; offset?: number; limit?: number },
): MessageSearchQuery {
  const ids = (key: "from" | "mentions") =>
    filters.flatMap((f) => (f.key === key ? [f.userId] : []));
  const range = dateFiltersToRange(filters);
  const pinned = filters.find((f) => f.key === "pinned");
  return {
    text: text.trim().slice(0, SEARCH_MAX_TEXT),
    authorIds: ids("from"),
    mentionIds: ids("mentions"),
    channelIds: filters.flatMap((f) => (f.key === "in" ? [f.channelId] : [])),
    has: filters.flatMap((f) => (f.key === "has" ? [f.value] : [])),
    after: range.after,
    before: range.before,
    pinned: pinned && pinned.key === "pinned" ? pinned.value : null,
    sort: options.sort,
    limit: options.limit ?? SEARCH_PAGE_SIZE,
    offset: options.offset ?? 0,
  };
}

export function toSearchParams(query: MessageSearchQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (query.text) p.set("q", query.text);
  if (query.authorIds.length) p.set("from", query.authorIds.join(","));
  if (query.mentionIds.length) p.set("mentions", query.mentionIds.join(","));
  if (query.channelIds.length) p.set("in", query.channelIds.join(","));
  if (query.has.length) p.set("has", query.has.join(","));
  if (query.before) p.set("before", query.before);
  if (query.after) p.set("after", query.after);
  if (query.pinned !== null) p.set("pinned", String(query.pinned));
  if (query.sort !== "newest") p.set("sort", query.sort);
  p.set("limit", String(query.limit));
  if (query.offset) p.set("offset", String(query.offset));
  return p;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function idList(params: URLSearchParams, name: string): string[] | null {
  const raw = params.getAll(name).flatMap((v) => v.split(","));
  const ids = [...new Set(raw.map((v) => v.trim()).filter(Boolean))];
  if (ids.length > SEARCH_MAX_IDS) return null;
  if (!ids.every((id) => ID_RE.test(id))) return null;
  return ids;
}

function isoInstant(value: string | null): string | null | false {
  if (value === null || value === "") return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString();
}

export type ParsedSearchParams =
  | { ok: true; query: MessageSearchQuery }
  | { ok: false; error: string };

/** Server-side validation of the wire format. */
export function parseSearchParams(params: URLSearchParams): ParsedSearchParams {
  const text = (params.get("q") ?? "").trim();
  if (text.length > SEARCH_MAX_TEXT)
    return { ok: false, error: "Query is too long" };

  const authorIds = idList(params, "from");
  const mentionIds = idList(params, "mentions");
  const channelIds = idList(params, "in");
  if (!authorIds || !mentionIds || !channelIds)
    return { ok: false, error: "Invalid filter ids" };

  const hasRaw = (params.get("has") ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (
    !hasRaw.every((v) => (SEARCH_HAS_VALUES as readonly string[]).includes(v))
  )
    return { ok: false, error: "Invalid has filter" };
  const has = [...new Set(hasRaw)] as SearchHasValue[];

  const before = isoInstant(params.get("before"));
  const after = isoInstant(params.get("after"));
  if (before === false || after === false)
    return { ok: false, error: "Invalid date filter" };

  const pinnedRaw = params.get("pinned");
  let pinned: boolean | null = null;
  if (pinnedRaw === "true") pinned = true;
  else if (pinnedRaw === "false") pinned = false;
  else if (pinnedRaw !== null && pinnedRaw !== "")
    return { ok: false, error: "Invalid pinned filter" };

  const sortRaw = params.get("sort") ?? "newest";
  if (!(SEARCH_SORTS as readonly string[]).includes(sortRaw))
    return { ok: false, error: "Invalid sort" };

  const hasFilter =
    authorIds.length > 0 ||
    mentionIds.length > 0 ||
    channelIds.length > 0 ||
    has.length > 0 ||
    before !== null ||
    after !== null ||
    pinned !== null;
  if (!hasFilter && text.length < SEARCH_MIN_TEXT) {
    return {
      ok: false,
      error: `Query must be at least ${SEARCH_MIN_TEXT} characters`,
    };
  }

  const limitRaw = Number.parseInt(params.get("limit") ?? "", 10);
  const offsetRaw = Number.parseInt(params.get("offset") ?? "", 10);
  return {
    ok: true,
    query: {
      text,
      authorIds,
      mentionIds,
      channelIds,
      has,
      before,
      after,
      pinned,
      sort: sortRaw as SearchSort,
      limit: Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), SEARCH_MAX_LIMIT)
        : SEARCH_PAGE_SIZE,
      offset: Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0,
    },
  };
}

// ─── Grouping ───────────────────────────────────────────────────────────────

export interface SearchResultGroup {
  key: string;
  channelId: string;
  channelName: string | null;
  messages: SearchResultMessage[];
}

/** Consecutive results from one channel share a header, like Discord. */
export function groupResultsByChannel(
  messages: readonly SearchResultMessage[],
): SearchResultGroup[] {
  const groups: SearchResultGroup[] = [];
  for (const message of messages) {
    const last = groups[groups.length - 1];
    if (last && last.channelId === message.channel_id) {
      last.messages.push(message);
    } else {
      groups.push({
        key: `${message.channel_id}:${message.id}`,
        channelId: message.channel_id,
        channelName: message.channel_name,
        messages: [message],
      });
    }
  }
  return groups;
}
