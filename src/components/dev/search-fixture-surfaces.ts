/** Search fixture surfaces and the text each one opens search with. */
export const SEARCH_FIXTURE_TEXT: Record<string, string> = {
  search: "from:",
  "search-idle": "",
  "search-results": "token",
  "search-filtered": "from:grace has:file ",
  "search-empty": "in:random kubernetes",
  "search-loading": "token",
  "search-error": "token",
  "search-dm": "lunch",
};

export function isSearchFixture(surface: string): boolean {
  return surface in SEARCH_FIXTURE_TEXT || surface === "command-menu";
}
