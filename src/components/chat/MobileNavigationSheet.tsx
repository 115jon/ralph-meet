import { MobileMessagesTab } from "@/components/chat/mobile/MobileMessagesTab";
import { MobileNotificationsTab } from "@/components/chat/mobile/MobileNotificationsTab";
import { MobileTabBar } from "@/components/chat/mobile/MobileTabBar";
import { MobileYouPage } from "@/components/chat/mobile/MobileYouPage";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMobileTabStore } from "@/stores/useMobileTabStore";
import { useCallback, type ReactNode } from "react";

interface MobileNavigationSheetProps {
  open: boolean;
  onClose: () => void;
  serverList: ReactNode;
  current: ReactNode;
  /** Opens a DM from the Messages tab. */
  onSelectDm: (channelId: string) => void;
}

const TAB_TITLES = {
  servers: "Servers",
  messages: "Messages",
  notifications: "Notifications",
  you: "You",
} as const;

/**
 * The phone home surface (below md): the bottom tab bar and its four tabs, on
 * a left drawer you can swipe away to the conversation behind it. Opening a
 * conversation closes it, which is what hides the tab bar there. Back (Android,
 * browser) on any tab but Servers returns to Servers, then closes.
 */
export function MobileNavigationSheet({
  open,
  onClose,
  serverList,
  current,
  onSelectDm,
}: MobileNavigationSheetProps) {
  const tab = useMobileTabStore((s) => s.tab);
  const setTab = useMobileTabStore((s) => s.setTab);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleBack = useCallback(() => {
    if (useMobileTabStore.getState().tab !== "servers") {
      setTab("servers");
      return;
    }
    handleClose();
  }, [handleClose, setTab]);

  return (
    <Drawer
      direction="left"
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
      onBackButton={handleBack}
    >
      <DrawerContent
        className="w-full max-w-none gap-0 border-r-0 bg-rm-bg-primary pt-[var(--safe-area-top,0px)] shadow-none dark:bg-rm-bg-primary md:hidden"
        overlayClassName="md:hidden"
      >
        <DrawerTitle className="sr-only">{TAB_TITLES[tab]}</DrawerTitle>
        <DrawerDescription className="sr-only">
          Choose a server, direct message, or channel.
        </DrawerDescription>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {tab === "servers" ? (
            <>
              <div className="w-[72px] shrink-0 overflow-hidden border-r border-rm-border bg-rm-bg-floating">
                {serverList}
              </div>
              <div className="min-w-0 flex-1 overflow-hidden bg-rm-sidebar">
                {current}
              </div>
            </>
          ) : (
            <div className="min-w-0 flex-1 overflow-hidden">
              {tab === "messages" ? (
                <MobileMessagesTab
                  onSelectDm={onSelectDm}
                  onNavigate={handleClose}
                />
              ) : tab === "notifications" ? (
                <MobileNotificationsTab onNavigate={handleClose} />
              ) : (
                <MobileYouPage onNavigate={handleClose} />
              )}
            </div>
          )}
        </div>

        <MobileTabBar />
      </DrawerContent>
    </Drawer>
  );
}
