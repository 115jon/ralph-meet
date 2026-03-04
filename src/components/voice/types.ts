export interface GridItem {
  id: string;
  userId: string;
  name: string;
  avatar?: string | null;
  stream: MediaStream | null;
  isLocal: boolean;
  type: 'camera' | 'screen' | 'avatar';
  isStreaming: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  serverMute?: boolean;
  selfMute?: boolean;
}

/** Bag of voice action callbacks to pass through component hierarchy */
export interface VoiceActions {
  onToggleScreenShare?: (options?: { quality: string; withAudio: boolean; changeSource?: boolean }) => void;
  isCurrentUserStreaming?: boolean;
  currentScreenQuality?: string;
  availableQualities?: string[];
  isStreamingAudio?: boolean;
  onToggleStreamAudio?: () => void;
  onLeave?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  isDeafened?: boolean;
  onToggleDeafen?: () => void;
  watchedStreams?: Record<string, boolean>;
  onToggleWatch?: (userId: string) => void;
  onChangeSource?: () => void;
  sfu?: any; // SFUClient
}
