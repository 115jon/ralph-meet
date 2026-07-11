import type { SharedSpatialAudioState } from "@/lib/voice/spatial-audio";
import { normalizeSpatialState } from "@/lib/voice/spatial-audio";
import { useEffect } from "react";

interface SpatialAudioSyncProps {
  joined: boolean;
  spatialAudioEnabled: boolean;
  streamHighFidelity: boolean;
  spatialAudioState: SharedSpatialAudioState;
  dispatch: (action: {
    type: "SET_SPATIAL_AUDIO_STATE";
    payload: SharedSpatialAudioState;
  }) => void;
  sendVoiceStateUpdate: (data: {
    spatial_audio_enabled: boolean;
    spatial_audio_high_fidelity: boolean;
    spatial_audio_state: SharedSpatialAudioState;
  }) => void;
}

export function useSpatialAudioSync({
  joined,
  spatialAudioEnabled,
  streamHighFidelity,
  spatialAudioState,
  dispatch,
  sendVoiceStateUpdate,
}: SpatialAudioSyncProps) {
  useEffect(() => {
    if (!joined) return;

    const nextSpatialAudioState = normalizeSpatialState({
      ...spatialAudioState,
      enabled: spatialAudioEnabled,
      updatedAt: Date.now(),
    });
    dispatch({
      type: "SET_SPATIAL_AUDIO_STATE",
      payload: nextSpatialAudioState,
    });
    sendVoiceStateUpdate({
      spatial_audio_enabled: spatialAudioEnabled,
      spatial_audio_high_fidelity: streamHighFidelity,
      spatial_audio_state: nextSpatialAudioState,
    });
    // spatialAudioState is intentionally omitted: this effect writes a fresh
    // timestamp into that state, so depending on it would create an update loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    joined,
    spatialAudioEnabled,
    streamHighFidelity,
    dispatch,
    sendVoiceStateUpdate,
  ]);
}
