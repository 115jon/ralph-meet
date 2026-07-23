export interface PersistentVoiceViewIdentityInput {
  joined: boolean;
  activeServerId: string | null;
  activeChannelId: string | null;
  voiceServerId: string | null;
  voiceChannelId: string | null;
}

export function getPersistentVoiceViewIdentity({
  joined,
  activeServerId,
  activeChannelId,
  voiceServerId,
  voiceChannelId,
}: PersistentVoiceViewIdentityInput) {
  const serverId = joined ? voiceServerId : activeServerId;
  const channelId = joined ? voiceChannelId : activeChannelId;

  return {
    key: `persistent-voice-session-${serverId}-${channelId}`,
    serverId,
    channelId,
  };
}
