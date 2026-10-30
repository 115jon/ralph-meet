/**
 * Host size for a still DitherField, rounded to coarse steps.
 *
 * DitherField's painter and canvas size are mount-time, so a still field is
 * keyed on this and re-cut only when its host changes shape meaningfully (a
 * rotation, a breakpoint), never per pixel. `null` until the host has laid
 * out with a non-zero size, so a host hidden by a breakpoint never mounts a
 * field (and never opens a GL context).
 */

import { useEffect, useState, type RefObject } from "react";

/** Width steps the still frame is re-cut at (it does not track resizes). */
const WIDTH_STEP = 240;
const ASPECT_STEP = 0.05;

export interface DitherGeometry {
  width: number;
  aspect: number;
}

export function useDitherGeometry(ref: RefObject<HTMLElement | null>) {
  const [geometry, setGeometry] = useState<DitherGeometry | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const w = node.clientWidth;
      const h = node.clientHeight;
      if (w === 0 || h === 0) {
        setGeometry(null);
        return;
      }
      const next = {
        width: Math.ceil(w / WIDTH_STEP) * WIDTH_STEP,
        aspect: Math.round(h / w / ASPECT_STEP) * ASPECT_STEP,
      };
      setGeometry((prev) =>
        prev?.width === next.width && prev.aspect === next.aspect ? prev : next,
      );
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return geometry;
}

export interface BoxSize {
  width: number;
  height: number;
}

/**
 * The host's exact content-box size in CSS px, tracked with a
 * ResizeObserver; `null` until it lays out with a non-zero size. For still
 * masks that are cheap to rebuild and must keep square cells (the dithered
 * rule), where DitherGeometry's coarse width steps would stretch them.
 */
export function useBoxSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<BoxSize | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setSize((prev) => {
        if (width === 0 || height === 0) return null;
        return prev?.width === width && prev.height === height
          ? prev
          : { width, height };
      });
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
