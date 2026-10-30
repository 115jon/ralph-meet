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
}

/**
 * One render order of a profile frame. Fills the frame box (the card plus the
 * footprint ProfileSurfaceShell reserves around it); see lib/profile-frame.
 */
export function ProfileFrameLayer({
  display,
  order,
  className,
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
      data-frame-order={order}
    >
      {layers.map((layer) => (
        <img
          key={layer.id}
          src={layer.src}
          alt=""
          data-frame-layer={layer.type}
          className="absolute left-0 max-w-none select-none"
          style={getProfileFrameLayerStyle(display, layer)}
          draggable={false}
          decoding="async"
        />
      ))}
    </div>
  );
}
