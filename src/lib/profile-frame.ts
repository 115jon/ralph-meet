import {
  getProfileFrame,
  type AvatarDisplay,
  type ProfileFrameSelection,
} from "@/lib/avatar-display";
import type { CSSProperties } from "react";

export type ProfileFrameLayerOrder = "front" | "back";

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

  return {
    width: `${100 + horizontalOverflow}cqw`,
    ...(isContainedBorder
      ? {
          height: "100%",
          objectFit: "fill" as const,
          top: "0%",
        }
      : {}),
    ...(!isContainedBorder &&
      (layer.anchor === "bottom"
        ? {
            bottom: `calc(-${verticalOverflow}cqw)`,
          }
        : {
            top: `calc(-${verticalOverflow}cqw)`,
          })),
  };
}
