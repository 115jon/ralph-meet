import type * as ClipboardModule from "expo-clipboard";

import { hasNativeModule } from "@/lib/native";
import { showToast } from "@/ui";

// expo-clipboard when the build links it; copy actions hide otherwise.
const Clipboard: typeof ClipboardModule | null = hasNativeModule(
  "ExpoClipboard",
)
  ? (require("expo-clipboard") as typeof ClipboardModule)
  : null;

export const canCopy = Clipboard !== null;

/** Copies `text` and confirms with a toast. */
export function copyText(text: string): void {
  if (!Clipboard) return;
  void Clipboard.setStringAsync(text).then(() =>
    showToast({ label: "Clipboard", text: "Copied", led: "talk" }),
  );
}
