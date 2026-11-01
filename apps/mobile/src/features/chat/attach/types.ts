import type { Attachment } from "../schema";

export type PickedKind = "image" | "video" | "file";

/** One file the user chose, from any source, before it is uploaded. */
export interface PickedFile {
  /** A recent-media tile's asset id, so the grid can find its selection. */
  readonly key: string;
  /** What the chip draws and the upload reads (a content:// or file:// uri). */
  readonly uri: string;
  readonly name: string;
  /** MIME type, sent as the form part's type. */
  readonly type: string;
  /** Bytes, when the source says; null for gallery assets. */
  readonly size: number | null;
  readonly kind: PickedKind;
  /** Seconds, for videos. */
  readonly duration: number | null;
}

export type UploadState =
  | { readonly phase: "waiting" }
  | { readonly phase: "uploading"; readonly progress: number }
  | { readonly phase: "done"; readonly attachment: Attachment }
  | { readonly phase: "failed"; readonly reason: string };

export interface DraftItem extends PickedFile {
  readonly upload: UploadState;
}

/** The one line of feedback above the chips: a limit hit or an upload refused. */
export interface Notice {
  readonly id: number;
  readonly text: string;
  /** Idle amber for a limit, danger red for a refused upload. */
  readonly led: "idle" | "danger";
}
