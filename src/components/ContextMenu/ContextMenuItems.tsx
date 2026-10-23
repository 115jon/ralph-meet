import { cn } from "@/lib/utils";
import {
  MENU_ITEM,
  MENU_ITEM_DANGER,
  MENU_ITEM_DEFAULT,
  MENU_LABEL,
  MENU_SEPARATOR,
} from "@/components/ui/menu";
import type { ActionSheetItem } from "@/components/ui/action-sheet";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { Icon } from "@/components/ui/icon";
import React, { memo, useCallback } from "react";

/**
 * Item model for the voice/stream context menus (LocalMenu, RemoteMenu). One
 * list renders as a Base UI menu on desktop (flipping submenus) and as an
 * `ActionSheet` on phones, where sliders and submenus open inline in a row.
 *
 * Items never close the menu on their own: each `onSelect` calls `onClose`
 * when the action should dismiss it, as the menus always did.
 */
export type StreamMenuEntry =
  | {
      type: "item";
      key: string;
      label: string;
      onSelect?: () => void;
      danger?: boolean;
      /** A toggle: renders a check when on. */
      checked?: boolean;
      bold?: boolean;
      description?: string;
      trailing?: React.ReactNode;
      disabled?: boolean;
    }
  | {
      type: "slider";
      key: string;
      label: string;
      value: number;
      max?: number;
      onChange: (value: number) => void;
    }
  | {
      type: "submenu";
      key: string;
      label: string;
      entries: StreamMenuEntry[];
    }
  | { type: "divider"; key: string };

/** A divider entry; `key` must be unique within its list. */
export function divider(key: string): StreamMenuEntry {
  return { type: "divider", key: `divider-${key}` };
}

/**
 * Volume-style slider. The thumb is always visible (VC-23) and the input
 * grows to a 44px hit target on coarse pointers.
 */
export const Slider = memo(
  ({
    label,
    value,
    max = 200,
    onChange,
    onMouseEnter,
  }: {
    label: string;
    value: number;
    max?: number;
    onChange: (val: number) => void;
    onMouseEnter?: () => void;
  }) => {
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(parseInt(e.target.value));
      },
      [onChange],
    );
    const percent = Math.min(100, (value / max) * 100);

    return (
      <div className="shrink-0 px-2 py-2" onMouseEnter={onMouseEnter}>
        <p className="mb-2 text-ui-xs font-semibold text-rm-text">{label}</p>
        <div className="relative h-1 rounded-full bg-rm-bg-primary">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary transition-ui"
            style={{ width: `${percent}%` }}
          />
          <div
            data-slot="slider-thumb"
            className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-rm-border bg-rm-bg-surface shadow-lg pointer-coarse:size-5"
            style={{ left: `${percent}%` }}
          />
          <input
            type="range"
            min="0"
            max={max}
            step="1"
            value={value}
            aria-label={label}
            onChange={handleChange}
            className="absolute inset-x-0 top-1/2 z-10 h-full w-full -translate-y-1/2 cursor-pointer opacity-0 pointer-coarse:min-h-11"
          />
        </div>
      </div>
    );
  },
);
Slider.displayName = "Slider";

/** Keys a range input handles itself; the menu must not move focus on them. */
const SLIDER_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function ItemLabel({
  label,
  description,
  bold,
}: {
  label: string;
  description?: string;
  bold?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn("truncate", bold && "font-semibold")}>
        <InlineEmojiText text={label} />
      </span>
      {description ? (
        <span className="truncate text-ui-2xs font-normal text-rm-text-muted">
          <InlineEmojiText text={description} />
        </span>
      ) : null}
    </span>
  );
}

