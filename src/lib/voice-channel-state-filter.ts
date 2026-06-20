export interface VoiceChannelStateSnapshot<TMember, TSpatial = unknown> {
  voice_states: Record<string, TMember[]>;
  voice_started_at: Record<string, number>;
  spatial_audio_states?: Record<string, TSpatial>;
}

export function filterVoiceChannelStatesPayload<TMember, TSpatial = unknown>(
  payload: VoiceChannelStateSnapshot<TMember, TSpatial>,
  visibleChannelIds: Iterable<string>,
): VoiceChannelStateSnapshot<TMember, TSpatial> {
  const visibleIds = new Set(visibleChannelIds);
  const voice_states: Record<string, TMember[]> = {};
  const voice_started_at: Record<string, number> = {};
  const spatial_audio_states: Record<string, TSpatial> = {};

  for (const [channelId, members] of Object.entries(payload.voice_states)) {
    if (!visibleIds.has(channelId)) continue;
    voice_states[channelId] = members;

    const startedAt = payload.voice_started_at[channelId];
    if (startedAt) {
      voice_started_at[channelId] = startedAt;
    }

    const spatialState = payload.spatial_audio_states?.[channelId];
    if (spatialState) {
      spatial_audio_states[channelId] = spatialState;
    }
  }

  return {
    voice_states,
    voice_started_at,
    spatial_audio_states,
  };
}
