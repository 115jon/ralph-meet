import { useEffect, useRef, useState } from "react";
import { clog } from "@/lib/console-logger";
import type { VoiceChannelMember } from "@/lib/chat-reducer";
import {
  createLocalMediaOwner,
  releaseLocalStream,
  type LocalMediaOwner,
} from "@/lib/local-media-manager";
import { SFUClient } from "@/lib/sfu-client";
import type { User } from "@/lib/types";
import {
  createPublicationLiveness,
  type PublicationLiveness,
} from "@/lib/voice/publication-liveness";
import {
  createSilentAudioTrack,
  type SilentAudioTrack,
} from "@/lib/voice/standby-audio";

const standbyLog = clog("VoiceStandby");
const MAX_STANDBY_CHANNELS = 2;

export interface VoiceStandbyProfile {
  channelId: string;
  serverId: string;
  roomSlug: string;
  userId: string;
  name: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string;
  avatarDisplay?: import("@/lib/avatar-display").AvatarDisplay | string | null;
}

export interface VoiceStandbySession {
  readonly sfu: SFUClient;
  /** Owns the microphone the join opens; standby itself never opens it. */
  readonly mediaOwner: LocalMediaOwner;
  silence: SilentAudioTrack | null;
}

interface StandbyRecord extends VoiceStandbySession {
  readonly key: string;
  holds: number;
  claimed: boolean;
  disposed: boolean;
  audible: boolean;
  /** Whether the paused silence's SFU track is still alive. */
  readonly liveness: PublicationLiveness;
}

const sessions = new Map<string, StandbyRecord>();
const liveClaims = new Map<string, StandbyRecord>();
const joining = new Set<string>();

/**
 * `localStorage["ralph:voice-standby"] = "off"` turns standby off for this
 * browser: a troubleshooting switch, and how `pnpm bench:voice` measures a
 * cold join into an occupied channel.
 */
export const VOICE_STANDBY_STORAGE_KEY = "ralph:voice-standby";

export function isVoiceStandbyDisabled(): boolean {
  try {
    return (
      globalThis.localStorage?.getItem(VOICE_STANDBY_STORAGE_KEY) === "off"
    );
  } catch {
    return false;
  }
}

function sessionKey(channelId: string, serverId: string): string {
  return `${serverId}:${channelId}`;
}

function stopStandbyCapture(record: StandbyRecord): void {
  releaseLocalStream(record.mediaOwner);
  record.silence?.stop();
  record.silence = null;
}

function dispose(record: StandbyRecord): void {
  if (record.disposed) return;
  record.disposed = true;
  sessions.delete(record.key);
  liveClaims.delete(record.key);
  record.sfu.disconnect("component-unmount");
  if (!record.claimed) stopStandbyCapture(record);
}

function createRecord(profile: VoiceStandbyProfile): StandbyRecord {
  let silence: SilentAudioTrack | null = null;
  try {
    silence = createSilentAudioTrack();
  } catch (error) {
    standbyLog.warn("Standby audio unavailable", error);
  }
  return {
    key: sessionKey(profile.channelId, profile.serverId),
    sfu: new SFUClient(profile.roomSlug),
    mediaOwner: createLocalMediaOwner(),
    silence,
    holds: 0,
    claimed: false,
    disposed: false,
    audible: false,
    liveness: createPublicationLiveness(),
  };
}

/**
 * Warms a standby session without touching the microphone: the room socket
 * connects hidden (`standby: true`), the SFU session is created, ICE/DTLS
 * come up and a silent track is pushed, so a join only has to swap the
 * microphone in. The voice socket stays unidentified (see
 * `SFUClient.connectVoice`), so the room is never offered this session's
 * track and this session pulls nobody's audio before the user joins. The
 * microphone is first opened by the join itself.
 */
async function warm(
  record: StandbyRecord,
  profile: VoiceStandbyProfile,
): Promise<void> {
  record.sfu.connect(
    profile.name,
    profile.avatarUrl,
    profile.userId,
    profile.username,
    profile.displayName,
    profile.avatarDisplay,
    {
      channelId: profile.channelId,
      serverId: profile.serverId,
      standby: true,
    },
  );
  if (!record.silence) return;
  const published = await record.sfu
    .publishTracksIf(record.silence.stream, "cam", () => !record.disposed)
    .catch((error) => {
      standbyLog.warn("Standby publish failed", error);
      return false;
    });
  if (!published || record.disposed) {
    if (!record.claimed) {
      record.silence?.stop();
      record.silence = null;
    }
    return;
  }
  // Negotiated: idle until a join claims it (no audio thread, no RTP). The
  // SFU drops a track without media after 30 s; a later claim republishes.
  if (!record.claimed && record.silence) {
    record.silence.pause();
    record.liveness.markIdle();
  }
}

