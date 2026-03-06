import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageViewerNavigationProps {
  onPrev: () => void;
  onNext: () => void;
}

export function ImageViewerNavigation({ onPrev, onNext }: ImageViewerNavigationProps) {
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); onPrev(); }}
        className="absolute left-1 md:left-4 p-2 md:p-4 text-rm-text-muted/40 hover:text-rm-text hover:bg-rm-bg-hover rounded-full transition-all z-40 outline-none"
      >
        <ChevronLeft size={32} className="md:hidden" strokeWidth={1.5} />
        <ChevronLeft size={48} className="hidden md:block" strokeWidth={1.5} />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onNext(); }}
        className="absolute right-1 md:right-4 p-2 md:p-4 text-rm-text-muted/40 hover:text-rm-text hover:bg-rm-bg-hover rounded-full transition-all z-40 outline-none"
      >
        <ChevronRight size={32} className="md:hidden" strokeWidth={1.5} />
        <ChevronRight size={48} className="hidden md:block" strokeWidth={1.5} />
      </button>
    </>
  );
}
