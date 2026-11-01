import { Schema } from "effect";

import { readPersisted, writePersisted } from "@/lib/persist";

// Unsent text per conversation, like Discord: leaving a channel (or the
// app) keeps what was typed, and sending clears it. Files are not kept;
// their picked copies may be gone by the next launch. A composer reads its
// draft once when it mounts, so this is a plain map, not a store.

const STORAGE = "drafts";
/** The least recently touched drafts beyond this many are dropped. */
const MAX_DRAFTS = 50;

/** [channelId, text] pairs, least recently touched first. */
const Stored = Schema.Array(Schema.Tuple([Schema.String, Schema.String]));

// A Map keeps insertion order for every key (an object would sort
// number-like ids first), so the oldest draft is always the first entry.
const drafts = new Map<string, string>(readPersisted(STORAGE, Stored) ?? []);

/** The draft of `channelId`, or "". */
export function readDraft(channelId: string): string {
  return drafts.get(channelId) ?? "";
}

/** Keeps `text` as the draft of `channelId`; blank text clears it. */
export function saveDraft(channelId: string, text: string): void {
  const keep = text.trim().length > 0;
  if ((drafts.get(channelId) ?? "") === (keep ? text : "")) return;
  drafts.delete(channelId);
  if (keep) drafts.set(channelId, text);
  for (const key of drafts.keys()) {
    if (drafts.size <= MAX_DRAFTS) break;
    drafts.delete(key);
  }
  writePersisted(STORAGE, [...drafts]);
}

export function clearDraft(channelId: string): void {
  saveDraft(channelId, "");
}

/** Sign-out: drafts belong to the account that wrote them. */
export function resetDrafts(): void {
  drafts.clear();
  writePersisted(STORAGE, null);
}
