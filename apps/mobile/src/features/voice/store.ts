import type { VideoFlow } from "@ralph/voice-media/video-flow";
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
  readonly username: string | null;
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

/** What we publish ourselves, besides the microphone. */
export interface LocalMedia {
  /** Our camera as a react-native-webrtc stream URL, while it is on. */
  readonly camera: string | null;
  /** The front camera: the self-view is mirrored, like a mirror. */
  readonly mirror: boolean;
  /** Our screen is being shared. It is never shown back to us. */
  readonly sharing: boolean;
}

export const NO_LOCAL_MEDIA: LocalMedia = {
  camera: null,
  mirror: true,
  sharing: false,
};

/** What makes a call a DM call. */
export interface DmCall {
  readonly peerId: string;
  /** The ring answered on this phone, when this call began as one. */
  readonly answeredCallId?: string;
}

export interface ActiveCall {
  readonly serverId: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly dm?: DmCall;
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
  /**
   * Whether each shown remote camera plays, by participant id (see
   * @ralph/voice-media RemoteVideoHealth); absent while unmeasured.
   */
  readonly cameraFlows: Readonly<Record<string, VideoFlow>>;
  readonly local: LocalMedia;
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
  readonly serverId: string;
  readonly channelId: string;
  /** The other person, in a DM call. */
  readonly peerId: string | null;
  readonly channelName: string;
  readonly status: CallStatus;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly camera: boolean;
  readonly sharing: boolean;
  readonly count: number;
}

/** What the panel's call row and the call header show, or null. */
export function useCallSummary(): CallSummary | null {
  return useVoiceStore(
    useShallow((s) =>
      s.call
        ? {
            serverId: s.call.serverId,
            channelId: s.call.channelId,
            peerId: s.call.dm?.peerId ?? null,
            channelName: s.call.channelName,
            status: s.call.status,
            muted: s.call.muted,
            deafened: s.call.deafened,
            camera: s.call.local.camera !== null,
            sharing: s.call.local.sharing,
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

/**
 * A tile's stream URL: the camera only while it is on, or the screen. Our
 * own tile shows the local camera, never a pull of ourselves.
 */
function tileStream(call: ActiveCall | null, tile: CallTile): string | null {
  if (!call) return null;
  if (tile.participantId === call.selfId) {
    return tile.kind === "person" ? call.local.camera : null;
  }
  const video = call.videos[tile.participantId];
  if (!video) return null;
  if (tile.kind === "screen") return video.screen;
  return call.participants[tile.participantId]?.camera ? video.camera : null;
}

export function useTileStream(tile: CallTile): string | null {
  return useVoiceStore((s) => tileStream(s.call, tile));
}

/**
 * A remote camera tile announced on (self_video), and its shown track's
 * flow; null for anything else (our own tile, a screen, a camera off).
 */
export function useRemoteCamera(
  tile: CallTile,
): { readonly flow: VideoFlow | undefined } | null {
  const on = useVoiceStore(
    (s) =>
      tile.kind === "person" &&
      s.call?.selfId !== tile.participantId &&
      s.call?.participants[tile.participantId]?.camera === true,
  );
  const flow = useVoiceStore((s) => s.call?.cameraFlows[tile.participantId]);
  return useMemo(() => (on ? { flow } : null), [on, flow]);
}

/**
 * The tile the PiP window shows: the staged one if it has video, else the
 * camera of whoever is speaking, else a share, else any camera (ours too).
 * Null with no video on screen: a voice-only call never enters PiP.
 */
export function usePipTile(
  tiles: readonly CallTile[],
  stagedKey: string | null,
): CallTile | null {
  const key = useVoiceStore((s) => {
    const call = s.call;
    if (!call) return null;
    const live = tiles.filter((tile) => tileStream(call, tile) !== null);
    const staged = live.find((tile) => tile.key === stagedKey);
    const speaking = live.find(
      (tile) => tile.kind === "person" && call.speaking[tile.participantId],
    );
    const screen = live.find((tile) => tile.kind === "screen");
    return (staged ?? speaking ?? screen ?? live[0])?.key ?? null;
  });
  return tiles.find((tile) => tile.key === key) ?? null;
}

/** Our front-camera tile is mirrored; everything else shows as sent. */
export function useTileMirrored(tile: CallTile): boolean {
  return useVoiceStore(
    (s) =>
      tile.kind === "person" &&
      s.call?.selfId === tile.participantId &&
      s.call.local.camera !== null &&
      s.call.local.mirror,
  );
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

/** Whether `userId` is speaking in the call we are in (any of their sessions). */
export function useIsUserSpeaking(userId: string): boolean {
  return useVoiceStore((s) => {
    const call = s.call;
    if (!call) return false;
    return Object.values(call.participants).some(
      (p) => p.userId === userId && call.speaking[p.id] === true,
    );
  });
}
