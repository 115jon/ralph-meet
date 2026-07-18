import { cn } from "@/lib/utils";
import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type {
  ListenTogetherResultAction,
  ListenTogetherResultActionId,
} from "./ListenTogetherResultActionModel";

export function ListenTogetherResultActionTrigger({
  label,
  onClick,
}: {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`More actions for ${label}`}
      onClick={onClick}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-rm-text-muted transition-colors hover:bg-rm-bg-active hover:text-rm-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );
}

export function ListenTogetherMobileActionSheet({
  title,
  actions,
  onAction,
  onClose,
}: {
  title: string;
  actions: ListenTogetherResultAction[];
  onAction: (action: ListenTogetherResultActionId) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current
      ?.querySelector<HTMLElement>("button:not([aria-label='Close actions'])")
      ?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex items-end bg-black/55 p-3 lg:hidden"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full overflow-hidden rounded-[26px] border border-rm-border bg-rm-bg-surface shadow-[0_-20px_60px_rgba(0,0,0,0.45)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rm-border px-4 py-3">
          <h2
            id={titleId}
            className="min-w-0 truncate text-sm font-bold text-rm-text"
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close actions"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-1 p-2">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                onAction(action.id);
                onClose();
              }}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-2xl px-3 text-left text-sm font-semibold text-rm-text transition-colors hover:bg-rm-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                action.id === "play-now" && "text-primary",
              )}
            >
              <action.icon className="h-4 w-4" />
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
