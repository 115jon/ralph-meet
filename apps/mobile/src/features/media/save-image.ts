import { MediaLibrary } from "@/features/chat/attach/sources";
import { mediaSource } from "@/lib/api";
import { fileSystem } from "@/lib/file-system";
import { showToast } from "@/ui";

/** The build can save to the gallery (both modules linked). */
export const canSaveImages = MediaLibrary !== null && fileSystem !== null;

/** Downloads `url` (with the session's token for the API's own media) into the gallery. */
export async function saveImage(url: string, label: string): Promise<void> {
  if (!MediaLibrary || !fileSystem) return;
  try {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) {
      showToast({
        label,
        text: "Allow photo access in Settings to save pictures",
        led: "idle",
      });
      return;
    }
    const source = mediaSource(url);
    const file = await fileSystem.File.downloadFileAsync(
      source.uri,
      new fileSystem.Directory(fileSystem.Paths.cache),
      { headers: { ...source.headers }, idempotent: true },
    );
    await MediaLibrary.Asset.create(file.uri);
    try {
      file.delete();
    } catch {
      // The cache copy goes with the cache.
    }
    showToast({ label, text: "Saved to your gallery", led: "talk" });
  } catch {
    showToast({ label, text: "The picture was not saved", led: "danger" });
  }
}
