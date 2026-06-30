
import { cn } from "@/lib/utils";
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

export default function ContextMenu({ x, y, items, topContent, onClose, isClosing }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const submenuAnchorRectRef = useRef<DOMRect | null>(null);
  const [coords, setCoords] = useState({ x, y });
  const [activeSubmenuKey, setActiveSubmenuKey] = useState<string | null>(null);
  const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
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
  }, [x, y, onClose]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      submenuAnchorRectRef.current = null;
      setSubmenuStyle({});
      setActiveSubmenuKey(null);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [items, x, y]);

  useEffect(() => {
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

      if (activeSubmenuAnchorRect.right + gap + submenuWidth > window.innerWidth - padding) {
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
  }, [activeSubmenuKey, coords.x, coords.y]);

  const activeSubmenuItem = activeSubmenuKey
    ? items.find((item) => (item.key ?? item.label) === activeSubmenuKey && item.submenu)
    : undefined;

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[1000] min-w-[220px] overflow-visible",
        isClosing ? "animate-out fade-out zoom-out-95 duration-150" : "animate-in fade-in zoom-in-95 duration-150",
      )}
      style={{ top: coords.y, left: coords.x }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseLeave={() => {
        setActiveSubmenuKey(null);
        submenuAnchorRectRef.current = null;
        setSubmenuStyle({});
      }}
    >
      <div
        ref={panelRef}
        className="overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-elevated p-1.5 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-0.5">
          {topContent ? (
            <div className="mb-1.5 border-b border-rm-border pb-1.5">
              {topContent}
            </div>
          ) : null}
          {items.map((item) => {
            const itemKey = item.key ?? item.label;
            const isSubmenuOpen = activeSubmenuKey === itemKey && Boolean(item.submenu);

            return (
              <React.Fragment key={itemKey}>
                <button
                  onMouseEnter={(event) => {
                    if (item.submenu) {
                      submenuAnchorRectRef.current = event.currentTarget.getBoundingClientRect();
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
                      submenuAnchorRectRef.current = event.currentTarget.getBoundingClientRect();
                      setActiveSubmenuKey((current) => current === itemKey ? null : itemKey);
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
                    "group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition-all",
                    item.disabled ? "cursor-default opacity-40" : "cursor-pointer",
                    item.disabled && "text-rm-text-muted",
                    !item.disabled && (
                      item.variant === "danger"
                        ? isSubmenuOpen
                          ? "bg-destructive text-white"
                          : "text-destructive hover:bg-destructive hover:text-white"
                        : item.variant === "warning"
                          ? isSubmenuOpen
                            ? "bg-warning text-white"
                            : "text-warning hover:bg-warning hover:text-white"
                          : isSubmenuOpen
                            ? "bg-primary text-white"
                            : "text-rm-text-secondary hover:bg-primary hover:text-white"
                    ),
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {item.icon ? (
                      <span className={cn("shrink-0 opacity-60", isSubmenuOpen && "opacity-100", !item.disabled && "group-hover:opacity-100")}>
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{item.label}</span>
                      {item.subtitle ? (
                        <span className="text-[11px] font-normal leading-tight opacity-60">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {item.rightIcon ? (
                    <span className={cn("ml-2 shrink-0 opacity-40", isSubmenuOpen && "opacity-80", !item.disabled && "group-hover:opacity-80")}>
                      {item.rightIcon}
                    </span>
                  ) : null}
                </button>
                {item.divider ? <div className="my-1.5 h-px w-full bg-rm-border" /> : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      {activeSubmenuItem?.submenu ? (
        <div
          ref={submenuRef}
          className="absolute z-[1001] w-[210px] overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-elevated p-1.5 shadow-2xl backdrop-blur-xl"
          style={submenuStyle}
        >
          {activeSubmenuItem.submenu}
        </div>
      ) : null}
    </div>,
    document.body
  );
}
