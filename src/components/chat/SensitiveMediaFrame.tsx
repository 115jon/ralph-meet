import { cn } from "@/lib/utils";
import { HIT, PRESS } from "@/components/ui/interaction";
import { useState } from "react";

interface SensitiveMediaFrameProps {
  attachmentId: string;
  blur: boolean;
  className?: string;
  mediaClassName?: string;
  overlayClassName?: string;
  dataMediaProps?: Record<string, string>;
  children:
    | React.ReactNode
    | ((state: { revealed: boolean }) => React.ReactNode);
}

export default function SensitiveMediaFrame({
  attachmentId,
  ...props
}: SensitiveMediaFrameProps) {
  return <SensitiveMediaFrameContent key={attachmentId} {...props} />;
}

function SensitiveMediaFrameContent({
  blur,
  className,
  mediaClassName,
  overlayClassName,
  dataMediaProps,
  children,
}: Omit<SensitiveMediaFrameProps, "attachmentId">) {
  const [revealed, setRevealed] = useState(false);

  const resolvedChildren =
    typeof children === "function" ? children({ revealed }) : children;

  if (!blur || revealed) {
    return (
      <div {...dataMediaProps} className={className}>
        {resolvedChildren}
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        {...dataMediaProps}
        aria-hidden="true"
        data-rm-preserve-blur="true"
        className={cn(
          "pointer-events-none select-none blur-2xl saturate-50 scale-[1.02]",
          mediaClassName,
        )}
      >
        {resolvedChildren}
      </div>
      <div
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/45 px-4 text-center",
          overlayClassName,
        )}
      >
        <div className="space-y-1">
          <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-white">
            Sensitive media
          </p>
          <p className="text-ui-xs text-white/80">
            Hidden by your high media filter.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className={cn(
            // Media overlay control over the blurred media (6.5).
            "inline-flex h-8 items-center rounded-md bg-white/15 px-3 text-ui-sm font-medium text-white",
            PRESS,
            HIT,
          )}
        >
          Show media
        </button>
      </div>
    </div>
  );
}
