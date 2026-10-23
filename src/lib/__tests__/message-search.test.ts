import { describe, expect, it } from "vitest";
import {
  addFilter,
  buildSearchQuery,
  commitTypedTokens,
  dateFiltersToRange,
  excerptAroundMatch,
  extractSearchTerms,
  findTypedTokens,
  getAutocompleteContext,
  groupResultsByChannel,
  hasSearchableInput,
  highlightSegments,
  parseSearchParams,
  resolveToken,
  toSearchParams,
  type ResolveSources,
  type SearchFilter,
  type SearchResultMessage,
} from "../message-search";

const NOW = new Date(2026, 9, 23, 14, 30); // local time, Oct 23 2026

const sources: ResolveSources = {
  now: NOW,
  members: [
    { id: "u-ada", username: "ada", display_name: "Ada Lovelace" },
    { id: "u-grace", username: "grace", display_name: "Grace Hopper" },
    { id: "u-ken", username: "ken", display_name: null },
  ],
  channels: [
    { id: "ch-general", name: "general" },
    { id: "ch-design", name: "design-system" },
  ],
};

describe("getAutocompleteContext", () => {
  it("offers every key on an empty input", () => {
    expect(getAutocompleteContext("")).toEqual({
      kind: "key",
      query: "",
      start: 0,
      end: 0,
    });
  });

  it("offers keys after a finished word", () => {
    expect(getAutocompleteContext("token ")).toMatchObject({
      kind: "key",
      query: "",
      start: 6,
    });
  });

  it("matches a partial key", () => {
    expect(getAutocompleteContext("hello fr")).toMatchObject({
      kind: "key",
      query: "fr",
      start: 6,
      end: 8,
    });
  });

  it("returns null inside an ordinary word", () => {
    expect(getAutocompleteContext("hello wor")).toBeNull();
  });

  it("detects a value being typed for a key", () => {
    expect(getAutocompleteContext("spec from:ad")).toEqual({
      kind: "value",
      key: "from",
      query: "ad",
      start: 5,
      end: 12,
    });
  });

  it("is case-insensitive on the key", () => {
    expect(getAutocompleteContext("HAS:im")).toMatchObject({
      kind: "value",
      key: "has",
      query: "im",
    });
  });

  it("follows the caret, not the end of the input", () => {
    const input = "from:ad spec";
    expect(getAutocompleteContext(input, 7)).toMatchObject({
      kind: "value",
      key: "from",
      query: "ad",
      start: 0,
      end: 7,
    });
  });

  it("keeps spaces inside a quoted value", () => {
    expect(getAutocompleteContext('from:"Ada Lo')).toMatchObject({
      kind: "value",
      key: "from",
      query: "Ada Lo",
      start: 0,
    });
  });

  it("ignores unknown keys", () => {
    expect(getAutocompleteContext("http://x")).toBeNull();
  });
});

describe("findTypedTokens and commitTypedTokens", () => {
  it("finds complete tokens with plain and quoted values", () => {
    const tokens = findTypedTokens('spec from:ada in:"general" has:image');
    expect(tokens.map((t) => [t.key, t.value])).toEqual([
      ["from", "ada"],
      ["in", "general"],
      ["has", "image"],
    ]);
  });

  it("turns resolvable tokens into chips and keeps the rest as text", () => {
    const result = commitTypedTokens(
      "spec from:ada has:nope in:general",
      [],
      sources,
    );
    expect(result.committed).toBe(2);
    expect(result.text.trim()).toBe("spec has:nope");
    expect(result.filters).toEqual([
      { key: "from", userId: "u-ada", label: "Ada Lovelace", username: "ada" },
      { key: "in", channelId: "ch-general", label: "general" },
    ]);
  });

  it("resolves members by display name and channels with a leading #", () => {
    expect(resolveToken("mentions", "Grace Hopper", sources)).toMatchObject({
      userId: "u-grace",
    });
    expect(resolveToken("in", "#design-system", sources)).toMatchObject({
      channelId: "ch-design",
    });
  });

  it("resolves dates, today and yesterday in local time", () => {
    expect(resolveToken("before", "2026-02-30", sources)).toBeNull();
    expect(resolveToken("before", "2026-10-01", sources)).toEqual({
      key: "before",
      date: "2026-10-01",
    });
    expect(resolveToken("during", "yesterday", sources)).toEqual({
      key: "during",
      date: "2026-10-22",
    });
  });

  it("resolves pinned yes/no", () => {
    expect(resolveToken("pinned", "yes", sources)).toEqual({
      key: "pinned",
      value: true,
    });
    expect(resolveToken("pinned", "maybe", sources)).toBeNull();
  });
});