/** Desktop: the entries as Base UI menu rows (inside a DropdownMenuContent). */
export function StreamMenuEntries({
  entries,
  panelProps,
}: {
  entries: StreamMenuEntry[];
  /** Spread on every submenu panel (event isolation, data attributes). */
  panelProps?: React.ComponentPropsWithoutRef<"div">;
}) {
  return (
    <>
      {entries.map((entry) => {
        switch (entry.type) {
          case "divider":
            return <DropdownMenuSeparator key={entry.key} />;
          case "slider":
            return (
              <div
                key={entry.key}
                onKeyDown={(event) => {
                  if (SLIDER_KEYS.has(event.key)) event.stopPropagation();
                }}
              >
                <Slider
                  label={entry.label}
                  value={entry.value}
                  max={entry.max}
                  onChange={entry.onChange}
                />
              </div>
            );
          case "submenu":
            return (
              <DropdownMenuSub key={entry.key}>
                <DropdownMenuSubTrigger>
                  <InlineEmojiText text={entry.label} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  className="max-w-[min(240px,var(--available-width))]"
                  {...panelProps}
                >
                  <StreamMenuEntries
                    entries={entry.entries}
                    panelProps={panelProps}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          case "item": {
            const label = (
              <ItemLabel
                label={entry.label}
                description={entry.description}
                bold={entry.bold}
              />
            );
            if (entry.checked !== undefined) {
              return (
                <DropdownMenuCheckboxItem
                  key={entry.key}
                  checked={entry.checked}
                  disabled={entry.disabled}
                  onCheckedChange={() => entry.onSelect?.()}
                  closeOnClick={false}
                  className={cn(entry.danger && "text-rm-danger-ink")}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              );
            }
            return (
              <DropdownMenuItem
                key={entry.key}
                variant={entry.danger ? "danger" : "default"}
                disabled={entry.disabled}
                closeOnClick={false}
                onClick={() => entry.onSelect?.()}
                hint={entry.trailing}
              >
                {label}
              </DropdownMenuItem>
            );
          }
        }
      })}
    </>
  );
}

/** Phone: rows inside an expanded ActionSheet row (nested submenus flatten). */
function SheetEntries({ entries }: { entries: StreamMenuEntry[] }) {
  return (
    <div className="flex flex-col">
      {entries.map((entry) => {
        switch (entry.type) {
          case "divider":
            return <div key={entry.key} className={MENU_SEPARATOR} />;
          case "slider":
            return (
              <Slider
                key={entry.key}
                label={entry.label}
                value={entry.value}
                max={entry.max}
                onChange={entry.onChange}
              />
            );
          case "submenu":
            return (
              <div key={entry.key} role="group" aria-label={entry.label}>
                <p className={MENU_LABEL}>{entry.label}</p>
                <SheetEntries entries={entry.entries} />
              </div>
            );
          case "item":
            return (
              <button
                key={entry.key}
                type="button"
                disabled={entry.disabled}
                aria-pressed={entry.checked}
                onClick={() => entry.onSelect?.()}
                className={cn(
                  MENU_ITEM,
                  "justify-between",
                  entry.danger ? MENU_ITEM_DANGER : MENU_ITEM_DEFAULT,
                )}
              >
                <ItemLabel
                  label={entry.label}
                  description={entry.description}
                  bold={entry.bold}
                />
                {entry.checked ? (
                  <Icon name="check" size="xs" className="shrink-0" />
                ) : null}
              </button>
            );
        }
      })}
    </div>
  );
}

const noop = () => {};

/** Phone: the same entries as ActionSheet rows. */
export function toActionSheetItems(
  entries: StreamMenuEntry[],
): ActionSheetItem[] {
  const items: ActionSheetItem[] = [];
  for (const entry of entries) {
    if (entry.type === "divider") {
      const last = items[items.length - 1];
      if (last) last.divider = true;
      continue;
    }
    if (entry.type === "slider") {
      items.push({
        key: entry.key,
        label: entry.label,
        subtitle: `${entry.value}%`,
        onClick: noop,
        closeOnClick: false,
        submenu: (
          <Slider
            label={entry.label}
            value={entry.value}
            max={entry.max}
            onChange={entry.onChange}
          />
        ),
      });
      continue;
    }
    if (entry.type === "submenu") {
      items.push({
        key: entry.key,
        label: entry.label,
        onClick: noop,
        closeOnClick: false,
        submenu: <SheetEntries entries={entry.entries} />,
      });
      continue;
    }
    items.push({
      key: entry.key,
      label: entry.label,
      subtitle: entry.description,
      onClick: entry.onSelect ?? noop,
      variant: entry.danger ? "danger" : "default",
      disabled: entry.disabled,
      closeOnClick: false,
      rightIcon: entry.checked ? (
        <Icon name="check" size="sm" />
      ) : entry.checked === undefined ? (
        entry.trailing
      ) : undefined,
    });
  }
  return items;
}
