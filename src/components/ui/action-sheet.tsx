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
  "group flex min-h-12 w-full items-center gap-3 px-4 text-left text-ui-base font-medium outline-none select-none [-webkit-tap-highlight-color:transparent] transition-[background-color] duration-150 ease-(--rm-ease-out) focus-visible:bg-rm-tint-2 active:bg-rm-tint-2 disabled:opacity-45";

const INK = {
  default: "text-rm-text",
  danger: "text-rm-danger-ink",
  warning: "text-rm-warning-ink",
} as const;

/** Split the flat item list into groups at each `divider`. */
function groupItems(items: ActionSheetItem[]) {
  const groups: ActionSheetItem[][] = [[]];
  for (const item of items) {
    // Label-less items are spacers some desktop menus use for a divider.
    if (item.label) groups[groups.length - 1]!.push(item);
    if (item.divider) groups.push([]);
  }
  return groups.filter((group) => group.length > 0);
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
  const groups = groupItems(items);

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
              ? "px-4 pt-1 pb-2 text-ui-sm font-semibold text-rm-text-secondary"
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
                "mx-3 overflow-hidden rounded-xl bg-rm-tint-1",
                groupIndex > 0 && "mt-2",
              )}
            >
              {group.map((item, index) => {
                const key = item.key ?? item.label;
                const isOpen = expanded === key;
                return (
                  <li
                    key={key}
                    className={cn(index > 0 && "border-t border-rm-border")}
                  >
                    <button
                      type="button"
                      disabled={item.disabled}
                      aria-expanded={item.submenu ? isOpen : undefined}
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
                              : "text-rm-text-secondary",
                          )}
                        >
                          {item.icon}
                        </span>
                      ) : null}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{item.label}</span>
                        {item.subtitle ? (
                          <span className="truncate text-ui-xs font-normal text-rm-text-secondary">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {item.submenu ? (
                        <Icon
                          name={isOpen ? "chevronUp" : "chevronDown"}
                          size="xs"
                          className="shrink-0 text-rm-text-muted"
                        />
                      ) : item.rightIcon ? (
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-rm-text-muted"
                        >
                          {item.rightIcon}
                        </span>
                      ) : null}
                    </button>
                    {item.submenu && isOpen ? (
                      <div className="border-t border-rm-border px-2 py-2">
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
