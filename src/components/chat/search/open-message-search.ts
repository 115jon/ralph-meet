/** Window event that opens message search, optionally with text to run. */
export const OPEN_MESSAGE_SEARCH_EVENT = "open-message-search";

export function openMessageSearch(text = ""): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_MESSAGE_SEARCH_EVENT, { detail: { text } }),
  );
}
