import { useMounted } from "@/hooks/useMounted";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { ActionSheet } from "@/components/ui/action-sheet";
import { cn } from "@/lib/utils";
import {
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_DANGER,
  MENU_ITEM_DANGER_ON,
  MENU_ITEM_DEFAULT,
  MENU_ITEM_DEFAULT_ON,
  MENU_ITEM_WARNING,
  MENU_ITEM_WARNING_ON,
  MENU_PANEL,
  MENU_SEPARATOR,
} from "@/components/ui/menu";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  key?: string;
  label: string;
  subtitle?: string;
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger" | "warning";
  divider?: boolean;
  disabled?: boolean;
  submenu?: React.ReactNode;
  closeOnClick?: boolean;
}

interface ContextMenuProps {
  isClosing?: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  topContent?: React.ReactNode;
  onClose: () => void;
}

function getDirectMenuItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
  ).filter((item) => item.closest('[role="menu"]') === menu);
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
    <PopoverContextMenu {...props} />
  );
}

function ContextActionSheet({ items, topContent, onClose }: ContextMenuProps) {
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
    />
  );
}

function PopoverContextMenu({
  x,
  y,
  items,
  topContent,
  onClose,
  isClosing,
}: ContextMenuProps) {
  const mounted = useMounted();
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const submenuAnchorRectRef = useRef<DOMRect | null>(null);
  const submenuTriggerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [coords, setCoords] = useState({ x, y });
  const [activeSubmenuKey, setActiveSubmenuKey] = useState<string | null>(null);
  const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({});
  const menuContextInitializedRef = useRef(false);

  useEffect(() => {
    if (!mounted) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return () => {
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;

    // Close on click outside
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Close on escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    let timeout: NodeJS.Timeout;
    // Adjust position if it goes off screen
    if (panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      const padding = 10;
      let nextX = x;
      let nextY = y;

      if (x + rect.width > window.innerWidth - padding) {
        nextX = x - rect.width;
      }
      if (y + rect.height > window.innerHeight - padding) {
        nextY = y - rect.height;
      }

      timeout = setTimeout(() => {
        setCoords({ x: Math.max(padding, nextX), y: Math.max(padding, nextY) });
      }, 0);
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);

    // Global context menu prevention
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu);

    return () => {
      if (timeout) clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [mounted, x, y, onClose]);

  useEffect(() => {
    if (!mounted) return;
    if (!menuContextInitializedRef.current) {
      menuContextInitializedRef.current = true;
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      submenuAnchorRectRef.current = null;
      submenuTriggerRef.current = null;
      setSubmenuStyle({});
      setActiveSubmenuKey(null);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [items, mounted, x, y]);

  useEffect(() => {
    if (!mounted) return;
    const activeSubmenuAnchorRect = submenuAnchorRectRef.current;
    if (!activeSubmenuKey || !activeSubmenuAnchorRect) {
      return;
    }

    const updateSubmenuPosition = () => {
      const padding = 10;
      const gap = 8;
      const submenuWidth = submenuRef.current?.offsetWidth ?? 220;
      const submenuHeight = submenuRef.current?.offsetHeight ?? 0;
      let left = activeSubmenuAnchorRect.right - coords.x + gap;

      if (
        activeSubmenuAnchorRect.right + gap + submenuWidth >
        window.innerWidth - padding
      ) {
        left = activeSubmenuAnchorRect.left - coords.x - submenuWidth - gap;
      }

      let top = activeSubmenuAnchorRect.top - coords.y - 4;
      const minTop = padding - coords.y;
      const maxTop = window.innerHeight - padding - submenuHeight - coords.y;

      if (submenuHeight > 0) {
        top = Math.min(Math.max(top, minTop), Math.max(minTop, maxTop));
      }

      setSubmenuStyle({ left, top });
    };

    const frameId = window.requestAnimationFrame(updateSubmenuPosition);
    window.addEventListener("resize", updateSubmenuPosition);

    return () => {
      window.removeEventListener("resize", updateSubmenuPosition);
      window.cancelAnimationFrame(frameId);
    };
  }, [activeSubmenuKey, coords.x, coords.y, mounted]);

  useEffect(() => {
    if (!mounted) return;
    getDirectMenuItems(menuRef.current)[0]?.focus();
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !activeSubmenuKey) return;
    const frameId = window.requestAnimationFrame(() => {
      submenuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeSubmenuKey, mounted]);

  const closeSubmenu = () => {
    const parentItem = submenuTriggerRef.current;
    setActiveSubmenuKey(null);
    submenuAnchorRectRef.current = null;
    submenuTriggerRef.current = null;
    setSubmenuStyle({});
    parentItem?.focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const currentMenu =
      target?.closest<HTMLElement>('[role="menu"]') ?? menuRef.current;
    const menuItems = getDirectMenuItems(currentMenu);
    const eventTargetIndex = menuItems.indexOf(event.target as HTMLElement);
    const currentIndex =
      eventTargetIndex >= 0
        ? eventTargetIndex
        : menuItems.indexOf(
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : menuItems[0],
          );

    if (
      event.key === "Escape" &&
      activeSubmenuKey &&
      currentMenu !== menuRef.current
    ) {
      event.preventDefault();
      event.stopPropagation();
      closeSubmenu();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (currentIndex + direction + menuItems.length) % menuItems.length;
      menuItems[nextIndex]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      menuItems[event.key === "Home" ? 0 : menuItems.length - 1]?.focus();
    } else if (event.key === "ArrowRight" && currentMenu === menuRef.current) {
      const currentItem = items[currentIndex];
      if (currentItem?.submenu) {
        event.preventDefault();
        submenuAnchorRectRef.current =
          menuItems[currentIndex]?.getBoundingClientRect() ?? null;
        submenuTriggerRef.current = menuItems[currentIndex] ?? null;
        setActiveSubmenuKey(currentItem.key ?? currentItem.label);
      }
    } else if (event.key === "ArrowLeft" && activeSubmenuKey) {
      event.preventDefault();
      closeSubmenu();
    }
  };

  const activeSubmenuItem = activeSubmenuKey
    ? items.find(
        (item) => (item.key ?? item.label) === activeSubmenuKey && item.submenu,
      )
    : undefined;

  if (!mounted) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-70 min-w-[220px] origin-top-left overflow-visible",
        isClosing
          ? "animate-out fade-out zoom-out-[0.97] duration-100"
          : "animate-in fade-in zoom-in-[0.97] duration-150",
      )}
      style={{ top: coords.y, left: coords.x }}
      role="menu"
      tabIndex={-1}
      onKeyDown={handleMenuKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      onMouseLeave={() => {
        setActiveSubmenuKey(null);
        submenuAnchorRectRef.current = null;
        submenuTriggerRef.current = null;
        setSubmenuStyle({});
      }}
    >
      <div ref={panelRef} className={cn("overflow-hidden", MENU_PANEL)}>
        <div className="flex flex-col">
          {topContent ? (
            <div className="-mx-1 mb-1 border-b border-rm-border px-1 pb-1">
              {topContent}
            </div>
          ) : null}
          {items.map((item) => {
            const itemKey = item.key ?? item.label;
            const isSubmenuOpen =
              activeSubmenuKey === itemKey && Boolean(item.submenu);

            return (
              <React.Fragment key={itemKey}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  aria-haspopup={item.submenu ? "menu" : undefined}
                  aria-expanded={item.submenu ? isSubmenuOpen : undefined}
                  onMouseEnter={(event) => {
                    if (item.submenu) {
                      submenuAnchorRectRef.current =
                        event.currentTarget.getBoundingClientRect();
                      submenuTriggerRef.current = event.currentTarget;
                      setActiveSubmenuKey(itemKey);
                      return;
                    }

                    if (activeSubmenuKey) {
                      setActiveSubmenuKey(null);
                      submenuAnchorRectRef.current = null;
                      setSubmenuStyle({});
                    }
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (item.disabled) return;

                    if (item.submenu) {
                      submenuAnchorRectRef.current =
                        event.currentTarget.getBoundingClientRect();
                      submenuTriggerRef.current = event.currentTarget;
                      setActiveSubmenuKey((current) =>
                        current === itemKey ? null : itemKey,
                      );
                      item.onClick();
                      if (item.closeOnClick) {
                        onClose();
                      }
                      return;
                    }

                    item.onClick();
                    if (item.closeOnClick ?? true) {
                      onClose();
                    }
                  }}
                  className={cn(
                    MENU_ITEM,
                    "justify-between",
                    item.disabled ? "text-rm-text-muted" : "cursor-pointer",
                    !item.disabled &&
                      (item.variant === "danger"
                        ? isSubmenuOpen
                          ? MENU_ITEM_DANGER_ON
                          : MENU_ITEM_DANGER
                        : item.variant === "warning"
                          ? isSubmenuOpen
                            ? MENU_ITEM_WARNING_ON
                            : MENU_ITEM_WARNING
                          : isSubmenuOpen
                            ? MENU_ITEM_DEFAULT_ON
                            : MENU_ITEM_DEFAULT),
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {item.icon ? (
                      <span
                        aria-hidden
                        className={cn(
                          "shrink-0",
                          !item.variant || item.variant === "default"
                            ? MENU_ICON
                            : undefined,
                          isSubmenuOpen && "text-current",
                        )}
                      >
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{item.label}</span>
                      {item.subtitle ? (
                        <span className="text-ui-2xs font-normal text-rm-text-muted">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {item.rightIcon ? (
                    <span className={cn("ml-2 shrink-0 text-rm-text-muted")}>
                      {item.rightIcon}
                    </span>
                  ) : null}
                </button>
                {item.divider ? <div className={MENU_SEPARATOR} /> : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      {activeSubmenuItem?.submenu ? (
        <div
          ref={submenuRef}
          role="menu"
          aria-label={`${activeSubmenuItem.label} submenu`}
          className={cn("absolute z-80 w-52 overflow-hidden", MENU_PANEL)}
          style={submenuStyle}
        >
          {activeSubmenuItem.submenu}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
