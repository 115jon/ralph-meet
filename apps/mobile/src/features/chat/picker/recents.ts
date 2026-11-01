import { Schema } from "effect";
import { create } from "zustand";

import { readPersisted, writePersisted } from "@/lib/persist";

import { isSkinTone, type SkinTone } from "./emoji-data";
import { MAX_RECENTS, withRecent } from "./recent-list";

// Picker memory kept on the device, as the web keeps it in localStorage:
// recently used emoji (shared by the composer and reactions, like the web's
// chat:emoji:recents:v1), the skin tone (chat:emoji:skin-tone:v1) and the
// tab the panel last showed (the web's defaultMediaType).

const STORAGE = "emoji-picker";

export type PickerTab = "emoji" | "gif";

const Stored = Schema.Struct({
  recents: Schema.Array(Schema.String),
  tone: Schema.Number,
  tab: Schema.Literals(["emoji", "gif"]),
});

interface PickerPrefs {
  /** Glyphs and `<:name:id>` tokens, newest first. */
  readonly recents: readonly string[];
  readonly tone: SkinTone;
  readonly tab: PickerTab;
}

const saved = readPersisted(STORAGE, Stored);
const INITIAL: PickerPrefs = {
  recents: saved?.recents.slice(0, MAX_RECENTS) ?? [],
  tone: saved && isSkinTone(saved.tone) ? saved.tone : 0,
  tab: saved?.tab ?? "emoji",
};

const usePrefs = create<PickerPrefs>()(() => INITIAL);

function update(patch: Partial<PickerPrefs>): void {
  usePrefs.setState(patch);
  writePersisted(STORAGE, usePrefs.getState());
}

export function rememberEmoji(value: string): void {
  update({ recents: withRecent(usePrefs.getState().recents, value) });
}

export function setSkinTone(tone: SkinTone): void {
  update({ tone });
}

export function setPickerTab(tab: PickerTab): void {
  if (usePrefs.getState().tab !== tab) update({ tab });
}

export function useRecents(): readonly string[] {
  return usePrefs((s) => s.recents);
}

export function useSkinTone(): SkinTone {
  return usePrefs((s) => s.tone);
}

export function usePickerTab(): PickerTab {
  return usePrefs((s) => s.tab);
}

/** Sign-out: recents can name the account's own emoji. The tone is the device's. */
export function resetRecents(): void {
  update({ recents: [], tab: "emoji" });
}
