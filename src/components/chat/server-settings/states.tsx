/**
 * Loading, empty and error states shared by the server settings pages
 * (design-system 14.1-14.3). The page heading lives in the workbench header,
 * so these never draw a title of their own for the page.
 */

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** 14.1: centred, no card. `tone="danger"` is the whole-view error. */
export function PageState({
  icon,
  title,
  children,
  action,
  tone = "neutral",
}: {
  icon: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className="flex flex-col items-center gap-3 px-6 py-12 text-center"
    >
      <Icon
        name={icon}
        size="3xl"
        className={cn(
          "max-md:size-8",
          tone === "danger" ? "text-rm-danger-ink" : "text-rm-text-muted",
        )}
      />
      <p
        className={cn(
          "text-ui-md font-semibold",
          tone === "danger" ? "text-rm-danger-ink" : "text-rm-text",
        )}
      >
        {title}
      </p>
      {children ? (
        <p className="max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
          {children}
        </p>
      ) : null}
      {action}
    </div>
  );
}

/** Whole-view load failure with a retry (14.3). */
export function LoadError({
  title,
  message,
  retrying,
  onRetry,
}: {
  title: string;
  message: string;
  retrying?: boolean;
  onRetry: () => void;
}) {
  return (
    <PageState
      icon="warning"
      tone="danger"
      title={title}
      action={
        <Button
          type="button"
          variant="secondary"
          loading={retrying}
          onClick={onRetry}
        >
          <Icon name="refresh" size="sm" />
          Try again
        </Button>
      }
    >
      {message}
    </PageState>
  );
}

/** Skeleton rows at the real row height while a list loads (14.2). */
export function SkeletonRows({
  label,
  rows = 3,
  avatar = true,
}: {
  label: string;
  rows?: number;
  avatar?: boolean;
}) {
  return (
    <div
      role="status"
      className="divide-y divide-rm-border rounded-lg border border-rm-border bg-rm-bg-surface"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex min-h-16 items-center gap-3 px-4 py-3 @min-[560px]:px-5"
        >
          {avatar ? (
            <span className="size-9 shrink-0 animate-pulse rounded-full bg-rm-tint-1 motion-reduce:animate-none" />
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-4 w-40 max-w-full animate-pulse rounded-md bg-rm-tint-1 motion-reduce:animate-none" />
            <span className="h-3 w-64 max-w-full animate-pulse rounded-md bg-rm-tint-1 motion-reduce:animate-none" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Round avatar: the image when there is one, else the initial on a tint. */
export function RowAvatar({
  src,
  initial,
  size = "md",
}: {
  src?: string | null;
  initial: string;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "size-8 text-ui-xs" : "size-9 text-ui-sm";
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", box)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-rm-tint-2 font-semibold text-rm-text-secondary",
        box,
      )}
    >
      {initial}
    </span>
  );
}
