import { lazy, Suspense } from "react";
import { useShallow } from "zustand/shallow";

import { useSettingsDialogStore } from "@/stores/useSettingsDialogStore";

const SettingsModal = lazy(() => import("@/components/chat/SettingsModal"));

/**
 * The single mount of the user settings dialog. Every opener (desktop gear,
 * the mobile You tab, deep links, menus) goes through `openSettings()`, so
 * there is one dialog and one source of truth for whether it is open.
 */
export function SettingsHost() {
  const { open, requested, location, requestId, close } =
    useSettingsDialogStore(
      useShallow((state) => ({
        open: state.open,
        requested: state.requested,
        location: state.location,
        requestId: state.requestId,
        close: state.close,
      })),
    );

  // Keep the chunk out of the first load until someone asks for settings.
  if (!requested) return null;

  return (
    <Suspense fallback={null}>
      <SettingsModal
        open={open}
        onClose={close}
        initialTab={location.panel}
        initialRow={location.row}
        requestId={requestId}
      />
    </Suspense>
  );
}
