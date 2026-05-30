export type ScreenShareSourceKind = "window" | "monitor" | "device";

export interface ScreenShareOptions {
  quality?: string;
  withAudio?: boolean;
  changeSource?: boolean;
  sourceId?: string;
  captureId?: string;
  sourceName?: string;
  sourceKind?: ScreenShareSourceKind;
  pickerOpenedAt?: number;
  pickerSelectionElapsedMs?: number;
}

export interface ScreenShareSourceState {
  sourceId?: string | null;
  captureId?: string | null;
  sourceName?: string | null;
  sourceKind?: ScreenShareSourceKind | null;
}

export interface StartScreenShareOptions extends ScreenShareOptions {
  quality: string;
  withAudio: boolean;
}
