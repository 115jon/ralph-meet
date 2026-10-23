/**
 * Profile frame geometry.
 *
 * A frame is authored around a profile card `innerWidth` units wide (1200 in
 * every catalog frame). Its art spills past the card by `overflowTop`,
 * `overflowBottom` and `overflowHorizontal` units, and comes in four layer
 * types:
 *
 *   staple  a cap pinned to the top or bottom edge, natural aspect, hanging
 *           `overflow*` units outside the card (the rest overlaps the card).
 *   rail    the side columns, stretched to run the whole frame height.
 *   border  a hairline ring around the card itself, stretched to the card.
 *
 * `order: "back"` layers sit under the card (only their overhang shows);
 * `order: "front"` layers sit over it.
 *
 * Every profile surface reserves the frame's footprint inside its own box
 * (`getProfileFrameSurfaceMarginStyle`) so the overhang never draws over the
 * text or controls around the card and never gets clipped by a scroller or
 * the viewport. The layers are then laid out against that outer box in
 * container units (`cqw` of the frame box), so the art scales with the card
 * at any width.
 */

import {
  getProfileFrame,
  type AvatarDisplay,
  type ProfileFrameSelection,
} from "@/lib/avatar-display";
import type { CSSProperties } from "react";

export type ProfileFrameLayerOrder = "front" | "back";

type FrameLayer = ProfileFrameSelection["layers"][number];

/** Frame overhang, in frame units, that a surface must leave room for. */
export interface ProfileFrameFootprint {
  /** Card width the frame was authored for. */
  innerWidth: number;
  /** Full frame width: card plus both side overhangs. */
  outerWidth: number;
  top: number;
  bottom: number;
  side: number;
}

function reachesTop(layer: FrameLayer) {
  return (
    layer.type === "rail" ||
    (layer.type !== "border" && layer.anchor !== "bottom")
  );
}

function reachesBottom(layer: FrameLayer) {
  return (
    layer.type === "rail" ||
    (layer.type !== "border" && layer.anchor === "bottom")
  );
}

export function getProfileFrameFootprint(
  display: AvatarDisplay | string | null | undefined,
): ProfileFrameFootprint | null {
  const frame = getProfileFrame(display);
  if (!frame?.layers.length) return null;
  const side = frame.overflowHorizontal;
  return {
    innerWidth: frame.innerWidth,
    outerWidth: frame.innerWidth + side * 2,
    top: frame.layers.some(reachesTop) ? frame.overflowTop : 0,
    bottom: frame.layers.some(reachesBottom) ? frame.overflowBottom : 0,
    side,
  };
}

/** `units` of the frame as a length in the frame box's container units. */
function cqw(units: number, footprint: ProfileFrameFootprint) {
  const value = Math.round((units / footprint.outerWidth) * 100 * 1000) / 1000;
  return `${value}cqw`;
}

/**
 * Margins that inset the card inside a frame box, so the frame's overhang
 * fits within the box. Resolved against the frame box (the nearest
 * `container-type: inline-size` ancestor of the card).
 */
export function getProfileFrameSurfaceMarginStyle(
  display: AvatarDisplay | string | null | undefined,
): CSSProperties {
  const footprint = getProfileFrameFootprint(display);
  if (!footprint) return {};
  return {
    marginTop: cqw(footprint.top, footprint),
    marginBottom: cqw(footprint.bottom, footprint),
    marginLeft: cqw(footprint.side, footprint),
    marginRight: cqw(footprint.side, footprint),
  };
}

/**
 * Total vertical room the frame takes outside the card, as a CSS length.
 * Surfaces with a max height subtract it so card + frame still fit.
 */
export function getProfileFrameReserveY(
  display: AvatarDisplay | string | null | undefined,
): string {
  const footprint = getProfileFrameFootprint(display);
  if (!footprint) return "0px";
  return cqw(footprint.top + footprint.bottom, footprint);
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

/**
 * Placement of one layer inside the frame box (the card plus its reserved
 * footprint). Staples keep their aspect; rails and borders stretch.
 */
export function getProfileFrameLayerStyle(
  display: AvatarDisplay | string | null | undefined,
  layer: FrameLayer,
): CSSProperties {
  const footprint = getProfileFrameFootprint(display);
  if (!footprint) return { display: "none" };

  if (layer.type === "border") {
    const top = cqw(footprint.top, footprint);
    const bottom = cqw(footprint.bottom, footprint);
    return {
      width: "100%",
      top,
      height: `calc(100% - ${top} - ${bottom})`,
      objectFit: "fill",
    };
  }

  if (layer.type === "rail") {
    return { width: "100%", top: "0%", height: "100%", objectFit: "fill" };
  }

  return layer.anchor === "bottom"
    ? { width: "100%", bottom: "0%" }
    : { width: "100%", top: "0%" };
}
