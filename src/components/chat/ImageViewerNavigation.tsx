import { Icon } from "@/components/ui/icon";
import { HIT, PRESS, PRESS_ICON } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";

interface ImageViewerNavigationProps {
  onPrev: () => void;
  onNext: () => void;
}

/**
 * 40px square keys on ply-3 at the stage edges. Desktop only: phones swipe
 * and have the thumbnail strip, and the keys would sit on the image.
 */
const NAV_BUTTON = cn(
  "absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-md border max-md:hidden border-line bg-ply-3 text-ink-2 shadow-float pointer-fine:hover:text-ink-1 md:size-10",
  PRESS,
  PRESS_ICON,
  HIT,
);

export function ImageViewerNavigation({
  onPrev,
  onNext,
}: ImageViewerNavigationProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Previous media"
        title="Previous (←)"
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        className={cn(NAV_BUTTON, "absolute left-2 md:left-6")}
      >
        <Icon name="chevronLeft" size="lg" />
      </button>
      <button
        type="button"
        aria-label="Next media"
        title="Next (→)"
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        className={cn(NAV_BUTTON, "absolute right-2 md:right-6")}
      >
        <Icon name="chevronRight" size="lg" />
      </button>
    </>
  );
}
