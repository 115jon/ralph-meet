import * as React from "react";

import { useAppActive } from "@/hooks/useAppActive";
import { cn } from "@/lib/utils";

/**
 * A live number (DESIGN.md, Num): Martian Mono, tabular, sized
 * `text-num-xs` (11/14: timestamps, counts in rows, badges, kbd) or
 * `text-num-sm` (12/16: ping, bitrate, file sizes, the call clock). Mono is
 * for readouts; labels use the `silkscreen` utility.
 */
type NumProps = React.ComponentProps<"span"> & {
  size?: "xs" | "sm";
};

function Num({ size = "xs", className, ...props }: NumProps) {
  return (
    <span
      data-slot="num"
      className={cn(size === "sm" ? "text-num-sm" : "text-num-xs", className)}
      {...props}
    />
  );
}

/** "4:07" under an hour, "1:04:07" from an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * A call clock that ticks in its own leaf, so nothing around it re-renders.
 * One timeout per second aligned to the second boundary; it stops while the
 * app is inactive (hidden or behind a game) and catches up on return.
 * Pass `now` to freeze it (fixtures, tests).
 */
function NumClock({
  since,
  now,
  size = "sm",
  ...props
}: Omit<NumProps, "children"> & {
  /** Epoch ms the call (or stream) started. */
  since: number;
  now?: number;
}) {
  const active = useAppActive();
  const [tick, setTick] = React.useState(() => now ?? Date.now());

  React.useEffect(() => {
    if (now !== undefined || !active) return;
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = Date.now();
      setTick(current);
      id = setTimeout(schedule, 1000 - ((current - since) % 1000) + 4);
    };
    schedule();
    return () => clearTimeout(id);
  }, [active, since, now]);

  const elapsed = (now ?? tick) - since;
  return (
    <Num size={size} {...props}>
      <time dateTime={`PT${Math.max(0, Math.floor(elapsed / 1000))}S`}>
        {formatElapsed(elapsed)}
      </time>
    </Num>
  );
}

export { Num, NumClock };
