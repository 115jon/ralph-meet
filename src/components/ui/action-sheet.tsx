"use client";

/**
 * The phone form of a context menu: a bottom drawer of 48px rows, opened by a
 * long press (see useLongPressMenu) or the same right-click/contextmenu path
 * desktop uses. Takes the context-menu item model as is, so a menu builds its
 * items once and renders as a popover on desktop and a sheet on phones.
 */

import * as React from "react";

import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export interface ActionSheetItem {
  key?: string;
  label: string;
  subtitle?: string;
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger" | "warning";
  /** Starts a new group after this row. */
  divider?: boolean;
  disabled?: boolean;
  /** Extra controls for this row; shown inline when the row is tapped. */
  submenu?: React.ReactNode;
  closeOnClick?: boolean;
  /**
   * A toggle row: `true` / `false` is its state (a menu item checkbox on
   * desktop, a check on the right with `aria-pressed` on phones).
   */
  checked?: boolean;
}

interface ActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ActionSheetItem[];
  /** Accessible name; visually hidden unless `showTitle`. */
  title?: string;
  showTitle?: boolean;
  /** Content above the rows, such as a quick-reaction strip. */
  header?: React.ReactNode;
}

const ROW =
  "group flex min-h-12 w-full items-center gap-3 px-4 text-left text-ui-base font-medium outline-none select-none [-webkit-tap-highlight-color:transparent] transition-[background-color] duration-(--dur-1) ease-out focus-visible:bg-tint-2 active:bg-tint-2 disabled:opacity-45";

const INK = {
  default: "text-ink-1",
  danger: "text-danger-ink",
  warning: "text-warning-ink",
} as const;

/**
 * Split the flat item list into groups at each `divider`. Danger rows always
 * end up in their own last group (overlays §3b), whatever order the menu
 * built them in.
 */
export function groupActionSheetItems(items: ActionSheetItem[]) {
  const groups: ActionSheetItem[][] = [[]];
  const danger: ActionSheetItem[] = [];
  for (const item of items) {
    // Label-less items are spacers some desktop menus use for a divider.
    if (item.label) {
      if (item.variant === "danger") danger.push(item);
      else groups[groups.length - 1]!.push(item);
    }
    if (item.divider) groups.push([]);
  }
  return [...groups, danger].filter((group) => group.length > 0);
}

export function ActionSheet({
  open,
  onOpenChange,
  items,
  title = "Actions",
  showTitle = false,
  header,
}: ActionSheetProps) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const groups = groupActionSheetItems(items);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) setExpanded(null);
        onOpenChange(next);
      }}
    >
      <DrawerContent data-slot="action-sheet" className="gap-0">
        <DrawerTitle
          className={cn(
            showTitle
              ? "px-4 pt-1 pb-2 text-ui-sm font-semibold text-ink-2"
              : "sr-only",
          )}
        >
          {title}
        </DrawerTitle>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">
          {header ? <div className="px-3 pt-1 pb-3">{header}</div> : null}
          {groups.map((group, groupIndex) => (
            <ul
              key={groupIndex}
              className={cn(
                "mx-3 overflow-hidden rounded-xl bg-tint-1",
                groupIndex > 0 && "mt-2",
              )}
            >
              {group.map((item, index) => {
                const key = item.key ?? item.label;
                const isOpen = expanded === key;
                return (
                  <li
                    key={key}
                    // Dividers start at the label (16 inset + 20 icon + 12
                    // gap = 48, plus the 4px optical inset), not full bleed.
                    className={cn(
                      index > 0 &&
                        "relative before:absolute before:inset-x-0 before:top-0 before:ms-13 before:h-px before:bg-line",
                    )}
                  >
                    <button
                      type="button"
                      disabled={item.disabled}
                      aria-expanded={item.submenu ? isOpen : undefined}
                      aria-pressed={item.submenu ? undefined : item.checked}
                      className={cn(ROW, INK[item.variant ?? "default"])}
                      onClick={() => {
                        if (item.submenu) {
                          setExpanded(isOpen ? null : key);
                          if (!item.closeOnClick) return;
                        }
                        item.onClick();
                        if (item.closeOnClick ?? true) onOpenChange(false);
                      }}
                    >
                      {item.icon ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center [&_svg]:size-5",
                            item.variant && item.variant !== "default"
                              ? "text-current"
                              : "text-ink-2",
                          )}
                        >
                          {item.icon}
                        </span>
                      ) : null}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{item.label}</span>
                        {item.subtitle ? (
                          <span className="truncate text-ui-xs font-normal text-ink-2">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {item.submenu ? (
                        <Icon
                          name={isOpen ? "chevronUp" : "chevronDown"}
                          size="xs"
                          className="shrink-0 text-ink-3"
                        />
                      ) : item.checked ? (
                        <Icon
                          name="check"
                          size="sm"
                          className="shrink-0 text-ink-1"
                        />
                      ) : item.rightIcon ? (
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-ink-3"
                        >
                          {item.rightIcon}
                        </span>
                      ) : null}
                    </button>
                    {item.submenu && isOpen ? (
                      <div className="border-t border-line px-2 py-2">
                        {item.submenu}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
