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

export function UserStatusDot({
  status,
  className,
  cutoutClassName = "bg-rm-bg-surface",
  label,
}: {
  status: UserStatus;
  className?: string;
  /** Fill of the offline ring / dnd bar; match the surface behind the dot. */
  cutoutClassName?: string;
  /** Pass to announce the status; omitted, the dot is decorative. */
  label?: string;
}) {
  return (
    <span
      className={cn(
        "relative flex aspect-square items-center justify-center rounded-full",
        USER_STATUS_COLOR_CLASSES[status],
        className,
      )}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      {status === "offline" ? (
        <span
          className={cn(
            "absolute left-1/2 top-1/2 h-[42%] w-[42%] -translate-x-1/2 -translate-y-1/2 rounded-full",
            cutoutClassName,
          )}
        />
      ) : null}
      {status === "dnd" ? (
        <span
          className={cn(
            "absolute left-1/2 top-1/2 h-[18%] w-[55%] -translate-x-1/2 -translate-y-1/2 rounded-full",
            cutoutClassName,
          )}
        />
      ) : null}
    </span>
  );
}
