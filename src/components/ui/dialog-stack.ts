import * as React from "react";

/**
 * Back-button stacking shared by Dialog and Drawer. Every open modal surface
 * marks itself with data-dialog-root-id + data-dialog-back-enabled, and only
 * the last one in DOM order answers the hardware/browser back button.
 */
export function isDialogTopmost(id: string) {
  if (typeof document === "undefined") return true;

  const openSurfaces = document.querySelectorAll<HTMLElement>(
    '[data-dialog-root-id][data-dialog-back-enabled="true"][data-state="open"]',
  );
  const topmostSurface = openSurfaces.item(openSurfaces.length - 1);

  return !topmostSurface || topmostSurface.dataset.dialogRootId === id;
}

/**
 * Title/description detection for the auto sr-only fallbacks. Wrappers that
 * render a Dialog or Drawer title (ResponsiveDialogTitle) tag themselves with
 * the same slot so the surface doesn't add a second, competing name.
 */
export type SlotTagged = { rmSlot?: "title" | "description" };

export function containsSlot(
  children: React.ReactNode,
  slot: "title" | "description",
): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false;
    if (
      typeof child.type !== "string" &&
      (child.type as SlotTagged).rmSlot === slot
    ) {
      return true;
    }
    return containsSlot(
      (child.props as { children?: React.ReactNode }).children,
      slot,
    );
  });
}
