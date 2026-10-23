import { describe, expect, it } from "vitest";
import { getAutocompleteContext } from "@/lib/message-search";
import {
  buildSearchSuggestions,
  flattenSuggestions,
  suggestionToFilter,
  type SuggestionChannel,
  type SuggestionMember,
} from "../search-suggestions";

const members: SuggestionMember[] = [
  {
    id: "u-ada",
    username: "ada",
    display_name: "Ada Lovelace",
    roleColor: "#f0b232",
  },
  { id: "u-grace", username: "grace", display_name: "Grace Hopper" },
  { id: "u-mh", username: "mhamilton", display_name: "Margaret Hamilton" },
];
const channels: SuggestionChannel[] = [
  { id: "c-general", name: "general", channel_type: "text" },
  { id: "c-design", name: "design-system", channel_type: "text" },
  { id: "c-lounge", name: "Lounge", channel_type: "voice" },
];
const now = new Date(2026, 9, 23, 12);
const sources = { members, channels, now, allowChannelFilter: true };

const suggest = (input: string, extra: Partial<typeof sources> = {}) =>
  flattenSuggestions(
    buildSearchSuggestions(getAutocompleteContext(input), {
      ...sources,
      ...extra,
    }),
  );

describe("buildSearchSuggestions", () => {
  it("lists every filter key on an empty field, plus recents", () => {
    const items = buildSearchSuggestions(getAutocompleteContext(""), {
      ...sources,
      recent: [{ text: "token", filters: [] }],
    });
    expect(items.map((g) => g.heading)).toEqual([
      "Search options",
      "Recent searches",
    ]);
    expect(items[0]!.items.map((i) => (i.kind === "key" ? i.key : ""))).toEqual(
      ["from", "mentions", "in", "has", "before", "after", "during", "pinned"],
    );
  });

  it("hides in: where there is only one channel", () => {
    const keys = suggest("", { allowChannelFilter: false }).map((i) =>
      i.kind === "key" ? i.key : "",
    );
    expect(keys).not.toContain("in");
    expect(suggest("in:", { allowChannelFilter: false })).toEqual([]);
  });

  it("narrows keys by prefix", () => {
    expect(suggest("pi").map((i) => i.id)).toEqual(["key:pinned"]);
  });

  it("ranks members by username, display name and word starts", () => {
    expect(suggest("from:ham").map((i) => i.id)).toEqual(["user:from:u-mh"]);
    expect(suggest("mentions:g").map((i) => i.id)).toEqual([
      "user:mentions:u-grace",
      "user:mentions:u-mh",
    ]);
    const [ada] = suggest("from:ada");
    expect(ada).toMatchObject({
      kind: "user",
      member: { roleColor: "#f0b232" },
    });
  });

  it("suggests channels, has values, pinned values and dates", () => {
    expect(suggest("in:#des").map((i) => i.id)).toEqual(["channel:c-design"]);
    expect(suggest("has:i").map((i) => i.id)).toEqual(["has:image"]);
    expect(suggest("pinned:").map((i) => i.id)).toEqual([
      "pinned:true",
      "pinned:false",
    ]);
    expect(
      suggest("before:").map((i) => (i.kind === "date" ? i.date : "")),
    ).toEqual(["2026-10-23", "2026-10-22", "2026-10-16", "2026-09-23"]);
    expect(suggest("after:2026-01-05").map((i) => i.id)).toEqual([
      "date:after:2026-01-05",
    ]);
  });

  it("returns nothing inside plain words", () => {
    expect(suggest("hello wor")).toEqual([]);
  });
});

describe("suggestionToFilter", () => {
  it("turns value suggestions into chips", () => {
    const [user] = suggest("from:ada");
    expect(suggestionToFilter(user!)).toEqual({
      key: "from",
      userId: "u-ada",
      label: "Ada Lovelace",
      username: "ada",
    });
    const [channel] = suggest("in:gen");
    expect(suggestionToFilter(channel!)).toEqual({
      key: "in",
      channelId: "c-general",
      label: "general",
    });
    const [key] = suggest("fr");
    expect(suggestionToFilter(key!)).toBeNull();
  });
});
