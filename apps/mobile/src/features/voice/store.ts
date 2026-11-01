import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/** joining: sockets and media coming up; reconnecting: one of them dropped. */
export type CallStatus = "joining" | "connected" | "reconnecting";

export interface CallParticipant {
  /** The room's participant id (one per socket session). */
  readonly id: string;
  readonly userId: string | null;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly muted: boolean;
  readonly deafened: boolean;
  /** The room's self_video and self_stream flags: camera on, sharing. */
  readonly camera: boolean;
  readonly sharing: boolean;
}

/**
 * Pulled video of one participant, as react-native-webrtc stream URLs for
 * RTCView. Only set while the call screen is watching (see setWatchingVideo).
 */
export interface ParticipantVideo {
  readonly camera: string | null;
  readonly screen: string | null;
}

export interface ActiveCall {
  readonly serverId: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly status: CallStatus;
  readonly muted: boolean;
  readonly deafened: boolean;
  /** Our participant id, once the room has admitted us. */
  readonly selfId: string | null;
  readonly participants: Readonly<Record<string, CallParticipant>>;
  /** Participant ids speaking now. */
  readonly speaking: Readonly<Record<string, true>>;
  /** Pulled video by participant id; absent when none is pulled. */
  readonly videos: Readonly<Record<string, ParticipantVideo>>;
}

interface VoiceStoreState {
  readonly call: ActiveCall | null;
}

/** State only; the session and ./actions write it. */
export const useVoiceStore = create<VoiceStoreState>()(() => ({ call: null }));

export function updateCall(update: (call: ActiveCall) => ActiveCall): void {
  useVoiceStore.setState((state) =>
    state.call ? { call: update(state.call) } : state,
  );
}

// ── Selectors: narrow, so a tile re-renders only for its own participant ──

export interface CallSummary {
  readonly channelId: string;
  readonly channelName: string;
  readonly status: CallStatus;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly count: number;
}

/** What the app bar segment and the call header show, or null. */
export function useCallSummary(): CallSummary | null {
  return useVoiceStore(
    useShallow((s) =>
      s.call
        ? {
            channelId: s.call.channelId,
            channelName: s.call.channelName,
            status: s.call.status,
            muted: s.call.muted,
            deafened: s.call.deafened,
            count: Object.keys(s.call.participants).length,
          }
        : null,
    ),
  );
}

export function useInCall(): boolean {
  return useVoiceStore((s) => s.call !== null);
}

function sortedParticipantIds(call: ActiveCall): string[] {
  return Object.values(call.participants)
    .sort((a, b) => {
      if (a.id === call.selfId) return -1;
      if (b.id === call.selfId) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((p) => p.id);
}

/** Participant ids, ours first, then by name. */
export function useParticipantIds(): readonly string[] {
  return useVoiceStore(
    useShallow((s) => (s.call ? sortedParticipantIds(s.call) : [])),
  );
}

/** A call tile: a person (camera or avatar), or a screen they share. */
export interface CallTile {
  readonly key: string;
  readonly participantId: string;
  readonly kind: "person" | "screen";
}

const SCREEN_SUFFIX = ":screen";

function parseTile(key: string): CallTile {
  return key.endsWith(SCREEN_SUFFIX)
    ? {
        key,
        participantId: key.slice(0, -SCREEN_SUFFIX.length),
        kind: "screen",
      }
    : { key, participantId: key, kind: "person" };
}

/** People in participant order, then the screens being shared and pulled. */
export function useCallTiles(): readonly CallTile[] {
  const keys = useVoiceStore(
    useShallow((s) => {
      const call = s.call;
      if (!call) return [];
      const ids = sortedParticipantIds(call);
      const screens = ids
        .filter((id) => call.videos[id]?.screen)
        .map((id) => `${id}${SCREEN_SUFFIX}`);
      return [...ids, ...screens];
    }),
  );
  return useMemo(() => keys.map(parseTile), [keys]);
}

/** A tile's stream URL: the camera only while it is on, or the screen. */
export function useTileStream(tile: CallTile): string | null {
  return useVoiceStore((s) => {
    const call = s.call;
    const video = call?.videos[tile.participantId];
    if (!video) return null;
    if (tile.kind === "screen") return video.screen;
    return call?.participants[tile.participantId]?.camera ? video.camera : null;
  });
}

export function useParticipant(id: string): CallParticipant | null {
  return useVoiceStore((s) => s.call?.participants[id] ?? null);
}

export function useIsSelf(id: string): boolean {
  return useVoiceStore((s) => s.call?.selfId === id);
}

export function useIsSpeaking(id: string): boolean {
  return useVoiceStore((s) => s.call?.speaking[id] === true);
}
