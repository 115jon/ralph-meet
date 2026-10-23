"use client";

/**
 * Menu on Base UI (design-system 12.7): portalled `MENU_PANEL` at z-50 with
 * `MENU_ITEM` rows, roving focus, typeahead and submenus that flip to the
 * other side when there is no room. Joins the dialog stack like
 * ui/popover.tsx (Escape/back close the topmost surface, focus returns to the
 * trigger, a Radix dialog underneath is left alone).
 *
 *   <DropdownMenu>
 *     <DropdownMenuTrigger render={<IconButton icon="more" aria-label="More" />} />
 *     <DropdownMenuContent align="end">
 *       <DropdownMenuItem onClick={copy}>Copy link</DropdownMenuItem>
 *       <DropdownMenuSeparator />
 *       <DropdownMenuItem variant="danger" onClick={remove}>Delete</DropdownMenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 *
 * Phones use the `ActionSheet` with the same item model instead (13.1).
 */

import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { FocusScope } from "@radix-ui/react-focus-scope";

import { isDialogTopmost } from "@/components/ui/dialog-stack";
import { Icon } from "@/components/ui/icon";
import {
  MENU_ICON,
  MENU_ITEM,
  MENU_LABEL,
  MENU_PANEL,
  MENU_SEPARATOR,
} from "@/components/ui/menu";
import { FLOATING_LAYER_ATTR } from "@/components/ui/popover";
import { useDialogBackButton } from "@/hooks/useBackButton";
import { cn } from "@/lib/utils";

type DropdownMenuContextValue = {
  id: string;
  /** DropdownMenuContent reports its `anchor` element (null on unmount). */
  setAnchor: (element: Element | null) => void;
};
const DropdownMenuContext =
  React.createContext<DropdownMenuContextValue | null>(null);

type DropdownMenuProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Base UI default is modal (outside pointer events blocked while open). */
  modal?: boolean;
  children?: React.ReactNode;
};

function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  modal,
  children,
}: DropdownMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    () => defaultOpen ?? false,
  );
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const id = React.useId();
  const anchorRef = React.useRef<Element | null>(null);
  const setAnchor = React.useCallback((element: Element | null) => {
    anchorRef.current = element;
  }, []);

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  useDialogBackButton(
    isOpen,
    () => setOpen(false),
    () => isDialogTopmost(id),
  );

  const contextValue = React.useMemo(
    () => ({ id, setAnchor }),
    [id, setAnchor],
  );

  return (
    <DropdownMenuContext.Provider value={contextValue}>
      <MenuPrimitive.Root
        open={isOpen}
        modal={modal}
        onOpenChange={(nextOpen, details) => {
          if (
            !nextOpen &&
            details.reason === "escape-key" &&
            !isDialogTopmost(id)
          ) {
            details.cancel();
            return;
          }
          if (
            !nextOpen &&
            details.reason === "outside-press" &&
            details.event.target instanceof Node &&
            anchorRef.current?.contains(details.event.target)
          ) {
            // The anchor (not a Base UI trigger) toggles the menu itself;
            // closing here first would let its click reopen it.
            details.cancel();
            return;
          }
          setOpen(nextOpen);
        }}
      >
        {children}
      </MenuPrimitive.Root>
    </DropdownMenuContext.Provider>
  );
}

const DropdownMenuTrigger = MenuPrimitive.Trigger;
const DropdownMenuGroup = MenuPrimitive.Group;
const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;
const DropdownMenuSub = MenuPrimitive.SubmenuRoot;

type Anchor = MenuPrimitive.Positioner.Props["anchor"];

function anchorElement(anchor: Anchor | undefined): Element | null {
  if (!anchor) return null;
  if (anchor instanceof Element) return anchor;
  if (typeof anchor === "function") {
    const resolved = anchor();
    return resolved instanceof Element ? resolved : null;
  }
  if ("current" in anchor) {
    return anchor.current instanceof Element ? anchor.current : null;
  }
  return null;
}