export function holdVoiceStandby(profile: VoiceStandbyProfile): {
  session: VoiceStandbySession | null;
  release: () => void;
} {
  const key = sessionKey(profile.channelId, profile.serverId);
  if (joining.has(key) || isVoiceStandbyDisabled()) {
    return { session: null, release: () => undefined };
  }
  const claimed = liveClaims.get(key);
  if (claimed && !claimed.disposed) {
    return { session: claimed, release: () => undefined };
  }

  let record = sessions.get(key);
  if (!record || record.disposed) {
    record = createRecord(profile);
    sessions.set(key, record);
    void warm(record, profile);
  }
  record.holds += 1;
  let released = false;
  const held = record;
  return {
    session: held,
    release: () => {
      if (released) return;
      released = true;
      held.holds -= 1;
      if (held.holds <= 0 && !held.claimed) dispose(held);
    },
  };
}

export function markVoiceChannelJoining(
  channelId: string,
  serverId: string,
): void {
  joining.add(sessionKey(channelId, serverId));
}

export function claimVoiceStandby(
  channelId: string,
  serverId: string,
  audible: boolean,
): VoiceStandbySession | null {
  const key = sessionKey(channelId, serverId);
  const record = sessions.get(key);
  if (!record || record.disposed) return null;
  joining.add(key);
  record.claimed = true;
  // Silence flows again at once, so the SFU has packets for this track by
  // the time the room is told about it and others pull it.
  record.silence?.resume();
  republishIfStale(record);
  sessions.delete(key);
  liveClaims.set(key, record);
  applyClaimedAudible(record, audible);
  return record;
}

export function setClaimedVoiceAudible(
  channelId: string,
  serverId: string,
  audible: boolean,
): boolean {
  const record = liveClaims.get(sessionKey(channelId, serverId));
  if (!record || record.disposed) return false;
  applyClaimedAudible(record, audible);
  return true;
}

/**
 * A standby idle for longer than the SFU keeps a track without media has
 * lost its publication: resuming the silence (and swapping the microphone
 * in) would feed a track nobody can pull. Push it again before the room is
 * told about it; the join's microphone then replaces the silence on the new
 * publication as usual.
 */
function republishIfStale(record: StandbyRecord): void {
  const idleMs = record.liveness.idleMs();
  const stale = record.liveness.isStale();
  record.liveness.markFlowing();
  if (!stale) return;
  const trackName = record.sfu.getMicrophoneTrackName();
  const republished = !!trackName && record.sfu.republishTrack(trackName);
  standbyLog.info("Republished idle standby track", {
    idleMs: Math.round(idleMs),
    republished,
  });
}

/**
 * Mute state for a claimed session. While the standby silence is still the
 * published microphone there is nothing to gate (the join's capture replaces
 * it, see useVoiceChannel); once a real microphone is published, muting
 * disables its sender.
 */
function applyClaimedAudible(record: StandbyRecord, audible: boolean): void {
  record.audible = audible;
  const trackName = record.sfu.getMicrophoneTrackName();
  if (!trackName) return;
  const published = record.sfu.getPublishedTrack(trackName);
  if (!published || published === record.silence?.track) return;
  record.sfu.setPublishedTrackEnabled(trackName, audible);
}

export function retireVoiceStandby(channelId: string, serverId: string): void {
  const key = sessionKey(channelId, serverId);
  joining.delete(key);
  const claimed = liveClaims.get(key);
  liveClaims.delete(key);
  if (!claimed) return;
  claimed.disposed = true;
  claimed.audible = false;
  stopStandbyCapture(claimed);
}

export function dropVoiceStandby(channelId: string, serverId: string): void {
  const key = sessionKey(channelId, serverId);
  retireVoiceStandby(channelId, serverId);
  const warming = sessions.get(key);
  if (warming) dispose(warming);
}

export function resetVoiceStandbyForTests(): void {
  for (const record of sessions.values()) dispose(record);
  for (const record of liveClaims.values()) {
    record.disposed = true;
    stopStandbyCapture(record);
  }
  sessions.clear();
  liveClaims.clear();
  joining.clear();
}

