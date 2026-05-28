import type { SFUClient } from "@/lib/sfu-client";
import {
  getSoundboardServerKey,
  playSoundboardPlayback,
  stopAllSoundboardPlaybacksForServer,
  stopSoundboardPlayback,
  stopSoundboardPlaybacksByOwner,
} from "@/lib/voice/soundboard";
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
  const setServerSoundboardMuted = useVoiceSoundboardStore((s) => s.setServerSoundboardMuted);

  useEffect(() => {
    if (!sfu) return;

    return sfu.on("app-event", (event) => {
      if (event.server_key !== serverKey || typeof event.type !== "string") return;
      const peerSettings = useVoiceSettingsStore.getState().getSettings(localUserId).peerSettings;
      const serverMutedMap = useVoiceSoundboardStore.getState().serverMutedByServer[serverKey] ?? {};

      if (event.type === "soundboard.play") {
        const ownerId = typeof event.user_id === "string"
          ? event.user_id
          : typeof event.participant_id === "string"
            ? event.participant_id
            : null;
        const playbackId = typeof event.playback_id === "string" ? event.playback_id : null;
        const name = typeof event.name === "string" ? event.name : "Sound";
        if (!ownerId || !playbackId) return;

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
          soundId: typeof event.sound_id === "string" ? event.sound_id : undefined,
          dataUrl: typeof event.data_url === "string" ? event.data_url : undefined,
          isLocal: ownerId === localUserId,
        });
        return;
      }

      if (event.type === "soundboard.stop") {
        if (typeof event.playback_id === "string") {
          stopSoundboardPlayback(event.playback_id);
          return;
        }

        const ownerId = typeof event.user_id === "string"
          ? event.user_id
          : typeof event.participant_id === "string"
            ? event.participant_id
            : null;
        if (ownerId) stopSoundboardPlaybacksByOwner(ownerId, serverKey);
        return;
      }

      if (event.type === "soundboard.server-mute-set") {
        const targetUserId = typeof event.target_user_id === "string" ? event.target_user_id : null;
        if (!targetUserId || typeof event.muted !== "boolean") return;
        setServerSoundboardMuted(serverKey, targetUserId, event.muted);
        if (event.muted) stopSoundboardPlaybacksByOwner(targetUserId, serverKey);
      }
    });
  }, [localUserId, serverKey, setServerSoundboardMuted, sfu]);

  useEffect(() => () => {
    stopAllSoundboardPlaybacksForServer(serverKey);
  }, [serverKey]);

  return null;
}
