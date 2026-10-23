/**
 * Room settings: the Studio voice, camera and appearance panels inside the
 * shared settings workbench, edited for the room's own settings user.
 *
 *   <RoomSettingsModal open onClose={close} settingsUserId={id} />
 *
 * Nothing here is room-only; the panels are the same ones Studio shows, so a
 * fix to one shows up in both.
 */

import AppearancePanel from "@/components/chat/settings/AppearancePanel";
import CameraCard from "@/components/chat/settings/CameraCard";
import {
  SettingsContext,
  type SettingsContextValue,
} from "@/components/chat/settings/primitives";
import {
  SettingsWorkbench,
  WorkbenchNav,
  type WorkbenchNavGroup,
} from "@/components/chat/settings/SettingsWorkbench";
import { useWorkbenchNav } from "@/components/chat/settings/useWorkbenchNav";
import VoiceVideoPanel from "@/components/chat/settings/VoiceVideoPanel";
import ThemePreviewSidebar from "@/components/chat/ThemePreviewSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { isDesktop } from "@/lib/platform";
import { useEffect, useMemo, useRef, useState } from "react";

export type RoomSettingsTab = "voice" | "camera" | "appearance";

interface RoomSettingsModalProps {
  open: boolean;
  onClose: () => void;
  settingsUserId: string;
  /** Page to open on. Phones open on it too, instead of the list. */
  initialTab?: RoomSettingsTab;
}

const NAV_GROUPS: WorkbenchNavGroup[] = [
  {
    title: "Audio & video",
    items: [
      { id: "voice", label: "Voice", icon: "mic" },
      { id: "camera", label: "Camera", icon: "camera" },
    ],
  },
  {
    title: "Look",
    items: [{ id: "appearance", label: "Appearance", icon: "appearance" }],
  },
];

const PAGES: Record<RoomSettingsTab, { title: string; blurb: string }> = {
  voice: {
    title: "Voice",
    blurb: "Your mic and speakers, and how you sound to others in this room.",
  },
  camera: {
    title: "Camera",
    blurb: "How you look to others in this room.",
  },
  appearance: {
    title: "Appearance",
    blurb: "Theme and colours for Ralph Meet on this device.",
  },
};

export default function RoomSettingsModal({
  open,
  onClose,
  settingsUserId,
  initialTab,
}: RoomSettingsModalProps) {
  const narrow = useIsMobile();
  const nav = useWorkbenchNav<RoomSettingsTab>(initialTab ?? "voice");
  const { reset } = nav;
  const [previewOpen, setPreviewOpen] = useState(false);

  /* Each open lands on the requested page (or the list on phones). */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      reset(initialTab ?? "voice", !initialTab);
      setPreviewOpen(false);
    }
    wasOpen.current = open;
    // Only the open transition matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const contextValue = useMemo<SettingsContextValue>(
    () => ({
      env: { desktop: isDesktop() },
      query: "",
      target: null,
      // The workbench supplies the real escape stack.
      registerEscape: () => () => {},
      openProfileEditor: () => {},
      openThemePreview: () => setPreviewOpen(true),
    }),
    [],
  );

  const page = PAGES[nav.active];

  return (
    <SettingsContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={300}>
        <SettingsWorkbench
          open={open}
          onClose={onClose}
          title="Room settings"
          closeLabel="Close room settings"
          nav={
            <WorkbenchNav
              groups={NAV_GROUPS}
              activeId={nav.active}
              onSelect={(id) => nav.go(id as RoomSettingsTab)}
            />
          }
          activeId={nav.active}
          showList={narrow ? nav.showList : false}
          onShowListChange={nav.setShowList}
          pageTitle={page.title}
          // Hidden, not unmounted, while the theme preview is up.
          hidden={previewOpen}
        >
          <p className="text-pretty text-ui-sm text-rm-text-secondary">
            {page.blurb}
          </p>
          {nav.active === "voice" ? (
            <VoiceVideoPanel
              settingsUserId={settingsUserId}
              includeCamera={false}
            />
          ) : nav.active === "camera" ? (
            <CameraCard settingsUserId={settingsUserId} autoPreview />
          ) : (
            <AppearancePanel />
          )}
        </SettingsWorkbench>
        <ThemePreviewSidebar
          open={open && previewOpen}
          onBackToSettings={() => setPreviewOpen(false)}
        />
      </TooltipProvider>
    </SettingsContext.Provider>
  );
}
