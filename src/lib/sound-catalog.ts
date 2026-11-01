// ============================================================================
// UI sound catalog
//
// Every UI sound the app plays, the settings toggle that gates it, and how
// often it may fire. The engine in `sounds.ts` reads this table; custom sound
// files are imported per id (`custom-sounds.ts`).
// ============================================================================

import type { SoundCategory } from "@/stores/useSoundSettingsStore";

export const SOUND_IDS = [
  "voiceJoin",
  "voiceLeave",
  "mute",
  "unmute",
  "deafen",
  "undeafen",
  "notification",
  "message",
  "connect",
  "disconnect",
  "ring",
  "outgoingRing",
  "callConnect",
  "callEnd",
  "screenShareStart",
  "screenShareStop",
  "streamWatcherStart",
  "streamWatcherStop",
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

export interface SoundSpec {
  /** Settings toggle that must be on (with `soundsEnabled`) for it to play. */
  category: SoundCategory;
  /**
   * Sounds sharing a group share the rate limit and the voice pool, so mute
   * then unmute in quick succession replaces rather than stacks.
   */
  group: string;
  /** Starts closer together than this are dropped, so bursts coalesce. */
  minIntervalMs: number;
  /** Concurrent voices in the group; the oldest is faded out past this. */
  maxVoices: number;
  /** Rings loop on the audio clock with this period (seconds). */
  loopSeconds?: number;
}

export const SOUND_SPECS: Record<SoundId, SoundSpec> = {
  voiceJoin: {
    category: "voiceJoinLeave",
    group: "presence",
    minIntervalMs: 150,
    maxVoices: 2,
  },
  voiceLeave: {
    category: "voiceJoinLeave",
    group: "presence",
    minIntervalMs: 150,
    maxVoices: 2,
  },
  mute: {
    category: "muteDeafen",
    group: "mic",
    minIntervalMs: 40,
    maxVoices: 1,
  },
  unmute: {
    category: "muteDeafen",
    group: "mic",
    minIntervalMs: 40,
    maxVoices: 1,
  },
  deafen: {
    category: "muteDeafen",
    group: "deafen",
    minIntervalMs: 40,
    maxVoices: 1,
  },
  undeafen: {
    category: "muteDeafen",
    group: "deafen",
    minIntervalMs: 40,
    maxVoices: 1,
  },
  notification: {
    category: "notifications",
    group: "notification",
    minIntervalMs: 700,
    maxVoices: 1,
  },
  message: {
    category: "messageReceived",
    group: "message",
    minIntervalMs: 350,
    maxVoices: 2,
  },
  connect: {
    category: "selfConnectDisconnect",
    group: "self",
    minIntervalMs: 250,
    maxVoices: 1,
  },
  disconnect: {
    category: "selfConnectDisconnect",
    group: "self",
    minIntervalMs: 250,
    maxVoices: 1,
  },
  ring: {
    category: "calls",
    group: "ring",
    minIntervalMs: 0,
    maxVoices: 1,
    loopSeconds: 2.5,
  },
  outgoingRing: {
    category: "calls",
    group: "outgoingRing",
    minIntervalMs: 0,
    maxVoices: 1,
    loopSeconds: 3,
  },
  callConnect: {
    category: "calls",
    group: "call",
    minIntervalMs: 300,
    maxVoices: 1,
  },
  callEnd: {
    category: "calls",
    group: "call",
    minIntervalMs: 300,
    maxVoices: 1,
  },
  screenShareStart: {
    category: "screenShare",
    group: "screen",
    minIntervalMs: 250,
    maxVoices: 1,
  },
  screenShareStop: {
    category: "screenShare",
    group: "screen",
    minIntervalMs: 250,
    maxVoices: 1,
  },
  streamWatcherStart: {
    category: "streamWatcherActivity",
    group: "watcher",
    minIntervalMs: 250,
    maxVoices: 2,
  },
  streamWatcherStop: {
    category: "streamWatcherActivity",
    group: "watcher",
    minIntervalMs: 250,
    maxVoices: 2,
  },
};

/** What each sound means, in settings copy. */
export const SOUND_LABELS: Record<SoundId, string> = {
  voiceJoin: "Someone joins voice",
  voiceLeave: "Someone leaves voice",
  mute: "Mute",
  unmute: "Unmute",
  deafen: "Deafen",
  undeafen: "Undeafen",
  notification: "Notification",
  message: "New message",
  connect: "You connect to voice",
  disconnect: "You disconnect from voice",
  ring: "Incoming call ring",
  outgoingRing: "Outgoing call ring",
  callConnect: "Call connected",
  callEnd: "Call ended",
  screenShareStart: "Screen share starts",
  screenShareStop: "Screen share stops",
  streamWatcherStart: "Viewer starts watching",
  streamWatcherStop: "Viewer stops watching",
};

/** File name (without extension) a bulk import matches to `id`: voice-join. */
export function soundFileStem(id: SoundId): string {
  return id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function isLoopSound(id: SoundId): id is "ring" | "outgoingRing" {
  return SOUND_SPECS[id].loopSeconds !== undefined;
}
