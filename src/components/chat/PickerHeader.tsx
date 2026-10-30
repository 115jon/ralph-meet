/**
 * The one picker header (emoji, GIF, soundboard): a 48px row with the search
 * field (`h-8`, leading glyph) and a trailing group of 32px icon buttons,
 * plus an optional 36px tabs row under it. A `line` seam closes it.
 */

import * as React from "react";

import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PickerHeader({
  children,
  tabs,
  className,
}: {
  /** The search row: a `PickerSearch`, then any trailing `IconButton`s. */
  children: React.ReactNode;
  /** Optional tabs row (36px) under the search row. */
  tabs?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("shrink-0 border-b border-line", className)}>
      <div className="flex min-h-12 items-center gap-1 px-2">{children}</div>
      {tabs ? (
        <div className="-mt-1 flex h-9 items-end px-2">{tabs}</div>
      ) : null}
    </div>
  );
}

/** The header's search field: `Input` at 32px with a leading search glyph. */
export function PickerSearch({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <div className="relative min-w-0 flex-1">
      <Icon
        name="search"
        size="sm"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
      />
      <Input
        ref={ref}
        type="text"
        autoComplete="off"
        spellCheck={false}
        className={cn("pl-8 pointer-coarse:h-11", className)}
        {...props}
      />
    </div>
  );
}

/** A quiet section label inside a picker grid (sentence case, ink-3). */
export function PickerSectionLabel({
  children,
  trailing,
  className,
  sticky = true,
}: {
  children: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <div
      className={cn(
        "z-10 flex h-8 items-center gap-2 bg-ply-3 px-2 text-ui-xs font-medium text-ink-3",
        sticky && "sticky top-0",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {trailing ? (
        <span className="ms-auto flex shrink-0 items-center gap-1.5">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
