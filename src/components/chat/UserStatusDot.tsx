import { cn } from "@/lib/utils";

export type UserStatus = "online" | "idle" | "dnd" | "offline";

const statusColors: Record<UserStatus, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-[var(--rm-status-offline)]",
};

export function UserStatusDot({
  status,
  className,
}: {
  status: UserStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative flex aspect-square items-center justify-center rounded-full",
        statusColors[status],
        className,
      )}
    >
      {status === "offline" ? (
        <span className="absolute left-1/2 top-1/2 h-[42%] w-[42%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-rm-bg-surface" />
      ) : null}
      {status === "dnd" ? (
        <span className="absolute left-1/2 top-1/2 h-[18%] w-[55%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-rm-bg-surface" />
      ) : null}
    </span>
  );
}
