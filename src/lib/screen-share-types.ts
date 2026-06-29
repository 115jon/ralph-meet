export type ScreenShareSourceKind = "window" | "monitor" | "device";

export interface ScreenShareOptions {
  quality?: string;
  withAudio?: boolean;
  changeSource?: boolean;
  sourceId?: string;
  captureId?: string;
  sourceName?: string;
  sourceKind?: ScreenShareSourceKind;
  sourceAppName?: string;
  sourceIcon?: string;
  pickerOpenedAt?: number;
  pickerSelectionElapsedMs?: number;
}

export interface ScreenShareSourceState {
  sourceId?: string | null;
  captureId?: string | null;
  sourceName?: string | null;
  sourceKind?: ScreenShareSourceKind | null;
  sourceAppName?: string | null;
  sourceIcon?: string | null;
}

export interface StartScreenShareOptions extends ScreenShareOptions {
  quality: string;
  withAudio: boolean;
}
