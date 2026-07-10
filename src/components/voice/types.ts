import type {
  ScreenShareOptions,
  ScreenShareSourceState,
} from "@/lib/screen-share-types";
import type { StreamWatchersByStreamer } from "@/lib/stream-watchers";
import type { AvatarDisplay } from "@/lib/avatar-display";

export interface GridItem {
  id: string;
  userId: string;
  name: string;
  avatar?: string | null;
  avatarDisplay?: AvatarDisplay | string | null;
  stream: MediaStream | null;
  isLocal: boolean;
  type: "camera" | "screen" | "avatar";
  isStreaming: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  serverMute?: boolean;
  selfMute?: boolean;
  isRinging?: boolean;
}

/** Bag of voice action callbacks to pass through component hierarchy */
export interface VoiceActions {
  onToggleScreenShare?: (options?: ScreenShareOptions) => void;
  isCurrentUserStreaming?: boolean;
  currentScreenQuality?: string;
  currentScreenSource?: ScreenShareSourceState;
  availableQualities?: string[];
  isStreamingAudio?: boolean;
  onToggleStreamAudio?: () => void;
  onLeave?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  isDeafened?: boolean;
  onToggleDeafen?: () => void;
  watchedStreams?: Record<string, boolean>;
  watchersByStreamer?: StreamWatchersByStreamer;
  onToggleWatch?: (userId: string) => void;
  onOpenProfileUser?: (userId: string) => void;
  onOpenMessageUser?: (userId: string) => void;
  onChangeSource?: () => void;
  togglePreviewHidden?: () => void;
  isPreviewHidden?: boolean;
  alwaysShowStreamPreview?: boolean;
  onToggleAlwaysShowStreamPreview?: () => void;
  sfu?: any; // SFUClient
  serverId?: string | null;
  localUserId?: string | null;
}
