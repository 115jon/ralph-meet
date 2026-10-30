import { cn } from "@/lib/utils";
import { HIT, PRESS } from "@/components/ui/interaction";
import { useState } from "react";

interface SensitiveMediaFrameProps {
  attachmentId: string;
  blur: boolean;
  className?: string;
  /** Box sizing for the frame (a reserved aspect ratio, a capped width). */
  style?: React.CSSProperties;
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
  style,
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
      <div {...dataMediaProps} className={className} style={style}>
        {resolvedChildren}
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)} style={style}>
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
          "absolute inset-0 flex items-center justify-center bg-scrim p-3",
          overlayClassName,
        )}
      >
        {/* A ply-3 float over the blurred media: its text keeps contrast in
            every theme, whatever the image underneath. */}
        <div className="flex max-w-full flex-col items-center gap-2 rounded-lg border border-line bg-ply-3 px-4 py-3 text-center shadow-float">
          <div className="flex flex-col gap-0.5">
            <p className="text-ui-sm font-semibold text-ink-1">
              Sensitive media
            </p>
            <p className="text-ui-xs text-ink-2">
              Hidden by your high media filter.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className={cn(
              "inline-flex h-7 items-center rounded-sm bg-tint-2 px-2.5 text-ui-sm font-medium text-ink-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              PRESS,
              HIT,
            )}
          >
            Show media
          </button>
        </div>
      </div>
    </div>
  );
}
