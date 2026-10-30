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

import {
  isDialogTopmost,
  KEYBOARD_PRESENCE_VARS,
  useOpenedByKeyboard,
  useOpenedOverModal,
} from "@/components/ui/dialog-stack";
import { Icon } from "@/components/ui/icon";
import {
  MENU_HINT,
  MENU_ICON,
  MENU_ITEM,
  MENU_LABEL,
  MENU_PANEL,
  MENU_SEPARATOR,
} from "@/components/ui/menu";
import { FLOATING_LAYER_ATTR } from "@/components/ui/popover";
import { useDialogBackButton } from "@/hooks/useBackButton";
import { cn } from "@/lib/utils";

const preventDefault = (event: Event) => event.preventDefault();

type DropdownMenuContextValue = {
  id: string;
  /** DropdownMenuContent reports its `anchor` element (null on unmount). */
  setAnchor: (element: Element | null) => void;
  /** Opened from the keyboard (Enter, Shift+F10, the context-menu key). */
  byKeyboard: boolean;
  /** Opened while a modal layer is open: the menus-over-modals layer (z-70). */
  overModal: boolean;
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
  const byKeyboard = useOpenedByKeyboard(isOpen);
  const overModal = useOpenedOverModal(isOpen);
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
    () => ({ id, setAnchor, byKeyboard, overModal }),
    [id, setAnchor, byKeyboard, overModal],
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
  /**
   * Element to focus on open (Base UI's popup focus manager). Context menus
   * opened at the pointer pass their first row so arrow keys work at once.
   */
  initialFocus?:
    | boolean
    | React.RefObject<HTMLElement | null>
    | (() => HTMLElement | boolean | null | undefined);
};

/** Presence (styles/motion.css): fade + scale from the anchor. */
const PANEL_MOTION = "rm-presence";

/**
 * Menu timing (overlays §3b): scale .96 -> 1 from the anchor over 140ms;
 * the exit is opacity only, 80ms. Submenus fade in 120ms from their trigger
 * row. motion.css reads these vars on the popup itself.
 */
const MENU_PRESENCE_VARS = {
  "--motion-scale-in": "0.96",
  "--motion-scale-out": "1",
  "--dur-3": "140ms",
  "--dur-3-exit": "80ms",
} as React.CSSProperties;
const SUBMENU_PRESENCE_VARS = {
  "--motion-scale-in": "0.98",
  "--motion-scale-out": "1",
  "--dur-3": "120ms",
  "--dur-3-exit": "80ms",
} as React.CSSProperties;

function MenuPanel({
  className,
  style,
  side,
  align,
  sideOffset,
  alignOffset,
  anchor,
  stacked = false,
  finalFocus,
  initialFocus,
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
        // Submenus sit 2px off the parent panel with their first row level
        // with the trigger row (panel padding 4 + border 1).
        sideOffset={sideOffset ?? (isSubmenu ? 2 : 6)}
        alignOffset={alignOffset ?? (isSubmenu ? -5 : 0)}
        collisionPadding={8}
        anchor={anchor}
        className={cn(
          context?.overModal ? "z-70" : stacked ? "z-60" : "z-50",
          "outline-none",
        )}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          data-dialog-root-id={isSubmenu ? undefined : context?.id}
          data-dialog-back-enabled={isSubmenu ? undefined : "true"}
          finalFocus={finalFocus}
          // Supported by Base UI's MenuPopup, not yet in its public types.
          {...(initialFocus === undefined
            ? null
            : ({ initialFocus } as object))}
          className={cn(
            MENU_PANEL,
            "flex max-h-(--available-height) w-max max-w-[min(280px,var(--available-width))] min-w-[200px] flex-col overflow-y-auto text-ink-1 outline-none",
            PANEL_MOTION,
            className,
          )}
          data-keyboard={context?.byKeyboard ? "" : undefined}
          style={{
            ...(isSubmenu ? SUBMENU_PRESENCE_VARS : MENU_PRESENCE_VARS),
            ...(context?.byKeyboard ? KEYBOARD_PRESENCE_VARS : null),
            ...style,
          }}
          {...props}
        >
          {/*
           * Pauses the focus trap of a Radix dialog under this menu (Radix
           * keeps one scope stack). The top-level panel leaves open/close
           * focus to Base UI (`initialFocus` / `finalFocus`); a submenu lets
           * the scope focus its first control, so custom submenu content
           * (a reaction strip, a slider) is reachable from the keyboard, and
           * hands focus back to its trigger row when it closes.
           */}
          <FocusScope
            asChild
            onMountAutoFocus={isSubmenu ? undefined : preventDefault}
            onUnmountAutoFocus={isSubmenu ? undefined : preventDefault}
          >
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
  default: "text-ink-1 data-highlighted:bg-tint-2 data-[popup-open]:bg-tint-2",
  danger: "text-danger-ink data-highlighted:bg-danger-tint",
  warning: "text-warning-ink data-highlighted:bg-warning-tint",
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
        <span aria-hidden="true" className={MENU_ICON}>
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className={MENU_HINT}>{hint}</span> : null}
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
        className="shrink-0 text-ink-3 rtl:rotate-180"
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
      <MenuPrimitive.RadioItemIndicator className="flex size-4 shrink-0 items-center justify-center text-ink-1">
        <Icon name="check" size="sm" />
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
      {/* A toggle row carries an LED: unlit off, talk-lit on (the row's
          menuitemcheckbox role carries the state for assistive tech). */}
      <span
        aria-hidden="true"
        data-slot="led"
        data-state="talk"
        data-size="6"
        data-toggle=""
        className="rm-led ms-auto"
      />
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
