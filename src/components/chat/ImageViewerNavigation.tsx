import { Icon } from "@/components/ui/icon";

interface ImageViewerNavigationProps {
  onPrev: () => void;
  onNext: () => void;
}

export function ImageViewerNavigation({
  onPrev,
  onNext,
}: ImageViewerNavigationProps) {
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        className="absolute left-1 md:left-4 p-2 md:p-4 text-rm-text-muted/40 pointer-fine:hover:text-rm-text pointer-fine:hover:bg-rm-bg-hover rounded-full transition-ui z-40 outline-none"
      >
        <Icon name="chevronLeft" size="2xl" className="md:hidden" />
        <Icon name="chevronLeft" size="3xl" className="hidden md:block" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        className="absolute right-1 md:right-4 p-2 md:p-4 text-rm-text-muted/40 pointer-fine:hover:text-rm-text pointer-fine:hover:bg-rm-bg-hover rounded-full transition-ui z-40 outline-none"
      >
        <Icon name="chevronRight" size="2xl" className="md:hidden" />
        <Icon name="chevronRight" size="3xl" className="hidden md:block" />
      </button>
    </>
  );
}
