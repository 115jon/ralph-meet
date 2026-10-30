import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** How long the loader may run before it settles into a static line. */
export const STREAM_LOADER_CAP_MS = 8000;

/**
 * A stream that is on its way. The pending spinner is one of the allowed
 * loops (spec §6), but only for {@link STREAM_LOADER_CAP_MS}: a stream that
 * never arrives settles into a static "Waiting for …" line instead of
 * spinning for the rest of the call. Everything inside a tile stays at or
 * below z-10.
 */
export const StreamLoadingIndicator = ({
  className,
  name,
}: {
  className?: string;
  /** Whose stream, for the settled line ("Waiting for Linus's stream"). */
  name?: string;
}) => {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), STREAM_LOADER_CAP_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-ply-2 px-3 text-center",
        className,
      )}
    >
      {settled ? (
        <span className="text-ui-xs text-ink-3">
          {name ? `Waiting for ${name}'s stream` : "Waiting for the stream"}
        </span>
      ) : (
        <>
          <span aria-hidden className="rm-spinner size-5 text-ink-3" />
          <span className="sr-only">Loading stream</span>
        </>
      )}
    </div>
  );
};
