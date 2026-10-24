import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

export type UserStatus = "online" | "idle" | "dnd" | "offline";

/** Presence fills from the theme's `--rm-status-*` tokens (never accent). */
export const USER_STATUS_COLOR_CLASSES: Record<UserStatus, string> = {
  online: "bg-rm-status-online",
  idle: "bg-rm-status-idle",
  dnd: "bg-rm-status-dnd",
  offline: "bg-rm-status-offline",
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Offline",
};

/** Maps any stored status string (e.g. "invisible") onto the four dots. */
export function normalizeUserStatus(value: unknown): UserStatus {
  return value === "online" || value === "idle" || value === "dnd"
    ? value
    : "offline";
}

// The offline ring and the dnd bar are holes cut with a mask, not shapes
// painted in a surface colour: whatever sits behind the dot (a ring, a row
// tint, a profile gradient) shows through, so the cut-out matches every
// surface. Paths are a 20x20 disc minus a 42% hole / a 55%x18% bar.
const DISC = "M10 0a10 10 0 1 0 0 20a10 10 0 1 0 0-20z";
const cutoutMask = (hole: string): CSSProperties => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><path fill-rule='evenodd' d='${DISC}${hole}'/></svg>`;
  const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
  };
};
const CUTOUT_MASKS: Partial<Record<UserStatus, CSSProperties>> = {
  offline: cutoutMask("M10 5.8a4.2 4.2 0 1 0 0 8.4a4.2 4.2 0 1 0 0-8.4z"),
  dnd: cutoutMask("M6.3 8.2h7.4a1.8 1.8 0 0 1 0 3.6h-7.4a1.8 1.8 0 0 1 0-3.6z"),
};

export function UserStatusDot({
  status,
  className,
  ring,
  label,
}: {
  status: UserStatus;
  /** Size and position; with `ring`, of the ring box (dot = box - 4px). */
  className?: string;
  /**
   * Background class(es) of the surface behind the dot, e.g.
   * `"bg-rm-sidebar"` or `"bg-rm-bg-surface dark:bg-rm-bg-elevated"`. Draws a
   * 2px ring in that colour where the dot overlaps an avatar. Omit when the
   * dot sits on its own (menu rows) or inside a ringed wrapper.
   */
  ring?: string;
  /** Pass to announce the status; omitted, the dot is decorative. */
  label?: string;
}) {
  const a11y = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true as const };
  const dot = (
    <span
      data-status={status}
      className={cn(
        "flex aspect-square rounded-full",
        USER_STATUS_COLOR_CLASSES[status],
        ring ? "size-full" : className,
      )}
      style={CUTOUT_MASKS[status]}
      {...(ring ? {} : a11y)}
    />
  );
  if (!ring) return dot;
  return (
    <span
      className={cn("flex aspect-square rounded-full p-0.5", ring, className)}
      {...a11y}
    >
      {dot}
    </span>
  );
}