/** A point anchor (context menus opened at the pointer). */
export function pointAnchor(x: number, y: number): NonNullable<Anchor> {
  return {
    getBoundingClientRect: () =>
      ({
        x,
        y,
        left: x,
        top: y,
        right: x,
        bottom: y,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  };
}

type PanelProps = Omit<
  React.ComponentPropsWithoutRef<"div">,
  "className" | "style"
> & {
  className?: string;
  style?: React.CSSProperties;
  side?: MenuPrimitive.Positioner.Props["side"];
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: number;
  alignOffset?: number;
  anchor?: Anchor;
  /** Opened from a dialog: the stacked layer (z-60). */
  stacked?: boolean;
  finalFocus?: MenuPrimitive.Popup.Props["finalFocus"];
};

const PANEL_MOTION =
  "origin-(--transform-origin) transition-[opacity,scale] duration-180 ease-(--rm-ease-out) data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-120 data-starting-style:scale-[0.97] data-starting-style:opacity-0 motion-reduce:transition-opacity";

function MenuPanel({
  className,
  style,
  side,
  align,
  sideOffset,
  alignOffset = 0,
  anchor,
  stacked = false,
  finalFocus,
  children,
  isSubmenu = false,
  ...props
}: PanelProps & { isSubmenu?: boolean }) {
  const context = React.useContext(DropdownMenuContext);
  const setAnchor = isSubmenu ? undefined : context?.setAnchor;
  React.useLayoutEffect(() => {
    if (!setAnchor) return;
    setAnchor(anchorElement(anchor));
    return () => setAnchor(null);
  });
  return (
    <MenuPrimitive.Portal
      {...{ [FLOATING_LAYER_ATTR]: "" }}
      className="pointer-events-auto"
    >
      <MenuPrimitive.Positioner
        side={side ?? (isSubmenu ? "inline-end" : "bottom")}
        align={align ?? "start"}
        sideOffset={sideOffset ?? (isSubmenu ? 4 : 6)}
        alignOffset={alignOffset}
        collisionPadding={8}
        anchor={anchor}
        className={cn(stacked ? "z-60" : "z-50", "outline-none")}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          data-dialog-root-id={isSubmenu ? undefined : context?.id}
          data-dialog-back-enabled={isSubmenu ? undefined : "true"}
          finalFocus={finalFocus}
          className={cn(
            MENU_PANEL,
            "flex max-h-(--available-height) w-max max-w-[min(280px,var(--available-width))] min-w-[180px] flex-col overflow-y-auto text-rm-text outline-none",
            PANEL_MOTION,
            className,
          )}
          style={style}
          {...props}
        >
          <FocusScope asChild>
            <div className="contents">{children}</div>
          </FocusScope>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuContent(props: PanelProps) {
  return <MenuPanel {...props} />;
}

function DropdownMenuSubContent(props: PanelProps) {
  return <MenuPanel {...props} isSubmenu />;
}

const ITEM_INK = {
  default:
    "text-rm-text data-highlighted:bg-rm-tint-2 data-[popup-open]:bg-rm-tint-2",
  danger: "text-rm-danger-ink data-highlighted:bg-rm-danger-tint",
  warning:
    "text-rm-warning-ink data-highlighted:bg-[color-mix(in_oklab,var(--rm-warning-ink)_14%,transparent)]",
} as const;

type ItemVariant = keyof typeof ITEM_INK;

const ITEM_BASE = cn(
  MENU_ITEM,
  "cursor-default data-disabled:cursor-default data-disabled:opacity-45",
);

type DropdownMenuItemProps = Omit<MenuPrimitive.Item.Props, "className"> & {
  className?: string;
  variant?: ItemVariant;
  /** Leading icon node (rendered in the muted icon slot). */
  icon?: React.ReactNode;
  /** Trailing hint (shortcut, value). */
  hint?: React.ReactNode;
};

function MenuRowContent({
  icon,
  hint,
  children,
}: {
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            MENU_ICON,
            "flex size-4 items-center justify-center [&_svg]:size-4",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? (
        <span className="shrink-0 text-ui-xs text-rm-text-muted">{hint}</span>
      ) : null}
    </>
  );
}

function DropdownMenuItem({
  className,
  variant = "default",
  icon,
  hint,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(ITEM_BASE, ITEM_INK[variant], className)}
      {...props}
    >
      <MenuRowContent icon={icon} hint={hint}>
        {children}
      </MenuRowContent>
    </MenuPrimitive.Item>
  );
}

function DropdownMenuSubTrigger({
  className,
  icon,
  hint,
  children,
  ...props
}: Omit<MenuPrimitive.SubmenuTrigger.Props, "className"> & {
  className?: string;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(ITEM_BASE, ITEM_INK.default, className)}
      {...props}
    >
      <MenuRowContent icon={icon} hint={hint}>
        {children}
      </MenuRowContent>
      <Icon
        name="chevronRight"
        size="xs"
        className="shrink-0 text-rm-text-muted rtl:rotate-180"
      />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function DropdownMenuRadioItem({
  className,
  icon,
  children,
  ...props
}: Omit<MenuPrimitive.RadioItem.Props, "className"> & {
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(ITEM_BASE, ITEM_INK.default, className)}
      {...props}
    >
      <MenuRowContent icon={icon}>{children}</MenuRowContent>
      <MenuPrimitive.RadioItemIndicator className="flex size-4 shrink-0 items-center justify-center text-rm-text">
        <Icon name="check" size="xs" />
      </MenuPrimitive.RadioItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}

function DropdownMenuCheckboxItem({
  className,
  icon,
  children,
  ...props
}: Omit<MenuPrimitive.CheckboxItem.Props, "className"> & {
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(ITEM_BASE, ITEM_INK.default, className)}
      {...props}
    >
      <MenuRowContent icon={icon}>{children}</MenuRowContent>
      <MenuPrimitive.CheckboxItemIndicator className="flex size-4 shrink-0 items-center justify-center text-rm-text">
        <Icon name="check" size="xs" />
      </MenuPrimitive.CheckboxItemIndicator>
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuSeparator({ className }: { className?: string }) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn(MENU_SEPARATOR, className)}
    />
  );
}

/** A section label. Put it inside a `DropdownMenuGroup`. */
function DropdownMenuLabel({
  className,
  ...props
}: Omit<MenuPrimitive.GroupLabel.Props, "className"> & {
  className?: string;
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn(MENU_LABEL, className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
