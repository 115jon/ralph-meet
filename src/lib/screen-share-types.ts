export type ScreenShareSourceKind = "window" | "monitor" | "device";

export interface ScreenShareOptions {
  quality?: string;
  withAudio?: boolean;
  changeSource?: boolean;
  sourceId?: string;
  sourceName?: string;
  sourceKind?: ScreenShareSourceKind;
}

export interface StartScreenShareOptions extends ScreenShareOptions {
  quality: string;
  withAudio: boolean;
}
