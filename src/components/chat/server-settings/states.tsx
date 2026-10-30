/**
 * Loading, empty and error states shared by the server and channel settings
 * pages. The page heading lives in the workbench header, so these never draw
 * a title of their own for the page.
 *
 *   whole panel   <PageState> / <LoadError>: the EmptyState anatomy,
 *                 top-aligned 48px under the page header (the page body
 *                 already pads 20, this adds 28), not centred mid-panel.
 *   list in card  <ListError>: the in-card RowError with a Retry, for a list
 *                 that sits under other cards on the same page.
 *   loading       <SkeletonRows>: static rows at the real row height.
 */

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { RowError } from "../settings/primitives";

/** 28 + the page body's 20 top padding = 48 below the header. */
const TOP = "pt-7 pb-10";

/** Whole-panel empty state (EmptyState anatomy, top-aligned). */
export function PageState({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      title={title}
      description={children}
      action={action}
      className={cn(TOP, "justify-start")}
    />
  );
}

/** Whole-panel load failure with a retry. */
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
    <EmptyState
      role="alert"
      title={title}
      description={message}
      className={cn(TOP, "justify-start")}
      action={
        <Button
          type="button"
          variant="secondary"
          loading={retrying}
          onClick={onRetry}
        >
          Try again
        </Button>
      }
    />
  );
}

/** A list inside a card failed: the in-card error row with Retry. */
export function ListError({
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
    <li className="px-4 pb-3">
      <RowError className="items-center">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{title}</span>
            <span className="block">{message}</span>
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={retrying}
            onClick={onRetry}
          >
            Try again
          </Button>
        </span>
      </RowError>
    </li>
  );
}

/**
 * Skeleton rows at the real row height while a list loads. `rowClass` sets
 * the height (bans and invites are 60: a 32 avatar beside two lines).
 */
export function SkeletonRows({
  label,
  rows = 3,
  avatar = true,
  rowClass = "h-15",
}: {
  label: string;
  rows?: number;
  avatar?: boolean;
  rowClass?: string;
}) {
  return (
    <div
      role="status"
      className="divide-y divide-line rounded-lg border border-line bg-ply-2"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn("flex items-center gap-3 px-4", rowClass)}
        >
          {avatar ? (
            <Skeleton className="size-8 shrink-0 rounded-avatar" />
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Decorative row avatar (the name sits beside it as text). */
export function RowAvatar({
  src,
  name,
  size = 32,
}: {
  src?: string | null;
  name: string;
  size?: 24 | 32;
}) {
  return (
    <span aria-hidden="true" className="shrink-0">
      <Avatar src={src} name={name} size={size} ring="ply-2" />
    </span>
  );
}
