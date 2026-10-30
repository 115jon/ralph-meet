import { useIsMobile } from "@/hooks/useMediaQuery";
import { useMounted } from "@/hooks/useMounted";
import {
  ActionSheet,
  type ActionSheetItem,
} from "@/components/ui/action-sheet";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  pointAnchor,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * The one menu item model (overlays §3b): the same rows render as a Base UI
 * `DropdownMenu` on desktop (right-click, a point anchor) and as the
 * `ActionSheet` on phones. `ContextMenuItem` and `ActionSheetItem` are one
 * type.
 *
 *   icon       leading 16px glyph (a verb). Once any row has one, every row
 *              reserves the 16 column so labels share a left edge.
 *   rightIcon  trailing hint (a glyph or a short value), ink-3
 *   subtitle   a 12/16 second line; the row grows to 44
 *   divider    ends a group (a separator follows the row)
 *   submenu    content of a flyout submenu (desktop) or an inline expansion
 *              (phones). Desktop submenus open on hover intent with Base UI's
 *              safe triangle, or ArrowRight / Enter / Space.
 *   variant    "danger" rows are always moved into their own last group.
 *   checked    a toggle row (menu item checkbox on desktop, a check on phones)
 */
export type ContextMenuItem = ActionSheetItem;

interface ContextMenuProps {
  /** Kept for callers; the menu closes as soon as `onClose` runs. */
  isClosing?: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  topContent?: React.ReactNode;
  onClose: () => void;
  /** Accessible name of the menu (sheet title on phones). */
  label?: string;
}

/**
 * Right-click menu on desktop; on phones (below md) the same items as a bottom
 * action sheet with 48px rows, opened by long press (useLongPressMenu) or
 * Android's native long-press contextmenu.
 */
export default function ContextMenu(props: ContextMenuProps) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <ContextActionSheet {...props} />
  ) : (
    <PointContextMenu {...props} />
  );
}

function ContextActionSheet({
  items,
  topContent,
  onClose,
  label,
}: ContextMenuProps) {
  const [open, setOpen] = useState(true);
  // Owners unmount the menu on close; let the sheet slide away first.
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(onClose, 280);
    return () => window.clearTimeout(timer);
  }, [open, onClose]);

  return (
    <ActionSheet
      open={open}
      onOpenChange={setOpen}
      items={items}
      header={topContent}
      title={label}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Groups                                                               */
/* ------------------------------------------------------------------ */

/**
 * Splits the flat list into groups at each `divider` and moves every danger
 * row into a final group of its own, so destructive rows always sit last,
 * behind a separator, and are never the first (default-focused) row.
 */
export function groupMenuItems(items: ContextMenuItem[]): ContextMenuItem[][] {
  const groups: ContextMenuItem[][] = [[]];
  const danger: ContextMenuItem[] = [];
  for (const item of items) {
    if (item.label) {
      if (item.variant === "danger") danger.push(item);
      else groups[groups.length - 1]!.push(item);
    }
    if (item.divider) groups.push([]);
  }
  return [...groups, danger].filter((group) => group.length > 0);
}

/* ------------------------------------------------------------------ */
/* Rows                                                                 */
/* ------------------------------------------------------------------ */

function RowLabel({ item }: { item: ContextMenuItem }) {
  if (!item.subtitle) return <>{item.label}</>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{item.label}</span>
      <span className="truncate text-ui-xs font-normal text-ink-2">
        {item.subtitle}
      </span>
    </span>
  );
}

/**
 * A row with a flyout. Custom submenu content (a reaction strip, a slider)
 * isn't made of Base UI items, so Escape and ArrowLeft hand focus straight
 * back to the trigger row while Base UI closes one level.
 */
function SubmenuRow({
  item,
  icon,
  className,
  panelProps,
}: {
  item: ContextMenuItem;
  icon: React.ReactNode;
  className?: string;
  panelProps?: React.ComponentPropsWithoutRef<"div">;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        ref={triggerRef}
        icon={icon}
        disabled={item.disabled}
        onClick={() => item.onClick()}
        className={className}
      >
        <RowLabel item={item} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        {...panelProps}
        aria-label={`${item.label} submenu`}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "ArrowLeft") {
            triggerRef.current?.focus({ preventScroll: true });
          }
        }}
      >
        {item.submenu}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * Renders the item model as Base UI menu rows. Use inside a
 * `DropdownMenuContent`; ContextMenu uses it with a point anchor, and any
 * other desktop menu can render the same items. `panelProps` is spread on
 * every submenu panel (event isolation, data attributes, width).
 */
