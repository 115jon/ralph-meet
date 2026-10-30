import { cn } from "@/lib/utils";
import {
  MENU_ITEM,
  MENU_ITEM_DANGER,
  MENU_ITEM_DEFAULT,
  MENU_LABEL,
  MENU_SEPARATOR,
} from "@/components/ui/menu";
import type { ActionSheetItem } from "@/components/ui/action-sheet";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  MenuItemRows,
  type ContextMenuItem,
} from "@/components/chat/ContextMenu";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { Icon } from "@/components/ui/icon";
import React, { memo, useCallback, useMemo } from "react";

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
        <p className="mb-2 flex items-baseline justify-between gap-2 text-ui-xs font-medium text-ink-2">
          <span className="truncate">{label}</span>
          <span className="shrink-0 text-num-xs text-ink-3">{value}%</span>
        </p>
        <div className="relative h-1 rounded-full bg-tint-2">
          {/* The fill scales instead of resizing (no width layout). */}
          <div
            className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-primary-fill"
            style={{ transform: `scaleX(${percent / 100})` }}
          />
          <div
            data-slot="slider-thumb"
            className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line-strong bg-ink-1 pointer-coarse:size-5"
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
        <span className="truncate text-ui-xs font-normal text-ink-2">
          <InlineEmojiText text={description} />
        </span>
      ) : null}
    </span>
  );
}

type MenuBlock =
  | { kind: "rows"; items: ContextMenuItem[] }
  | { kind: "slider"; entry: Extract<StreamMenuEntry, { type: "slider" }> }
  | { kind: "separator"; key: string };

/**
 * Desktop: the entries as `ContextMenuItem`s (the one item model), rendered
 * by `MenuItemRows`. Items and submenus become item rows (a toggle is a
 * `checked` row, a submenu carries its own rows as `submenu`). A slider is
 * custom inline content, not a row, so it splits the list: item runs on
 * either side render as their own `MenuItemRows`, with an explicit separator
 * wherever a divider falls.
 */
function toMenuBlocks(
  entries: StreamMenuEntry[],
  panelProps?: React.ComponentPropsWithoutRef<"div">,
): MenuBlock[] {
  const blocks: MenuBlock[] = [];
  let rows: ContextMenuItem[] = [];
  const flush = () => {
    if (rows.length > 0) blocks.push({ kind: "rows", items: rows });
    rows = [];
  };
  for (const entry of entries) {
    switch (entry.type) {
      case "divider":
        flush();
        blocks.push({ kind: "separator", key: entry.key });
        break;
      case "slider":
        flush();
        blocks.push({ kind: "slider", entry });
        break;
      case "submenu":
        rows.push({
          key: entry.key,
          label: entry.label,
          onClick: noop,
          closeOnClick: false,
          submenu: (
            <StreamMenuEntries
              entries={entry.entries}
              panelProps={panelProps}
            />
          ),
        });
        break;
      case "item":
        rows.push({
          key: entry.key,
          label: entry.label,
          subtitle: entry.description,
          onClick: entry.onSelect ?? noop,
          variant: entry.danger ? "danger" : "default",
          disabled: entry.disabled,
          // Rows never close the menu on their own: `onSelect` calls
          // `onClose` when the action should dismiss it.
          closeOnClick: false,
          checked: entry.checked,
          rightIcon: entry.checked === undefined ? entry.trailing : undefined,
        });
        break;
    }
  }
  flush();
  // No leading, trailing or doubled separators.
  return blocks.filter((block, index) => {
    if (block.kind !== "separator") return true;
    const previous = blocks[index - 1];
    const next = blocks[index + 1];
    return (
      previous !== undefined &&
      previous.kind !== "separator" &&
      next !== undefined
    );
  });
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
  const subPanelProps = useMemo(
    () => ({
      ...panelProps,
      className: cn(
        "max-w-[min(240px,var(--available-width))]",
        panelProps?.className,
      ),
    }),
    [panelProps],
  );
  const blocks = toMenuBlocks(entries, panelProps);
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "separator":
            return <DropdownMenuSeparator key={block.key} />;
          case "slider":
            return (
              <div
                key={block.entry.key}
                onKeyDown={(event) => {
                  if (SLIDER_KEYS.has(event.key)) event.stopPropagation();
                }}
              >
                <Slider
                  label={block.entry.label}
                  value={block.entry.value}
                  max={block.entry.max}
                  onChange={block.entry.onChange}
                />
              </div>
            );
          case "rows":
            return (
              <MenuItemRows
                key={block.items[0]?.key ?? index}
                items={block.items}
                panelProps={subPanelProps}
              />
            );
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
