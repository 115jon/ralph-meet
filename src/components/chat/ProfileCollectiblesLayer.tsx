import {
  getProfileEffect,
  getProfileFrame,
  type AvatarDisplay,
} from "@/lib/avatar-display";
import { cn } from "@/lib/utils";

interface ProfileCollectiblesLayerProps {
  display?: AvatarDisplay | string | null;
  className?: string;
}

function getEffectPreview(display?: AvatarDisplay | string | null) {
  const effect = getProfileEffect(display);
  if (!effect) return null;
  return effect.previewUrl ?? effect.staticUrl ?? effect.animatedUrl ?? effect.effectUrls[0] ?? null;
}

export function ProfileCollectiblesLayer({ display, className }: ProfileCollectiblesLayerProps) {
  const effectPreview = getEffectPreview(display);
  const frame = getProfileFrame(display);

  if (!effectPreview && !frame) return null;

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      {effectPreview && (
        <img
          src={effectPreview}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-45 mix-blend-screen"
          loading="lazy"
          decoding="async"
        />
      )}
      {frame?.layers.map((layer) => (
        <img
          key={layer.id}
          src={layer.src}
          alt=""
          className={cn(
            "absolute left-1/2 z-20 max-w-none -translate-x-1/2 object-contain",
            layer.anchor === "bottom" ? "bottom-[-8%]" : "top-[-10%]",
            layer.type === "rail" ? "w-[112%]" : "w-[122%]",
            layer.order === "back" && "z-0 opacity-80",
          )}
          loading="lazy"
          decoding="async"
        />
      ))}
    </div>
  );
}
