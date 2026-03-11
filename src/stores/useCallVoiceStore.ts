// ============================================================================
// Call Voice Store — lightweight Zustand store for call SFU state
//
// Populated by CallVoiceManager when a call is active.
// Consumed by DMCallRegion for controls and UserPanel/CallDashboardSection
// for the VoiceDashboard.
// ============================================================================

import type { SFUClient } from "@/lib/sfu-client";
import type { GridItem } from "@/components/voice/types";
import { create } from "zustand";

export interface CallVoiceState {
  /** SFU client instance (set by CallVoiceManager, null when no call) */
  sfu: SFUClient | null;
  /** Whether SFU has joined the voice room */
  joined: boolean;
  /** WebRTC connection state */
  connectionState: string;
  /** Camera is streaming */
  isCameraActive: boolean;
  /** Screen share is active */
  isScreenSharing: boolean;
  /** Screen share includes audio */
  isStreamingAudio: boolean;
  /** Current screen quality */
  screenQuality: string;
  /** Has a camera device */
  hasCamera: boolean;
  /** Has a microphone device */
  hasMicrophone: boolean;
  /** Audio context is blocked */
  audioBlocked: boolean;
  /** Voice grid items (participants with media streams) */
  gridItems: GridItem[];
  /** Whether the local mic is on (not muted) */
  isMicOn: boolean;
  /** Whether the local user is deafened */
  isDeafened: boolean;

  // ── Callbacks (set by CallVoiceManager) ──────────────────────────────
  handleLeave: (() => void) | null;
  toggleMic: (() => void) | null;
  toggleDeafen: (() => void) | null;
  toggleCamera: (() => Promise<void>) | null;
  toggleScreenShare: ((options?: { quality?: string; withAudio?: boolean; changeSource?: boolean }) => void) | null;
  onToggleStreamAudio: (() => void) | null;

  // ── Setters ──────────────────────────────────────────────────────────
  update: (partial: Partial<CallVoiceState>) => void;
  reset: () => void;
}

const initialState = {
  sfu: null as SFUClient | null,
  joined: false,
  connectionState: "new",
  isCameraActive: false,
  isScreenSharing: false,
  isStreamingAudio: false,
  screenQuality: "720p30",
  hasCamera: false,
  hasMicrophone: false,
  audioBlocked: false,
  gridItems: [] as GridItem[],
  isMicOn: true,
  isDeafened: false,
  handleLeave: null as (() => void) | null,
  toggleMic: null as (() => void) | null,
  toggleDeafen: null as (() => void) | null,
  toggleCamera: null as (() => Promise<void>) | null,
  toggleScreenShare: null as ((options?: any) => void) | null,
  onToggleStreamAudio: null as (() => void) | null,
};

export const useCallVoiceStore = create<CallVoiceState>()((set) => ({
  ...initialState,
  update: (partial) => set(partial),
  reset: () => set(initialState),
}));
