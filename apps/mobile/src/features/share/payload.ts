import type { PickedFile, PickedKind } from "@/features/chat/attach/types";

/** What another app shared, ready for the composer: files for the attach chips, text for the field. */
export interface SharePayload {
  readonly files: readonly PickedFile[];
  readonly text: string | null;
}

/** expo-share-intent's file, as its useShareIntent hands it over. */
export interface SharedFile {
  readonly path: string;
  readonly mimeType: string | null;
  readonly fileName: string | null;
  readonly size: number | null;
  /** Milliseconds, for videos. */
  readonly duration: number | null;
}

export interface SharedContent {
  readonly files: readonly SharedFile[] | null;
  readonly text?: string | null;
}

function kindOf(type: string): PickedKind {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  return "file";
}

/**
 * A share intent as composer input: files keyed by their copied path (the
 * attach pipeline dedupes on the key), and the text trimmed. Null when there
 * is nothing to send.
 */
export function payloadOf(shared: SharedContent): SharePayload | null {
  const files = (shared.files ?? []).map((file, index): PickedFile => {
    const type = file.mimeType || "application/octet-stream";
    const name =
      file.fileName || file.path.split("/").pop() || `shared-${index + 1}`;
    return {
      key: `share:${file.path}`,
      uri: file.path,
      name,
      type,
      size: file.size,
      kind: kindOf(type),
      duration: file.duration ? file.duration / 1000 : null,
    };
  });
  const text = shared.text?.trim() || null;
  if (files.length === 0 && !text) return null;
  return { files, text };
}

/** "2 photos", "A video and text", for the picker's preview line. */
export function describePayload(payload: SharePayload): string {
  const images = payload.files.filter((f) => f.kind === "image").length;
  const videos = payload.files.filter((f) => f.kind === "video").length;
  const others = payload.files.length - images - videos;
  const parts = [
    images ? (images === 1 ? "a photo" : `${images} photos`) : null,
    videos ? (videos === 1 ? "a video" : `${videos} videos`) : null,
    others ? (others === 1 ? "a file" : `${others} files`) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "Text";
  const files = parts.join(", ");
  const line = payload.text ? `${files} and text` : files;
  return line.charAt(0).toUpperCase() + line.slice(1);
}
