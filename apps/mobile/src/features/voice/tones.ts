import { useCallPreferences } from "@/features/preferences/call-preferences";

import { playBundled } from "./call-sounds";
import { type ActiveCall, useVoiceStore } from "./store";

// Join and leave tones: the web's voiceJoin / voiceLeave two-tones, when
// someone else joins or leaves the call we are in. Never for our own join
// (the roster we arrive to is not a join), never while deafened, and only
// with the setting on. A join and a leave together play the join, as the
// web's roster diff does.

/** The web's minIntervalMs for presence sounds. */
const MIN_INTERVAL_MS = 150;
let lastAt = 0;

function others(call: ActiveCall): Set<string> {
  const ids = new Set(Object.keys(call.participants));
  if (call.selfId) ids.delete(call.selfId);
  return ids;
}

function change(
  previous: ActiveCall,
  next: ActiveCall,
): "join" | "leave" | null {
  // Still arriving: the first roster is everyone already there.
  if (previous.selfId === null || previous.channelId !== next.channelId) {
    return null;
  }
  const before = others(previous);
  const after = others(next);
  // Our own id moving (a rejoin) is not anyone else coming or going.
  if (next.selfId) before.delete(next.selfId);
  if (previous.selfId) after.delete(previous.selfId);
  for (const id of after) if (!before.has(id)) return "join";
  for (const id of before) if (!after.has(id)) return "leave";
  return null;
}

/** Plays the tones for as long as the app runs; returns the unsubscribe. */
export function startJoinLeaveTones(): () => void {
  return useVoiceStore.subscribe((state, previousState) => {
    const next = state.call;
    const previous = previousState.call;
    if (!next || !previous || next.participants === previous.participants) {
      return;
    }
    const kind = change(previous, next);
    if (!kind || next.deafened) return;
    if (!useCallPreferences.getState().joinLeaveTones) return;
    const now = Date.now();
    if (now - lastAt < MIN_INTERVAL_MS) return;
    lastAt = now;
    void playBundled("tone", kind === "join" ? "voice-join" : "voice-leave", 1);
  });
}
