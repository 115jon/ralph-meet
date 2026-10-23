import { cn } from "@/lib/utils";
import {
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_DANGER,
  MENU_ITEM_DANGER_ON,
  MENU_ITEM_DEFAULT,
  MENU_ITEM_DEFAULT_ON,
  MENU_PANEL,
  MENU_SEPARATOR,
} from "@/components/ui/menu";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { Icon, type IconName } from "@/components/ui/icon";
import React, { memo, useCallback, useEffect, useRef } from "react";

export const Divider = memo(() => <div className={MENU_SEPARATOR} />);
Divider.displayName = "Divider";

export interface MenuItemProps {
  label: string;

  icon?: IconName;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onArrowLeft?: () => void;
  danger?: boolean;
  checked?: boolean;
  checkVariant?: "default" | "danger";

  checkIcon?: IconName;
  hasSubmenu?: boolean;
  description?: string;
  boldLabel?: boolean;
  rightElement?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}

function getSiblingMenuItems(element: HTMLElement): HTMLElement[] {
  const menu = element.closest<HTMLElement>('[role="menu"]');
  if (!menu) return [];
  return Array.from(
    menu.querySelectorAll<HTMLElement>("[data-menu-item]:not([disabled])"),
  ).filter((item) => item.closest('[role="menu"]') === menu);
}

export const MenuItem = memo(
  ({
    label,
    icon,
    onClick,
    onMouseEnter,
    danger,
    checked,
    checkVariant = "default",
    checkIcon = "check",
    hasSubmenu,
    description,
    boldLabel,
    rightElement,
    active,
    disabled,
  }: MenuItemProps) => {
    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      const siblings = getSiblingMenuItems(event.currentTarget);
      const currentIndex = siblings.indexOf(event.currentTarget);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        siblings[
          (currentIndex + direction + siblings.length) % siblings.length
        ]?.focus();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        siblings[event.key === "Home" ? 0 : siblings.length - 1]?.focus();
      } else if (event.key === "ArrowRight" && hasSubmenu) {
        event.preventDefault();
        const parent = event.currentTarget.parentElement;
        onMouseEnter?.();
        window.requestAnimationFrame(() => {
          parent
            ?.querySelector<HTMLElement>(
              '[role="menu"] [data-menu-item]:not([disabled])',
            )
            ?.focus();
        });
      }
    };

    return (
      <button
        type="button"
        role="menuitem"
        data-menu-item="true"
        aria-disabled={disabled || undefined}
        aria-haspopup={hasSubmenu ? "menu" : undefined}
        aria-expanded={hasSubmenu ? active : undefined}
        onMouseEnter={disabled ? undefined : onMouseEnter}
        onKeyDown={handleKeyDown}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onClick?.();
        }}
        disabled={disabled}
        className={cn(
          MENU_ITEM,
          "shrink-0 justify-between",
          danger ? MENU_ITEM_DANGER : MENU_ITEM_DEFAULT,
          active && (danger ? MENU_ITEM_DANGER_ON : MENU_ITEM_DEFAULT_ON),
          disabled && "pointer-events-none",
        )}
      >
        <div className="flex items-center gap-2.5 overflow-hidden">
          {icon && (
            <Icon
              name={icon}
              size="sm"
              className={danger ? "shrink-0" : MENU_ICON}
            />
          )}
          <div className="flex flex-col overflow-hidden">
            <span
              className={cn(
                "truncate text-ui-sm",
                boldLabel ? "font-bold" : "font-medium",
              )}
            >
              <InlineEmojiText text={label} />
            </span>
            {description && (
              <span className="truncate text-ui-2xs text-rm-text-muted">
                <InlineEmojiText text={description} />
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rightElement}
          {checked !== undefined && (
            <div
              className={cn(
                "flex size-4 items-center justify-center rounded-xs border",
                checked
                  ? checkVariant === "danger"
                    ? "border-rm-danger bg-rm-danger text-rm-on-danger"
                    : "border-primary bg-primary text-primary-foreground"
                  : "border-rm-field-edge",
              )}
            >
              {checked && <Icon name={checkIcon} size="xs" />}
            </div>
          )}
          {hasSubmenu && (
            <Icon
              name="chevronRight"
              size="xs"
              className="text-rm-text-muted"
            />
          )}
        </div>
      </button>
    );
  },
);
MenuItem.displayName = "MenuItem";

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

    return (
      <div className="shrink-0 px-2 py-2" onMouseEnter={onMouseEnter}>
        <p className="mb-2 text-ui-xs font-semibold text-rm-text">{label}</p>
        <div className="group/slider relative h-1 rounded-full bg-rm-bg-primary">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary transition-ui"
            style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
          />
          <div
            className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-rm-border bg-rm-bg-surface opacity-0 shadow-lg transition-opacity pointer-fine:group-hover/slider:opacity-100"
            style={{
              left: `calc(${Math.min(100, (value / max) * 100)}% - 6px)`,
            }}
          />
          <input
            type="range"
            min="0"
            max={max}
            step="1"
            value={value}
            aria-label={label}
            onChange={handleChange}
            className="absolute inset-0 z-10 w-full h-full cursor-pointer opacity-0"
          />
        </div>
      </div>
    );
  },
);
Slider.displayName = "Slider";

interface SubMenuProps {
  children: React.ReactNode;
  active: boolean;
  onMouseEnter: () => void;
  onEscape?: () => void;
}

export const SubMenu = memo(
  ({ children, active, onMouseEnter, onEscape }: SubMenuProps) => {
    const submenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!active) return;
      const frameId = window.requestAnimationFrame(() => {
        const firstEnabledItem = submenuRef.current?.querySelector<HTMLElement>(
          '[role="menuitem"]:not([disabled])',
        );
        (firstEnabledItem ?? submenuRef.current)?.focus();
      });
      return () => window.cancelAnimationFrame(frameId);
    }, [active]);

    if (!active) return null;

    return (
      <div
        ref={submenuRef}
        role="menu"
        tabIndex={-1}
        onMouseEnter={onMouseEnter}
        onKeyDown={(event) => {
          if (event.key !== "Escape" && event.key !== "ArrowLeft") return;
          event.preventDefault();
          event.stopPropagation();
          onEscape?.();
          submenuRef.current?.parentElement
            ?.querySelector<HTMLElement>(
              '[data-menu-item][aria-haspopup="menu"]',
            )
            ?.focus();
        }}
        className={cn(
          "absolute left-[calc(100%+4px)] top-0 z-80 flex max-h-[70dvh] w-[200px] flex-col overflow-y-auto animate-in fade-in no-scrollbar",
          MENU_PANEL,
        )}
      >
        <div className="absolute top-0 bottom-0 -left-4 w-4" />
        {children}
      </div>
    );
  },
);
SubMenu.displayName = "SubMenu";

interface SubMenuItemProps extends MenuItemProps {
  submenu: React.ReactNode;
  active: boolean;
  onMouseEnter: () => void;
}

export const SubMenuItem = memo(
  ({
    submenu,
    active,
    onMouseEnter,
    onArrowLeft,
    ...props
  }: SubMenuItemProps) => (
    <div className="relative flex flex-col">
      <MenuItem
        {...props}
        hasSubmenu
        active={active}
        onMouseEnter={onMouseEnter}
      />
      <SubMenu
        active={active}
        onMouseEnter={onMouseEnter}
        onEscape={onArrowLeft}
      >
        {submenu}
      </SubMenu>
    </div>
  ),
);
SubMenuItem.displayName = "SubMenuItem";
