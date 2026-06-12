import { getGifAttachmentProvider } from "@/lib/gif-picker";

export function shouldShowGifProviderBranding(fileKeyOrUrl: string | null | undefined): boolean {
  return getGifAttachmentProvider(fileKeyOrUrl) === "klipy";
}
