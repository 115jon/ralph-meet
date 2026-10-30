/**
 * The landing page's lit horizon (`DitherHorizon`): decorative and still, it
 * glows behind the hero screenshot only, never under copy. It does not set
 * `animate`, so it paints one frame, releases its GL context and has nothing
 * for reduced motion to stop. The host is `aria-hidden` and hidden under
 * forced colours.
 *
 * The landing's dithered rules use the app's `DitherRule` (ui/dither): a
 * still CSS mask with square cells, not a GL field.
 */

import { DitherField } from "@/components/ui/DitherField";
import { horizonPainter } from "@/lib/dither-painters";
import { cn } from "@/lib/utils";
import { useDitherGeometry } from "@/components/ui/use-dither-geometry";
import { useMemo, useRef } from "react";

export function DitherHorizon({
  className,
  line = 0.62,
  cell = 6,
  contrast = 1.25,
}: {
  className?: string;
  /** Where the lit line sits, 0 (top) to 1 (bottom) of the band. */
  line?: number;
  cell?: number;
  contrast?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const geometry = useDitherGeometry(ref);
  const paint = useMemo(
    () => (geometry ? horizonPainter(geometry.aspect, line) : null),
    [geometry, line],
  );
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        "pointer-events-none overflow-hidden forced-colors:hidden",
        className,
      )}
    >
      {geometry && paint && (
        <DitherField
          key={`${geometry.width}:${geometry.aspect}`}
          paint={paint}
          cell={cell}
          contrast={contrast}
          // The fallback gradient stands in until the frame is painted; keep
          // it on the ground so nothing flashes bright before the dither.
          style={{ background: "transparent" }}
        />
      )}
    </div>
  );
}
