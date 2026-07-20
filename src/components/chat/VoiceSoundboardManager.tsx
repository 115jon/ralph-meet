import type { SFUClient } from "@/lib/sfu-client";
import {
  getSoundboardServerKey,
  getSoundboardEventReceivedAt,
  pauseSoundboardPlayback,
  playSoundboardPlayback,
  resumeSoundboardPlayback,
  setSoundboardPlaybackVolume,
  stopAllSoundboardPlaybacksForServer,
  stopSoundboardPlayback,
  stopSoundboardPlaybacksByOwner,
} from "@/lib/voice/soundboard";
import { getSoundboardUploadUrl } from "@/lib/voice/soundboard-media";
import { getSoundboardMediaCapabilityExpiresAtFromUrl } from "@/lib/voice/soundboard-media-capability";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { useEffect } from "react";

interface VoiceSoundboardManagerProps {
  sfu: SFUClient | null;
  serverId?: string | null;
  localUserId?: string | null;
}

export function VoiceSoundboardManager({
  sfu,
  serverId,
  localUserId,
}: VoiceSoundboardManagerProps) {
  const serverKey = getSoundboardServerKey(serverId);
  const setServerSoundboardMuted = useVoiceSoundboardStore(
    (s) => s.setServerSoundboardMuted,
  );

  // `sfu.on(...)` returns the unsubscribe function from EventEmitter.on.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!sfu) return;

    return sfu.on("app-event", (event) => {
      if (event.server_key !== serverKey || typeof event.type !== "string")
        return;
      const receivedAt = getSoundboardEventReceivedAt(event.sent_at);
      const peerSettings = useVoiceSettingsStore
        .getState()
        .getSettings(localUserId).peerSettings;
      const serverMutedMap =
        useVoiceSoundboardStore.getState().serverMutedByServer[serverKey] ?? {};

      if (event.type === "soundboard.play") {
        const ownerId =
          typeof event.user_id === "string"
            ? event.user_id
            : typeof event.participant_id === "string"
              ? event.participant_id
              : null;
        const playbackId =
          typeof event.playback_id === "string" ? event.playback_id : null;
        const name = typeof event.name === "string" ? event.name : "Sound";
        if (!ownerId || !playbackId) return;

        const soundId =
          typeof event.sound_id === "string" ? event.sound_id : undefined;
        const sourceServerId =
          typeof event.source_server_id === "string"
            ? event.source_server_id
            : undefined;
        const mediaUrl =
          typeof event.media_url === "string" ? event.media_url : undefined;
        const mediaCapabilityExpiresAt =
          getSoundboardMediaCapabilityExpiresAtFromUrl(mediaUrl);
        const currentTime =
          typeof event.current_time === "number" &&
          Number.isFinite(event.current_time) &&
          event.current_time >= 0
            ? event.current_time
            : undefined;
        const paused =
          typeof event.paused === "boolean" ? event.paused : undefined;
        const renewCapability =
          ownerId === localUserId &&
          !!soundId &&
          !!sourceServerId &&
          mediaCapabilityExpiresAt !== null
            ? (state: { currentTime: number; paused: boolean }) =>
                sfu.voiceGW.sendAppEvent({
                  type: "soundboard.play",
                  server_key: serverKey,
                  playback_id: playbackId,
                  sound_id: soundId,
                  source_server_id: sourceServerId,
                  name,
                  media_url: getSoundboardUploadUrl(soundId),
                  current_time: state.currentTime,
                  paused: state.paused,
                  volume:
                    typeof event.volume === "number" ? event.volume : undefined,
                })
            : undefined;

        if (
          ownerId !== localUserId &&
          (peerSettings[ownerId]?.soundboardMuted || serverMutedMap[ownerId])
        ) {
          return;
        }

        playSoundboardPlayback({
          playbackId,
          ownerId,
          serverKey,
          name,
          soundId,
          dataUrl:
            typeof event.data_url === "string" ? event.data_url : undefined,
          mediaUrl,
          volume: typeof event.volume === "number" ? event.volume : undefined,
          isLocal: ownerId === localUserId,
          receivedAt,
          mediaCapabilityExpiresAt: mediaCapabilityExpiresAt ?? undefined,
          currentTime,
          paused,
          renewCapability,
        });
        return;
      }

      if (event.type === "soundboard.stop") {
        if (typeof event.playback_id === "string") {
          stopSoundboardPlayback(event.playback_id);
          return;
        }

        const ownerId =
          typeof event.user_id === "string"
            ? event.user_id
            : typeof event.participant_id === "string"
              ? event.participant_id
              : null;
        if (ownerId) stopSoundboardPlaybacksByOwner(ownerId, serverKey);
        return;
      }

      if (event.type === "soundboard.pause-set") {
        if (
          typeof event.playback_id !== "string" ||
          typeof event.paused !== "boolean"
        )
          return;
        if (event.paused) pauseSoundboardPlayback(event.playback_id);
        else resumeSoundboardPlayback(event.playback_id);
        return;
      }

      if (event.type === "soundboard.volume-set") {
        if (
          typeof event.playback_id !== "string" ||
          typeof event.volume !== "number"
        )
          return;
        setSoundboardPlaybackVolume(event.playback_id, event.volume);
        return;
      }

      if (event.type === "soundboard.server-mute-set") {
        const targetUserId =
          typeof event.target_user_id === "string"
            ? event.target_user_id
            : null;
        if (!targetUserId || typeof event.muted !== "boolean") return;
        setServerSoundboardMuted(serverKey, targetUserId, event.muted);
        if (event.muted)
          stopSoundboardPlaybacksByOwner(targetUserId, serverKey);
      }
    });
  }, [localUserId, serverKey, setServerSoundboardMuted, sfu]);

  useEffect(
    () => () => {
      stopAllSoundboardPlaybacksForServer(serverKey);
    },
    [serverKey],
  );

  return null;
}
