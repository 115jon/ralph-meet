import {
  getProfileFrame,
  type AvatarDisplay,
  type ProfileFrameSelection,
} from "@/lib/avatar-display";
import type { CSSProperties } from "react";

export type ProfileFrameLayerOrder = "front" | "back";

const PROFILE_SURFACE_ASPECT_RATIO = 450 / 880;

export interface ProfileFrameLayerStyleOptions {
  fitToSurface?: boolean;
}

export interface ProfileFramePreviewTransform {
  scale: number;
  transformOrigin: string;
}

export function getProfileFramePreviewTransform(
  display: AvatarDisplay | string | null | undefined,
): ProfileFramePreviewTransform {
  const frame = getProfileFrame(display);
  if (!frame) {
    return {
      scale: 1,
      transformOrigin: "50% 50%",
    };
  }

  const horizontalFootprint =
    1 + (frame.overflowHorizontal * 2) / frame.innerWidth;
  const hasTopOverflow = frame.layers.some(
    (layer) => layer.type !== "border" && layer.anchor !== "bottom",
  );
  const hasBottomOverflow = frame.layers.some(
    (layer) => layer.type !== "border" && layer.anchor === "bottom",
  );
  const topOverflow = hasTopOverflow ? frame.overflowTop : 0;
  const bottomOverflow = hasBottomOverflow ? frame.overflowBottom : 0;
  const totalVerticalOverflow = topOverflow + bottomOverflow;
  const verticalFootprint =
    1 +
    totalVerticalOverflow * (PROFILE_SURFACE_ASPECT_RATIO / frame.innerWidth);

  return {
    scale: Math.min(1, 1 / Math.max(horizontalFootprint, verticalFootprint)),
    transformOrigin:
      totalVerticalOverflow > 0
        ? `50% ${(topOverflow / totalVerticalOverflow) * 100}%`
        : "50% 50%",
  };
}

export function getProfileFramePreviewScale(
  display: AvatarDisplay | string | null | undefined,
): number {
  return getProfileFramePreviewTransform(display).scale;
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
