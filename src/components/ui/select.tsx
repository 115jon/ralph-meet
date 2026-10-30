"use client";

import * as React from "react";
import { Icon } from "@/components/ui/icon";
import { Select as SelectPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  /** 32 (sm), 40 (default) or 48 (lg, settings and dialogs). */
  size?: "sm" | "default" | "lg";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-[2px] border border-line-field bg-ply-2 px-3 py-1 text-ui-md whitespace-nowrap text-ink-1 outline-none transition-[border-color] duration-(--dur-1) ease-out pointer-fine:hover:border-ink-2 focus-visible:border-ink-1 focus-visible:outline-1 focus-visible:outline-offset-0 data-[state=open]:border-ink-1 disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-danger-ink data-[placeholder]:text-ink-3 data-[size=default]:h-10 data-[size=sm]:h-8 data-[size=sm]:px-2.5 data-[size=lg]:h-12 data-[size=lg]:px-4 pointer-coarse:min-h-11 md:text-ui-base data-[size=sm]:md:text-ui-row [&_svg:not([class*='text-'])]:text-ink-2 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([data-icon])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <Icon name="chevronDown" size="sm" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  // Popper by default (overlays §3c): the list opens under its trigger like
  // every other menu, instead of jumping to centre the selected row.
  position = "popper",
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "relative z-60 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-[2px] border border-line-strong border-t-2 border-t-ink-1 bg-ply-3 text-ink-1 shadow-float data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.96] data-[state=open]:duration-140 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-80",
          position === "popper" &&
            "max-w-[min(280px,var(--radix-select-content-available-width))]",
          className,
        )}
        position={position}
        align={align}
        sideOffset={position === "popper" ? sideOffset : undefined}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(
        "silkscreen flex h-8 items-center px-3 text-ink-3",
        className,
      )}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-9 pointer-coarse:min-h-11 w-full cursor-default items-center gap-3 rounded-[2px] py-1.5 pr-8 pl-3 text-ui-row font-medium text-ink-1 outline-hidden select-none data-[highlighted]:bg-tint-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([data-icon])]:size-4 [&_svg:not([class*='text-'])]:text-ink-3 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <Icon name="check" size="sm" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-line", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <Icon name="chevronUp" size="sm" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <Icon name="chevronDown" size="sm" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
