import type { SFUClient } from "@/lib/sfu-client";
import { VoiceListenTogetherManager } from "./VoiceListenTogetherManager";
import { VoiceSoundboardManager } from "./VoiceSoundboardManager";

interface VoiceMediaManagerProps {
  sfu: SFUClient | null;
  serverId?: string | null;
  channelId?: string | null;
  roomSlug?: string | null;
  voiceSessionId?: string | null;
  localUserId?: string | null;
}

export function VoiceMediaManager({
  sfu,
  serverId,
  channelId,
  roomSlug,
  voiceSessionId,
  localUserId,
}: VoiceMediaManagerProps) {
  return (
    <>
      <VoiceListenTogetherManager
        sfu={sfu}
        serverId={serverId}
        roomSlug={roomSlug}
        voiceSessionId={voiceSessionId}
        channelId={channelId}
      />
      <VoiceSoundboardManager
        sfu={sfu}
        serverId={serverId}
        localUserId={localUserId}
      />
    </>
  );
}
