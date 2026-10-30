import { useEffect, useRef } from "react";
import { clog } from "@/lib/console-logger";
import type { VoiceChannelMember } from "@/lib/chat-reducer";
import {
  createLocalMediaOwner,
  releaseLocalStream,
  startEarlyMic,
  type LocalAudioConstraints,
  type LocalMediaOwner,
} from "@/lib/local-media-manager";
import { SFUClient } from "@/lib/sfu-client";
import type { User } from "@/lib/types";
import {
  isNoiseReductionProviderSupported,
  resolveCaptureAudioProcessing,
} from "@/lib/voice/noise-reduction";
import {
  createSilentAudioTrack,
  type SilentAudioTrack,
} from "@/lib/voice/standby-audio";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

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
  readonly mediaOwner: LocalMediaOwner;
  silence: SilentAudioTrack | null;
  stream: MediaStream | null;
  track: MediaStreamTrack | null;
}

interface StandbyRecord extends VoiceStandbySession {
  readonly key: string;
  holds: number;
  claimed: boolean;
  disposed: boolean;
  audible: boolean;
}

const sessions = new Map<string, StandbyRecord>();
const liveClaims = new Map<string, StandbyRecord>();
const joining = new Set<string>();

function sessionKey(channelId: string, serverId: string): string {
  return `${serverId}:${channelId}`;
}

function captureConstraints(userId: string): LocalAudioConstraints {
  const settings = useVoiceSettingsStore.getState().getSettings(userId);
  const captureProcessing = resolveCaptureAudioProcessing({
    noiseSuppression: settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoSensitivity: settings.autoSensitivity,
    streamHighFidelity: settings.streamHighFidelity,
    noiseReductionEnabled:
      settings.noiseReductionEnabled &&
      isNoiseReductionProviderSupported(settings.noiseReductionProvider),
    noiseReductionProvider: settings.noiseReductionProvider,
  });
  return {
    deviceId: settings.inputDeviceId,
    deviceLabel: settings.inputDeviceLabel,
    groupId: settings.inputDeviceGroupId,
    noiseSuppression: captureProcessing.noiseSuppression,
    echoCancellation: captureProcessing.echoCancellation,
    autoGainControl: captureProcessing.autoGainControl,
    stereo: true,
  };
}

function stopStandbyCapture(record: StandbyRecord): void {
  releaseLocalStream(record.mediaOwner);
  record.stream?.getTracks().forEach((track) => track.stop());
  record.stream = null;
  record.track = null;
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
    stream: null,
    track: null,
    holds: 0,
    claimed: false,
    disposed: false,
    audible: false,
  };
}

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
  const micPromise = Promise.resolve()
    .then(() =>
      startEarlyMic(captureConstraints(profile.userId), record.mediaOwner),
    )
    .catch(() => null);

  if (record.silence) {
    const published = await record.sfu
      .publishTracksIf(record.silence.stream, "cam", () => !record.disposed)
      .catch((error) => {
        standbyLog.warn("Standby publish failed", error);
        return false;
      });
    if (!published || record.disposed) {
      record.silence?.stop();
      record.silence = null;
      const abandoned = await micPromise;
      abandoned?.getTracks().forEach((track) => track.stop());
      return;
    }
  }

  const stream = await micPromise;
  if (record.disposed) {
    stream?.getTracks().forEach((track) => track.stop());
    return;
  }
  const track = stream?.getAudioTracks()[0];
  if (!stream || !track) return;

  const trackName = record.sfu.getMicrophoneTrackName();
  const published = trackName ? record.sfu.getPublishedTrack(trackName) : null;
  if (
    record.claimed &&
    published &&
    published !== track &&
    published !== record.silence?.track
  ) {
    stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
    return;
  }

  track.enabled = record.audible;
  record.stream = stream;
  record.track = track;
  if (!record.audible) return;
  if (trackName && published) {
    const replaced = await record.sfu.replaceTrack(trackName, track);
    if (!replaced || record.disposed) {
      if (!record.claimed) {
        track.stop();
        record.stream = null;
        record.track = null;
      }
      return;
    }
  } else if (!published) {
    const publishedMic = await record.sfu
      .publishTracksIf(stream, "cam", () => !record.disposed)
      .catch((error) => {
        standbyLog.warn("Standby microphone publish failed", error);
        return false;
      });
    if (!publishedMic || record.disposed) {
      if (!record.claimed) {
        track.stop();
        record.stream = null;
        record.track = null;
      }
      return;
    }
  }
  track.enabled = record.audible;
  const publishedName = record.sfu.getMicrophoneTrackName();
  if (publishedName) {
    record.sfu.setPublishedTrackEnabled(publishedName, record.audible);
  }
  if (record.silence && record.silence.track !== track) {
    releaseSilenceAfterHandoff(record, record.silence, track);
  }
}

