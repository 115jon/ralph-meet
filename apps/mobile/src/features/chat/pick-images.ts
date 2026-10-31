import type * as ImagePickerModule from "expo-image-picker";

import { hasNativeModule } from "@/lib/native";

import type { UploadFile } from "./api";

// expo-image-picker when the build links it; the attach key hides otherwise.
const ImagePicker: typeof ImagePickerModule | null = hasNativeModule(
  "ExponentImagePicker",
)
  ? (require("expo-image-picker") as typeof ImagePickerModule)
  : null;

export const canPickImages = ImagePicker !== null;

/** The web's per-message limit is set by the server; four keeps the tray tidy. */
const MAX_PICK = 4;

/** Opens the system photo picker (no permission prompt on Android 13+). */
export async function pickImages(): Promise<UploadFile[]> {
  if (!ImagePicker) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: MAX_PICK,
    quality: 0.9,
  });
  if (result.canceled) return [];
  return result.assets.map((asset, index) => ({
    uri: asset.uri,
    name: asset.fileName ?? `image-${Date.now()}-${index}.jpg`,
    type: asset.mimeType ?? "image/jpeg",
  }));
}
