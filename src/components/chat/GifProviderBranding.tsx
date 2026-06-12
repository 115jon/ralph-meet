import klipyTextLightUrl from "@/assets/klipy-text-light.svg";
import { shouldShowGifProviderBranding } from "@/lib/gif-provider-branding";
import { cn } from "@/lib/utils";

export function GifProviderBranding({
  fileKeyOrUrl,
  className,
}: {
  fileKeyOrUrl: string | null | undefined;
  className?: string;
}) {
  if (!shouldShowGifProviderBranding(fileKeyOrUrl)) return null;

  return (
    <div className={cn("pointer-events-none absolute bottom-2 left-2 z-10 rounded-md bg-black/35 px-1.5 py-1 backdrop-blur-[1px]", className)}>
      <img src={klipyTextLightUrl} alt="KLIPY" className="h-3.5 w-auto opacity-90" />
    </div>
  );
}