describe("addFilter", () => {
  it("stacks from/has chips and drops duplicates", () => {
    let filters: SearchFilter[] = [];
    filters = addFilter(filters, { key: "has", value: "link" });
    filters = addFilter(filters, { key: "has", value: "image" });
    filters = addFilter(filters, { key: "has", value: "link" });
    expect(filters.map((f) => (f.key === "has" ? f.value : ""))).toEqual([
      "image",
      "link",
    ]);
  });

  it("keeps one pinned chip and lets during replace open bounds", () => {
    let filters: SearchFilter[] = [
      { key: "pinned", value: true },
      { key: "before", date: "2026-10-01" },
    ];
    filters = addFilter(filters, { key: "pinned", value: false });
    filters = addFilter(filters, { key: "during", date: "2026-09-12" });
    expect(filters).toEqual([
      { key: "pinned", value: false },
      { key: "during", date: "2026-09-12" },
    ]);
  });
});

describe("dates to range", () => {
  it("maps before/after/during to local day boundaries", () => {
    const range = dateFiltersToRange([
      { key: "after", date: "2026-10-01" },
      { key: "before", date: "2026-10-10" },
    ]);
    expect(range.after).toBe(new Date(2026, 9, 2).toISOString());
    expect(range.before).toBe(new Date(2026, 9, 10).toISOString());

    const during = dateFiltersToRange([{ key: "during", date: "2026-10-05" }]);
    expect(during.after).toBe(new Date(2026, 9, 5).toISOString());
    expect(during.before).toBe(new Date(2026, 9, 6).toISOString());
  });
});

describe("terms and highlighting", () => {
  it("splits words, keeps quoted phrases and drops single letters", () => {
    expect(extractSearchTerms('token "design system" a Token')).toEqual([
      "token",
      "design system",
    ]);
  });

  it("highlights every occurrence case-insensitively and merges overlaps", () => {
    expect(highlightSegments("Token tokens TOK", ["tok", "token"])).toEqual([
      { text: "Token", match: true },
      { text: " ", match: false },
      { text: "token", match: true },
      { text: "s ", match: false },
      { text: "TOK", match: true },
    ]);
  });

  it("returns the whole text when nothing matches", () => {
    expect(highlightSegments("hello", ["zzz"])).toEqual([
      { text: "hello", match: false },
    ]);
  });

  it("starts long excerpts near the first match", () => {
    const content = `${"lorem ipsum ".repeat(60)}the needle is here ${"dolor ".repeat(20)}`;
    const excerpt = excerptAroundMatch(content, ["needle"], 200, 40);
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt).toContain("needle");
    expect(excerpt.length).toBeLessThanOrEqual(203);
  });

  it("keeps short content untouched", () => {
    expect(excerptAroundMatch("short", ["x"])).toBe("short");
  });
});

describe("query building and parsing", () => {
  const filters: SearchFilter[] = [
    { key: "from", userId: "u-ada", label: "Ada", username: "ada" },
    { key: "in", channelId: "ch-general", label: "general" },
    { key: "has", value: "image" },
    { key: "pinned", value: true },
  ];

  it("round-trips through URL params", () => {
    const query = buildSearchQuery("token scale", filters, {
      sort: "relevant",
      offset: 25,
    });
    const params = toSearchParams(query);
    expect(params.get("from")).toBe("u-ada");
    expect(params.get("sort")).toBe("relevant");
    const parsed = parseSearchParams(params);
    expect(parsed).toEqual({ ok: true, query });
  });

  it("allows filter-only searches but rejects one-letter text alone", () => {
    expect(hasSearchableInput("a", [])).toBe(false);
    expect(hasSearchableInput("", filters)).toBe(true);
    expect(parseSearchParams(new URLSearchParams("q=a")).ok).toBe(false);
    expect(parseSearchParams(new URLSearchParams("from=u-ada")).ok).toBe(true);
  });

  it("rejects bad values", () => {
    const bad = [
      "q=hi&has=gif",
      "q=hi&sort=random",
      "q=hi&before=notadate",
      "q=hi&pinned=maybe",
      "q=hi&from=bad%20id",
      `q=hi&from=${Array.from({ length: 11 }, (_, i) => `u${i}`).join(",")}`,
    ];
    for (const qs of bad) {
      expect(parseSearchParams(new URLSearchParams(qs)).ok).toBe(false);
    }
  });

  it("clamps limit and offset", () => {
    const parsed = parseSearchParams(
      new URLSearchParams("q=hi&limit=500&offset=-4"),
    );
    expect(parsed.ok && parsed.query.limit).toBe(50);
    expect(parsed.ok && parsed.query.offset).toBe(0);
  });
});

describe("groupResultsByChannel", () => {
  const m = (id: string, channel: string) =>
    ({ id, channel_id: channel, channel_name: channel }) as SearchResultMessage;

  it("groups consecutive results from the same channel", () => {
    const groups = groupResultsByChannel([
      m("1", "a"),
      m("2", "a"),
      m("3", "b"),
      m("4", "a"),
    ]);
    expect(groups.map((g) => [g.channelId, g.messages.length])).toEqual([
      ["a", 2],
      ["b", 1],
      ["a", 1],
    ]);
  });
});