function releaseSilenceAfterHandoff(
  record: StandbyRecord,
  silence: SilentAudioTrack,
  microphone: MediaStreamTrack,
): void {
  const started = Date.now();
  const timer = setInterval(() => {
    if (record.silence !== silence) {
      clearInterval(timer);
      return;
    }
    if (record.disposed) {
      clearInterval(timer);
      return;
    }
    if (record.sfu.senderHasLiveTrack(microphone)) {
      clearInterval(timer);
      if (record.silence === silence) record.silence = null;
      silence.stop();
      return;
    }
    if (Date.now() - started > 15_000) clearInterval(timer);
  }, 50);
}

export function holdVoiceStandby(profile: VoiceStandbyProfile): {
  session: VoiceStandbySession | null;
  release: () => void;
} {
  const key = sessionKey(profile.channelId, profile.serverId);
  if (joining.has(key)) {
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

function applyClaimedAudible(record: StandbyRecord, audible: boolean): void {
  record.audible = audible;
  const microphone = record.track;
  const silence = record.silence;
  const trackName = record.sfu.getMicrophoneTrackName();
  const published = trackName ? record.sfu.getPublishedTrack(trackName) : null;
  standbyLog.info("Claimed mic audible", {
    audible,
    publishedSilence: !!silence && published === silence.track,
    hasMicrophoneTrack: !!microphone,
  });
  if (!audible) {
    if (silence && published === silence.track) {
      silence.track.enabled = true;
      if (microphone && microphone !== silence.track)
        microphone.enabled = false;
      return;
    }
    if (microphone && microphone !== published) microphone.enabled = false;
    if (trackName) record.sfu.setPublishedTrackEnabled(trackName, false);
    return;
  }
  const microphoneLive =
    !!microphone &&
    (microphone.readyState === undefined || microphone.readyState === "live");
  if (
    !microphone ||
    !microphoneLive ||
    !trackName ||
    microphone === silence?.track
  ) {
    standbyLog.warn("Unmute has no live microphone", {
      trackName,
      readyState: microphone?.readyState ?? null,
    });
    return;
  }
  microphone.enabled = true;
  if (published === microphone) {
    record.sfu.setPublishedTrackEnabled(trackName, true);
    return;
  }
  void record.sfu.replaceTrack(trackName, microphone).then((replaced) => {
    if (!replaced || !record.audible || record.silence !== silence) {
      standbyLog.warn("Unmute did not replace standby silence", {
        trackName,
        replaced,
      });
      return;
    }
    record.sfu.setPublishedTrackEnabled(trackName, true);
    if (silence) releaseSilenceAfterHandoff(record, silence, microphone);
  });
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
  const targetKey = `${input.serverId ?? ""}|${userId}|${input.joinedChannelId ?? ""}|${standbyKey}`;

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
    if (!current.serverId || current.serverId === "@me" || !profile?.id) {
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
  }, [targetKey]);

  useEffect(() => {
    const holds = holdsRef.current;
    return () => {
      for (const release of holds.values()) release();
      holds.clear();
    };
  }, []);
}
