import {
  getProfileFrame,
  type AvatarDisplay,
  type ProfileFrameSelection,
} from "@/lib/avatar-display";
import type { CSSProperties } from "react";

export type ProfileFrameLayerOrder = "front" | "back";

export interface ProfileFrameLayerStyleOptions {
  fitToSurface?: boolean;
}

export function getProfileFrameSurfaceInsetStyle(
  display: AvatarDisplay | string | null | undefined,
): CSSProperties {
  const frame = getProfileFrame(display);
  if (!frame) return {};

  return {
    top: `${(frame.overflowTop / frame.innerWidth) * 100}cqw`,
    bottom: `${(frame.overflowBottom / frame.innerWidth) * 100}cqw`,
  };
}

export function getProfileFrameLayers(
  display: AvatarDisplay | string | null | undefined,
  order: ProfileFrameLayerOrder,
): ProfileFrameSelection["layers"] {
  return (
    getProfileFrame(display)?.layers.filter((layer) => layer.order === order) ??
    []
  );
}

export function getProfileFrameLayerStyle(
  display: AvatarDisplay | string | null | undefined,
  layer: ProfileFrameSelection["layers"][number],
  { fitToSurface = false }: ProfileFrameLayerStyleOptions = {},
): CSSProperties {
  const frame = getProfileFrame(display);
  const horizontalOverflow = frame
    ? (frame.overflowHorizontal / frame.innerWidth) * 200
    : layer.type === "rail"
      ? 12
      : 22;
  const verticalOverflow = frame
    ? ((layer.anchor === "bottom" ? frame.overflowBottom : frame.overflowTop) /
        frame.innerWidth) *
      100
    : 8;
  const isContainedBorder = layer.type === "border";
  const fitVerticalBounds = fitToSurface || isContainedBorder;
  const surfaceInset = getProfileFrameSurfaceInsetStyle(display);
  const surfaceTop = surfaceInset.top;
  const surfaceBottom = surfaceInset.bottom;

  return {
    width: `${100 + horizontalOverflow}cqw`,
    ...(isContainedBorder
      ? {
          height:
            fitToSurface && surfaceTop && surfaceBottom
              ? `calc(100% - ${surfaceTop} - ${surfaceBottom})`
              : "100%",
          objectFit: "fill" as const,
          top: fitToSurface && surfaceTop ? surfaceTop : "0%",
        }
      : {}),
    ...(fitVerticalBounds && !isContainedBorder
      ? layer.anchor === "bottom"
        ? { bottom: "0%" }
        : { top: "0%" }
      : !isContainedBorder &&
        (layer.anchor === "bottom"
          ? {
              bottom: `calc(-${verticalOverflow}cqw)`,
            }
          : {
              top: `calc(-${verticalOverflow}cqw)`,
            })),
  };
}
