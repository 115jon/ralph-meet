import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface SensitiveMediaFrameProps {
  attachmentId: string;
  blur: boolean;
  className?: string;
  mediaClassName?: string;
  overlayClassName?: string;
  children: React.ReactNode | ((state: { revealed: boolean }) => React.ReactNode);
}

export default function SensitiveMediaFrame({
  attachmentId,
  blur,
  className,
  mediaClassName,
  overlayClassName,
  children,
}: SensitiveMediaFrameProps) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
  }, [attachmentId]);

  const resolvedChildren = typeof children === "function"
    ? children({ revealed })
    : children;

  if (!blur || revealed) {
    return <div className={className}>{resolvedChildren}</div>;
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none select-none blur-2xl saturate-50 scale-[1.02]",
          mediaClassName
        )}
      >
        {resolvedChildren}
      </div>
      <div
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/45 px-4 text-center backdrop-blur-[2px]",
          overlayClassName
        )}
      >
        <div className="space-y-1">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-white/90">
            Sensitive Media
          </p>
          <p className="text-xs font-medium text-white/70">
            Hidden by your high media filter.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="rounded-full border border-white/20 bg-white/12 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-white/18"
        >
          Show
        </button>
      </div>
    </div>
  );
}
