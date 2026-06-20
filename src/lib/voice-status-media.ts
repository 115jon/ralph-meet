import type { VoiceChannelStatusMedia, VoiceChannelStatusMediaAsset } from "@/lib/types";

export const VOICE_STATUS_MEDIA_PREFIX = "voice-status-media";
export const EXTERNAL_VOICE_STATUS_MEDIA_FILE_KEY_PREFIX = "external-url:";
export const MAX_VOICE_STATUS_MEDIA_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_VOICE_STATUS_MEDIA_RECENTS = 12;

export const ALLOWED_VOICE_STATUS_MEDIA_CONTENT_TYPES = new Set<VoiceChannelStatusMedia["preview_content_type"]>([
  "image/gif",
  "image/apng",
  "image/webp",
  "image/png",
  "image/jpeg",
  "video/mp4",
  "video/webm",
]);

const CONTENT_TYPE_BY_EXTENSION: Record<string, VoiceChannelStatusMedia["preview_content_type"]> = {
  gif: "image/gif",
  apng: "image/apng",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function getVoiceStatusMediaUploadContentType(file: File): VoiceChannelStatusMedia["preview_content_type"] | null {
  const declaredType = file.type?.toLowerCase();
  if (declaredType && ALLOWED_VOICE_STATUS_MEDIA_CONTENT_TYPES.has(declaredType as VoiceChannelStatusMedia["preview_content_type"])) {
    return declaredType as VoiceChannelStatusMedia["preview_content_type"];
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPE_BY_EXTENSION[ext] ?? null;
}

export function buildVoiceStatusMediaStorageKey(serverId: string, assetId: string, filename: string): string {
  return `${VOICE_STATUS_MEDIA_PREFIX}/${serverId}/${assetId}/${filename}`;
}

export function buildExternalVoiceStatusMediaFileKey(previewUrl: string): string {
  return `${EXTERNAL_VOICE_STATUS_MEDIA_FILE_KEY_PREFIX}${previewUrl}`;
}

export function buildVoiceStatusMediaUrl(assetId: string, filename: string): string {
  return `/api/voice-status-media/${assetId}/${encodeURIComponent(filename)}`;
}

function resolveVoiceStatusMediaPreviewUrl(assetId: string, filename: string, fileKey?: string | null): string {
  if (fileKey?.startsWith(EXTERNAL_VOICE_STATUS_MEDIA_FILE_KEY_PREFIX)) {
    return fileKey.slice(EXTERNAL_VOICE_STATUS_MEDIA_FILE_KEY_PREFIX.length);
  }

  return buildVoiceStatusMediaUrl(assetId, filename);
}

export function buildVoiceStatusMediaItem(input: {
  id: string;
  provider?: string;
  title?: string | null;
  alt_text?: string | null;
  preview_url: string;
  preview_width: number;
  preview_height: number;
  preview_content_type: VoiceChannelStatusMedia["preview_content_type"];
}): VoiceChannelStatusMedia {
  return {
    id: input.id,
    provider: input.provider ?? "server-upload",
    title: input.title ?? null,
    alt_text: input.alt_text ?? null,
    source_url: null,
    preview_url: input.preview_url,
    preview_width: Math.max(1, Math.round(input.preview_width)),
    preview_height: Math.max(1, Math.round(input.preview_height)),
    preview_content_type: input.preview_content_type,
  };
}

export function buildVoiceStatusMediaAsset(input: {
  id: string;
  server_id: string;
  channel_id: string;
  user_id: string;
  filename: string;
  file_key?: string | null;
  content_type: VoiceChannelStatusMedia["preview_content_type"];
  size_bytes: number;
  preview_width: number;
  preview_height: number;
  created_at: string;
}): VoiceChannelStatusMediaAsset {
  return {
    id: input.id,
    server_id: input.server_id,
    channel_id: input.channel_id,
    user_id: input.user_id,
    filename: input.filename,
    content_type: input.content_type,
    size_bytes: input.size_bytes,
    created_at: input.created_at,
    media: buildVoiceStatusMediaItem({
      id: input.id,
      provider: input.file_key?.startsWith(EXTERNAL_VOICE_STATUS_MEDIA_FILE_KEY_PREFIX) ? "external" : "server-upload",
      title: null,
      alt_text: null,
      preview_url: resolveVoiceStatusMediaPreviewUrl(input.id, input.filename, input.file_key),
      preview_width: input.preview_width,
      preview_height: input.preview_height,
      preview_content_type: input.content_type,
    }),
  };
}