function isOccupiedBySomeoneElse(
  members: readonly { clerk_user_id?: string; connected?: boolean }[],
  userId: string,
): boolean {
  return members.some(
    (member) => member.clerk_user_id !== userId && member.connected !== false,
  );
}

/** How long a hidden tab keeps its standby sessions before dropping them. */
export const STANDBY_HIDDEN_GRACE_MS = 15_000;

function isPageActive(): boolean {
  if (typeof document === "undefined") return false;
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  return document.visibilityState !== "hidden" && online;
}

/**
 * Whether standby sessions should exist right now: the tab is visible and
 * online. A hidden tab keeps them for {@link STANDBY_HIDDEN_GRACE_MS} (so an
 * alt-tab does not churn sessions); going offline drops them at once. Event
 * driven, no timers while visible.
 */
export function useVoiceStandbyActive(): boolean {
  const [active, setActive] = useState(isPageActive);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (isPageActive()) {
        setActive(true);
      } else if (typeof navigator !== "undefined" && !navigator.onLine) {
        setActive(false);
      } else {
        timer = setTimeout(() => {
          timer = null;
          setActive(isPageActive());
        }, STANDBY_HIDDEN_GRACE_MS);
      }
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return active;
}

export function useOccupiedVoiceStandby(input: {
  serverId: string | null;
  joinedChannelId: string | null;
  activeChannelId: string | null;
  channels: readonly {
    id: string;
    server_id?: string;
    channel_type: string;
  }[];
  voiceChannelStates: Record<
    string,
    | readonly Pick<VoiceChannelMember, "clerk_user_id" | "connected">[]
    | undefined
  >;
  user: User | null | undefined;
}): void {
  const userId = input.user?.id ?? "";
  const occupiedIds: string[] = [];
  if (input.serverId && input.serverId !== "@me" && userId) {
    for (const channel of input.channels) {
      if (
        channel.server_id !== input.serverId ||
        channel.channel_type !== "voice" ||
        channel.id === input.joinedChannelId
      ) {
        continue;
      }
      const members = input.voiceChannelStates[channel.id] ?? [];
      if (isOccupiedBySomeoneElse(members, userId)) {
        occupiedIds.push(channel.id);
      }
    }
    occupiedIds.sort((left, right) => {
      if (left === input.activeChannelId) return -1;
      if (right === input.activeChannelId) return 1;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  const standbyIds = occupiedIds.slice(0, MAX_STANDBY_CHANNELS);
  const standbyKey = [...standbyIds].sort().join(",");
  const latestRef = useRef({ input, standbyIds });
  const holdsRef = useRef(new Map<string, () => void>());
  const active = useVoiceStandbyActive();
  const targetKey = `${active ? "on" : "off"}|${input.serverId ?? ""}|${userId}|${input.joinedChannelId ?? ""}|${standbyKey}`;

  useEffect(() => {
    latestRef.current = { input, standbyIds };
  }, [input, standbyIds]);

  useEffect(() => {
    const holds = holdsRef.current;
    const current = latestRef.current.input;
    const profile = current.user;
    const desired = new Set(latestRef.current.standbyIds);
    const releaseMissing = () => {
      for (const [channelId, release] of holds) {
        if (desired.has(channelId)) continue;
        release();
        holds.delete(channelId);
      }
    };
    if (
      !active ||
      !current.serverId ||
      current.serverId === "@me" ||
      !profile?.id
    ) {
      desired.clear();
      releaseMissing();
      return;
    }
    releaseMissing();
    for (const channelId of desired) {
      if (holds.has(channelId)) continue;
      const held = holdVoiceStandby({
        channelId,
        serverId: current.serverId,
        roomSlug: `voice-${current.serverId}-${channelId}`,
        userId: profile.id,
        name: profile.display_name?.trim() || profile.username || "Guest",
        username: profile.username,
        displayName: profile.display_name?.trim() || null,
        avatarUrl: profile.avatar_url ?? undefined,
        avatarDisplay: profile.avatar_display,
      });
      if (!held.session) continue;
      holds.set(channelId, held.release);
    }
  }, [targetKey, active]);

  useEffect(() => {
    const holds = holdsRef.current;
    return () => {
      for (const release of holds.values()) release();
      holds.clear();
    };
  }, []);
}
