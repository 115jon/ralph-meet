import type * as DocumentPickerModule from "expo-document-picker";
import type * as ImagePickerModule from "expo-image-picker";
import type * as MediaLibraryModule from "expo-media-library";

import { hasNativeModule } from "@/lib/native";

import type { PickedFile, PickedKind } from "./types";

// Each source is optional: a dev client built before its module was added
// steps around it instead of crashing the bundle at import.
const ImagePicker: typeof ImagePickerModule | null = hasNativeModule(
  "ExponentImagePicker",
)
  ? (require("expo-image-picker") as typeof ImagePickerModule)
  : null;

const DocumentPicker: typeof DocumentPickerModule | null = hasNativeModule(
  "ExpoDocumentPicker",
)
  ? (require("expo-document-picker") as typeof DocumentPickerModule)
  : null;

export const MediaLibrary: typeof MediaLibraryModule | null = hasNativeModule(
  "ExpoMediaLibraryNext",
)
  ? (require("expo-media-library") as typeof MediaLibraryModule)
  : null;

export const canCapture = ImagePicker !== null;
export const canPickPhotos = ImagePicker !== null;
export const canPickFiles = DocumentPicker !== null;
export const canAttach = canPickPhotos || canPickFiles || MediaLibrary !== null;

const MIME_BY_EXTENSION = new Map(
  Object.entries({
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    avif: "image/avif",
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    "3gp": "video/3gpp",
  }),
);

const FALLBACK_MIME: Readonly<Record<PickedKind, string>> = {
  image: "image/jpeg",
  video: "video/mp4",
  file: "application/octet-stream",
};

/** A gallery asset's MIME type from its file name, else by media type. */
export function mimeFor(name: string, kind: PickedKind): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION.get(extension) ?? FALLBACK_MIME[kind];
}

function kindOf(type: string): PickedKind {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  return "file";
}

function fromPickerAsset(
  asset: ImagePickerModule.ImagePickerAsset,
  index: number,
): PickedFile {
  const video = asset.type === "video";
  const fallback = `${video ? "video" : "image"}-${Date.now()}-${index}.${video ? "mp4" : "jpg"}`;
  const name = asset.fileName ?? fallback;
  const type = asset.mimeType ?? mimeFor(name, video ? "video" : "image");
  return {
    key: `${asset.uri}#${Date.now()}`,
    uri: asset.uri,
    name,
    type,
    size: asset.fileSize ?? null,
    kind: kindOf(type),
    // The picker reports milliseconds.
    duration: asset.duration ? asset.duration / 1000 : null,
  };
}

/** Takes one photo or video with the system camera app. */
export async function capture(): Promise<PickedFile[] | "denied"> {
  if (!ImagePicker) return [];
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return "denied";
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images", "videos"],
  });
  return result.canceled ? [] : result.assets.map(fromPickerAsset);
}

/** The full system photo picker, for albums and older items. */
export async function pickPhotos(limit: number): Promise<PickedFile[]> {
  if (!ImagePicker || limit <= 0) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: limit,
  });
  return result.canceled ? [] : result.assets.map(fromPickerAsset);
}

/** The system document picker: any type, several at once. */
export async function pickFiles(): Promise<PickedFile[]> {
  if (!DocumentPicker) return [];
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => {
    const type = asset.mimeType ?? "application/octet-stream";
    return {
      key: `${asset.uri}#${Date.now()}`,
      uri: asset.uri,
      name: asset.name,
      type,
      size: asset.size ?? null,
      kind: kindOf(type),
      duration: null,
    };
  });
}