export function MenuItemRows({
  items,
  panelProps,
}: {
  items: ContextMenuItem[];
  panelProps?: React.ComponentPropsWithoutRef<"div">;
}) {
  const groups = useMemo(() => groupMenuItems(items), [items]);
  const reserveIcon = items.some((item) => Boolean(item.icon));
  const iconSlot = (item: ContextMenuItem) =>
    item.icon ?? (reserveIcon ? <span /> : undefined);

  return (
    <>
      {groups.map((group, groupIndex) => (
        <React.Fragment key={group[0]?.key ?? group[0]?.label ?? groupIndex}>
          {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
          {group.map((item) => {
            const key = item.key ?? item.label;
            const rowClass = cn(item.subtitle && "min-h-11");
            if (item.submenu) {
              return (
                <SubmenuRow
                  key={key}
                  item={item}
                  icon={iconSlot(item)}
                  className={rowClass}
                  panelProps={panelProps}
                />
              );
            }
            if (item.checked !== undefined) {
              return (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={item.checked}
                  icon={iconSlot(item)}
                  disabled={item.disabled}
                  closeOnClick={item.closeOnClick ?? true}
                  onCheckedChange={() => item.onClick()}
                  className={cn(
                    rowClass,
                    item.variant === "danger" && "text-danger-ink",
                  )}
                >
                  <RowLabel item={item} />
                </DropdownMenuCheckboxItem>
              );
            }
            return (
              <DropdownMenuItem
                key={key}
                variant={item.variant ?? "default"}
                icon={iconSlot(item)}
                hint={item.rightIcon}
                disabled={item.disabled}
                closeOnClick={item.closeOnClick ?? true}
                onClick={() => item.onClick()}
                className={rowClass}
              >
                <RowLabel item={item} />
              </DropdownMenuItem>
            );
          })}
        </React.Fragment>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop: DropdownMenu at the pointer                                 */
/* ------------------------------------------------------------------ */

/**
 * Focuses the menu's first enabled row as soon as the panel mounts (Base UI
 * would otherwise focus the list on its next frame), so the first arrow key
 * moves from row one. Renders nothing.
 */
function FocusFirstRow() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const menu = ref.current?.closest<HTMLElement>('[role="menu"]');
    menu
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
      ?.focus({ preventScroll: true });
  }, []);
  return <span ref={ref} hidden />;
}

function PointContextMenu({
  x,
  y,
  items,
  topContent,
  onClose,
  label,
}: ContextMenuProps) {
  const mounted = useMounted();
  const menuId = useId();
  const anchor = useMemo(() => pointAnchor(x, y), [x, y]);
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null,
  );

  // While open, the browser's own context menu stays shut everywhere: a
  // right-click elsewhere closes this one and lets its owner open the next.
  useEffect(() => {
    if (!mounted) return;
    const prevent = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", prevent);
    return () => window.removeEventListener("contextmenu", prevent);
  }, [mounted]);

  // Focus returns to whatever had it before the menu opened.
  useEffect(() => {
    if (!mounted) return;
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [mounted, opener]);

  if (!mounted) return null;

  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DropdownMenuContent
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={2}
        aria-label={label}
        finalFocus={false}
        data-rm-context-menu={menuId}
        // The first enabled row takes focus, so arrow keys work at once.
        initialFocus={() =>
          document.querySelector<HTMLElement>(
            `[data-rm-context-menu="${CSS.escape(menuId)}"] [role="menuitem"]:not([data-disabled])`,
          ) ?? true
        }
        onContextMenu={(event) => event.preventDefault()}
      >
        {topContent ? (
          <>
            <div className="px-1 pt-1 pb-1">{topContent}</div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <MenuItemRows items={items} />
        <FocusFirstRow />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
