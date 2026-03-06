import { useBackButton } from "@/hooks/useBackButton";
import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

interface BaseModalProps {
  onClose: () => void;
  children: React.ReactNode;
  portal?: boolean;
}

/**
 * A reusable modal wrapper that automatically handles:
 * - Rendering into a portal (document.body)
 * - Pressing the Escape key to close
 * - Tauri Android back button to close
 */
export function BaseModal({ onClose, children, portal = true }: BaseModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useBackButton(
    useCallback(() => {
      onClose();
      return true; // consume the event
    }, [onClose])
  );

  if (portal && typeof document !== "undefined") {
    return createPortal(children, document.body);
  }

  return <>{children}</>;
}
