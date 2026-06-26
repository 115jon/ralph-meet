import { ContextMenuItem } from "@/components/chat/ContextMenu";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  topContent?: ReactNode;
  isOpen: boolean;
}

export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState>({
    x: 0,
    y: 0,
    items: [],
    topContent: undefined,
    isOpen: false,
  });

  const openMenu = useCallback((
    e: React.MouseEvent | MouseEvent,
    items: ContextMenuItem[],
    options?: { topContent?: ReactNode },
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items,
      topContent: options?.topContent,
      isOpen: true,
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const shouldRender = useDelayUnmount(menu.isOpen, 150);

  return { menu, openMenu, closeMenu, shouldRender, isClosing: !menu.isOpen };
}
