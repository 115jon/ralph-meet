
import { cn } from "@/lib/utils";
import { Check, ChevronRight } from "lucide-react";
import React, { memo, useCallback } from "react";

export const Divider = memo(() => <div className="mx-1 my-1 h-px shrink-0 bg-rm-border" />);
Divider.displayName = "Divider";

export interface MenuItemProps {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: any;
  onClick?: () => void;
  onMouseEnter?: () => void;
  danger?: boolean;
  checked?: boolean;
  checkVariant?: "default" | "danger";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CheckIcon?: any;
  hasSubmenu?: boolean;
  description?: string;
  boldLabel?: boolean;
  rightElement?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}

export const MenuItem = memo(({
  label,
  icon: Icon,
  onClick,
  onMouseEnter,
  danger,
  checked,
  checkVariant = "default",
  CheckIcon = Check,
  hasSubmenu,
  description,
  boldLabel,
  rightElement,
  active,
  disabled
}: MenuItemProps) => (
  <button
    onMouseEnter={disabled ? undefined : onMouseEnter}
    onClick={(e) => {
      e.stopPropagation();
      if (!disabled) onClick?.();
    }}
    disabled={disabled}
    className={cn(
      "group flex w-full shrink-0 items-center justify-between rounded-sm px-2 py-1.5 text-left transition-colors font-medium",
      danger
        ? "text-destructive hover:bg-destructive hover:text-destructive-foreground"
        : "text-rm-text-secondary hover:bg-primary hover:text-primary-foreground",
      active && (danger ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"),
      disabled && "pointer-events-none cursor-not-allowed grayscale opacity-30"
    )}
  >
    <div className="flex items-center gap-2 overflow-hidden">
      {Icon && <Icon size={14} className="shrink-0 opacity-60 group-hover:opacity-100" />}
      <div className="flex flex-col overflow-hidden">
        <span className={cn("truncate text-sm", boldLabel ? "font-bold" : "font-medium")}>{label}</span>
        {description && <span className="truncate text-[10px] leading-tight text-rm-text-muted group-hover:primary-foreground/60">{description}</span>}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {rightElement}
      {checked !== undefined && (
        <div className={cn(
          "flex h-4 w-4 items-center justify-center rounded border transition-colors",
          checked
            ? (checkVariant === "danger" ? "border-destructive bg-destructive" : "border-primary bg-primary")
            : "border-rm-border group-hover:border-rm-text-muted/40"
        )}>
          {checked && <CheckIcon size={12} className="text-white" />}
        </div>
      )}
      {hasSubmenu && <ChevronRight size={14} className="opacity-40" />}
    </div>
  </button>
));
MenuItem.displayName = "MenuItem";

export const Slider = memo(({
  label,
  value,
  max = 200,
  onChange,
  onMouseEnter
}: {
  label: string,
  value: number,
  max?: number,
  onChange: (val: number) => void,
  onMouseEnter?: () => void
}) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseInt(e.target.value));
  }, [onChange]);

  return (
    <div className="shrink-0 px-2 py-2" onMouseEnter={onMouseEnter}>
      <p className="mb-2 text-xs font-bold text-rm-text">{label}</p>
      <div className="group/slider relative h-1 rounded-full bg-rm-bg-primary">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-rm-border bg-rm-bg-surface opacity-0 shadow-lg transition-opacity group-hover/slider:opacity-100"
          style={{ left: `calc(${Math.min(100, (value / max) * 100)}% - 6px)` }}
        />
        <input
          type="range"
          min="0"
          max={max}
          step="1"
          value={value}
          onChange={handleChange}
          className="absolute inset-0 z-10 w-full h-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
});
Slider.displayName = "Slider";

interface SubMenuProps {
  children: React.ReactNode;
  active: boolean;
  onMouseEnter: () => void;
}

export const SubMenu = memo(({ children, active, onMouseEnter }: SubMenuProps) => {
  if (!active) return null;

  return (
    <div
      onMouseEnter={onMouseEnter}
      className="absolute left-[calc(100%+4px)] top-0 z-[10001] flex max-h-[70vh] w-[200px] flex-col overflow-y-auto rounded-lg border border-rm-border bg-rm-bg-elevated p-1 shadow-2xl backdrop-blur-xl transition-all duration-200 animate-in fade-in slide-in-from-left-2 no-scrollbar"
    >
      <div className="absolute top-0 bottom-0 -left-4 w-4" />
      {children}
    </div>
  );
});
SubMenu.displayName = "SubMenu";

interface SubMenuItemProps extends MenuItemProps {
  submenu: React.ReactNode;
  active: boolean;
  onMouseEnter: () => void;
}

export const SubMenuItem = memo(({ submenu, active, onMouseEnter, ...props }: SubMenuItemProps) => (
  <div className="relative flex flex-col">
    <MenuItem
      {...props}
      hasSubmenu
      active={active}
      onMouseEnter={onMouseEnter}
    />
    <SubMenu active={active} onMouseEnter={onMouseEnter}>
      {submenu}
    </SubMenu>
  </div>
));
SubMenuItem.displayName = "SubMenuItem";
