
import { cn } from "@/lib/utils";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  subtitle?: string;
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger" | "warning";
  divider?: boolean;
  disabled?: boolean;
}

interface ContextMenuProps {
  isClosing?: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose, isClosing }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x, y });

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
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
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

  return createPortal(
    <div
      ref={menuRef}
      className={cn("fixed z-[1000] min-w-[180px] overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated p-1.5 shadow-2xl backdrop-blur-xl", isClosing ? "animate-out fade-out zoom-out-95 duration-150" : "animate-in fade-in zoom-in-95 duration-150")}
      style={{ top: coords.y, left: coords.x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <React.Fragment key={item.label}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (item.disabled) return;
                item.onClick();
                onClose();
              }}
              className={cn(
                "group flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-all",
                item.disabled
                  ? "cursor-default opacity-40"
                  : "cursor-pointer",
                !item.disabled && (
                  item.variant === "danger"
                    ? "text-destructive hover:bg-destructive hover:text-white"
                    : item.variant === "warning"
                      ? "text-warning hover:bg-warning hover:text-white"
                      : "text-rm-text-secondary hover:bg-primary hover:text-white"
                ),
                item.disabled && "text-rm-text-muted"
              )}
            >
              <span className="flex items-center gap-2">
                {item.icon && <span className="opacity-60 group-hover:opacity-100">{item.icon}</span>}
                <span className="flex flex-col">
                  <span>{item.label}</span>
                  {item.subtitle && <span className="text-[11px] font-normal opacity-60 leading-tight">{item.subtitle}</span>}
                </span>
              </span>
              {item.rightIcon && <span className="opacity-40 group-hover:opacity-80 ml-2">{item.rightIcon}</span>}
            </button>
            {item.divider && <div className="my-1.5 h-px w-full bg-rm-border" />}
          </React.Fragment>
        ))}
      </div>
    </div>,
    document.body
  );
}
