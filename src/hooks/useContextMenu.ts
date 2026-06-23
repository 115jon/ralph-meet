
import { ContextMenuItem } from "@/components/chat/ContextMenu";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";
import { useCallback, useState } from "react";

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  isOpen: boolean;
}

export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState>({
    x: 0,
    y: 0,
    items: [],
    isOpen: false,
  });

  const openMenu = useCallback((e: React.MouseEvent | MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items,
      isOpen: true,
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const shouldRender = useDelayUnmount(menu.isOpen, 150);

  return { menu, openMenu, closeMenu, shouldRender, isClosing: !menu.isOpen };
}
