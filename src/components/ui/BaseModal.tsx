import { useBackButton } from "@/hooks/useBackButton";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface BaseModalProps {
  onClose: () => void;
  children: ReactNode;
  portal?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

const modalStack: HTMLElement[] = [];
const FOCUSABLE_SELECTOR = [
  "button:not([disabled]):not([data-base-modal-backdrop])",
  "[href]:not([data-base-modal-backdrop])",
  "input:not([disabled]):not([data-base-modal-backdrop])",
  "select:not([disabled]):not([data-base-modal-backdrop])",
  "textarea:not([disabled]):not([data-base-modal-backdrop])",
  "[tabindex]:not([tabindex='-1']):not([data-base-modal-backdrop])",
].join(",");

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => element.isConnected && !isHiddenOrInert(element));
}

function isTopmost(root: HTMLElement): boolean {
  return modalStack[modalStack.length - 1] === root;
}

function isHiddenOrInert(element: HTMLElement): boolean {
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) {
    return true;
  }

  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.hasAttribute("hidden") ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return true;
    }

    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function isolateBackground(root: HTMLElement): () => void {
  if (root.parentElement !== document.body) return () => {};

  const siblings = Array.from(document.body.children).filter(
    (element): element is HTMLElement => element !== root,
  );
  const previous = siblings.map((element) => ({
    element,
    ariaHidden: element.getAttribute("aria-hidden"),
    inert: element.getAttribute("inert"),
  }));

  for (const element of siblings) {
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("inert", "");
  }

  return () => {
    for (const entry of previous) {
      if (entry.ariaHidden === null) {
        entry.element.removeAttribute("aria-hidden");
      } else {
        entry.element.setAttribute("aria-hidden", entry.ariaHidden);
      }
      if (entry.inert === null) {
        entry.element.removeAttribute("inert");
      } else {
        entry.element.setAttribute("inert", entry.inert);
      }
    }
  };
}

/**
 * A reusable modal wrapper that automatically handles:
 * - Rendering into a portal (document.body)
 * - Pressing the Escape key to close
 * - Tauri Android back button to close
 */
export function BaseModal({
  onClose,
  children,
  portal = true,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: BaseModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const root = modalRef.current;
    if (!root) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    modalStack.push(root);
    const restoreBackground = isolateBackground(root);
    const focusable = getFocusableElements(root);
    (focusable[0] ?? root).focus();

    return () => {
      const index = modalStack.indexOf(root);
      if (index >= 0) modalStack.splice(index, 1);
      restoreBackground();
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const root = modalRef.current;
      if (!root || !isTopmost(root)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== "Tab") return;
      const focusable = getFocusableElements(root);
      if (focusable.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }

      const currentIndex = focusable.indexOf(
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : focusable[0],
      );
      const nextIndex = e.shiftKey
        ? currentIndex <= 0
          ? focusable.length - 1
          : currentIndex - 1
        : currentIndex === focusable.length - 1
          ? 0
          : currentIndex + 1;
      e.preventDefault();
      focusable[nextIndex]?.focus();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () =>
      window.removeEventListener("keydown", handler, { capture: true });
  }, [onClose]);

  useBackButton(
    useCallback(() => {
      onClose();
      return true; // consume the event
    }, [onClose]),
  );

  const resolvedRole = ariaLabel || ariaLabelledBy ? "dialog" : "presentation";
  const modal = (
    <div
      ref={modalRef}
      role={resolvedRole}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      {...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {})}
      {...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {})}
      {...(resolvedRole === "dialog" ? { "aria-modal": "true" } : {})}
      tabIndex={-1}
      data-base-modal-root="true"
    >
      {children}
    </div>
  );

  if (portal && typeof document !== "undefined") {
    return createPortal(modal, document.body);
  }

  return modal;
}
