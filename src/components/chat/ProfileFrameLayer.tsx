import {
  getProfileFrameLayers,
  getProfileFrameLayerStyle,
  type ProfileFrameLayerOrder,
} from "@/lib/profile-frame";
import type { AvatarDisplay } from "@/lib/avatar-display";
import { cn } from "@/lib/utils";

interface ProfileFrameLayerProps {
  display?: AvatarDisplay | string | null;
  order: ProfileFrameLayerOrder;
  className?: string;
  fitToSurface?: boolean;
}

export function ProfileFrameLayer({
  display,
  order,
  className,
  fitToSurface = false,
}: ProfileFrameLayerProps) {
  const layers = getProfileFrameLayers(display, order);
  if (!layers.length) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 [container-type:inline-size]",
        className,
      )}
      aria-hidden="true"
    >
      {layers.map((layer) => (
        <img
          key={layer.id}
          src={layer.src}
          alt=""
          className={cn(
            "absolute left-1/2 max-w-none -translate-x-1/2 object-contain",
          )}
          style={getProfileFrameLayerStyle(display, layer, { fitToSurface })}
          loading="lazy"
          decoding="async"
        />
      ))}
    </div>
  );
}
