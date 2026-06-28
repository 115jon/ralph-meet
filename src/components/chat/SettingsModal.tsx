import { BaseModal } from "@/components/ui/BaseModal";
import { IconButton } from "@/components/ui/IconButton";
import { Separator } from "@/components/ui/separator";
import { clearDesktopAuthSession, markAuthLogoutIntent } from "@/lib/desktop-auth";
import { isDesktop } from "@/lib/platform";
import { useBackButton } from "@/hooks/useBackButton";
import { cn } from "@/lib/utils";
import { getOSName, useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { ChevronLeft, LogOut, User as UserIcon, X, Zap } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useKovaAuth, useUser } from "@kova/react";

import SettingsAccountTab from "./SettingsAccountTab";
import SettingsAppearanceTab from "./SettingsAppearanceTab";
import SettingsDevicesTab from "./SettingsDevicesTab";
import SettingsNotificationsTab from "./SettingsNotificationsTab";
import SettingsOSTab from "./SettingsOSTab";
import SettingsSharesTab from "./SettingsSharesTab";
import SettingsVoiceTab from "./SettingsVoiceTab";
import SettingsCameraTab from "./SettingsCameraTab";
import SettingsMediaTab from "./SettingsMediaTab";
import ThemePreviewSidebar from "./ThemePreviewSidebar";

interface SettingsModalProps {
  onClose: () => void;
  initialTab?: Tab;
  isClosing?: boolean;
}

type Tab =
  | "account"
  | "profiles"
  | "shares"
  | "appearance"
  | "media"
  | "voice"
  | "camera"
  | "accessibility"
  | "text"
  | "notifications"
  | "devices"
  | "os-settings";

function normalizeTab(tab?: Tab): Tab {
  if (tab === "text") return "media";
  return tab ?? "account";
}

function getTabTitle(tab: Tab): string {
  switch (tab) {
    case "account":
      return "My Account";
    case "profiles":
      return "Profiles";
    case "shares":
      return "Shared Messages";
    case "appearance":
      return "Appearance";
    case "media":
      return "Media & Content";
    case "voice":
      return "Voice";
    case "camera":
      return "Camera";
    case "accessibility":
      return "Accessibility";
    case "text":
      return "Media & Content";
    case "notifications":
      return "Notifications";
    case "devices":
      return "Devices";
    case "os-settings":
      return "OS Settings";
    default:
      return "Settings";
  }
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-[4px] px-2 py-1.5 text-[14px] font-medium transition-colors",
        active
          ? "bg-rm-bg-elevated text-rm-text"
          : "text-rm-text-muted hover:bg-rm-bg-elevated/60 hover:text-rm-text-secondary",
      )}
    >
      {label}
    </button>
  );
}

export default function SettingsModal({ onClose, initialTab, isClosing }: SettingsModalProps) {
  const { isLoaded: isUserLoaded } = useUser();
  const { clearSessionToken } = useKovaAuth();

  const [activeTab, setActiveTab] = useState<Tab>(normalizeTab(initialTab));
  const [showMobileMenu, setShowMobileMenu] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  const mounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );

  const handleSignOut = () => {
    markAuthLogoutIntent();

    // Use app-local logout. The SDK's signOut() revokes the server session and
    // invalidates other clients such as the desktop app.
    clearSessionToken();

    if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
      clearDesktopAuthSession();
    }

    if (typeof window !== "undefined") {
      window.location.replace("/sign-in");
    }
  };

  const isDesktopApp = isDesktop();
  const osName = getOSName();
  const desktopSettings = useDesktopSettingsStore();

  useEffect(() => {
    if (isDesktop()) {
      desktopSettings.syncToBackend();
    }
  }, []);

  useBackButton(
    useCallback(() => {
      if (!showMobileMenu && window.innerWidth < 768) {
        setShowMobileMenu(true);
        return true;
      }
      return false;
    }, [showMobileMenu]),
    !showMobileMenu && window.innerWidth < 768
  );

  const handleModalCloseOrBack = useCallback(() => {
    if (!showMobileMenu && window.innerWidth < 768) {
      setShowMobileMenu(true);
    } else if (previewOpen) {
      setPreviewOpen(false);
    } else {
      onClose();
    }
  }, [previewOpen, showMobileMenu, onClose]);

  if (!mounted) {
    return (
      <div
        className="fixed inset-0 z-1000 flex bg-rm-bg-primary"
        suppressHydrationWarning
      />
    );
  }

  return (
    <BaseModal onClose={onClose}>
      <div className={cn(
        "fixed inset-0 z-1000 flex flex-col items-center justify-center animate-in fade-in duration-200",
        previewOpen ? "bg-transparent p-0" : "bg-black/60 backdrop-blur-sm p-0 md:p-8",
        isClosing && "animate-out fade-out"
      )}>
        <div
          className={cn(
            "relative flex w-full overflow-hidden animate-in duration-200",
            previewOpen
              ? "h-full max-w-none flex-row bg-transparent shadow-none border-0 rounded-none"
              : "h-full flex-col bg-rm-bg-primary md:flex-row md:max-h-[820px] md:max-w-[1040px] md:rounded-xl shadow-2xl border-0 md:border md:border-rm-border",
            !previewOpen && "zoom-in-95",
            isClosing && "animate-out zoom-out-95"
          )}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          {previewOpen ? (
            <div className="pointer-events-none flex h-full w-full justify-end bg-transparent">
              <div className="flex-1 bg-transparent" />
              <ThemePreviewSidebar
                className="max-w-[320px]"
                onClose={() => setPreviewOpen(false)}
                onBackToSettings={() => setPreviewOpen(false)}
              />
            </div>
          ) : (
            <>
          {/* Sidebar */}
          <div className={cn(
            "w-full md:w-[218px] flex-col shrink-0 bg-rm-bg-sidebar pt-0 md:pt-[60px] pb-5 md:pl-5 pr-0 md:pr-1.5 overflow-y-auto overflow-x-hidden custom-scrollbar",
            "max-md:absolute max-md:inset-0 max-md:z-10 max-md:transition-transform max-md:duration-300 max-md:ease-out flex",
            showMobileMenu ? "max-md:translate-x-0" : "max-md:-translate-x-full"
          )}>
            {/* Mobile Header */}
            <div
              className="flex items-center justify-between px-4 pb-4 border-b border-rm-border md:hidden mb-4 shrink-0"
              style={{ paddingTop: 'calc(16px + var(--safe-area-top, 0px))' }}
            >
              <h2 className="text-lg font-bold text-rm-text">Settings</h2>
              <IconButton icon={X} size="sm" shape="circle" onClick={onClose} />
            </div>

            <div className="space-y-[2px] px-2 md:px-0">
              <div className="px-2 mb-2">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                  User Settings
                </h3>
              </div>
              <TabButton active={activeTab === "account"} onClick={() => { setActiveTab("account"); setShowMobileMenu(false); }} label="My Account" />
              <TabButton active={activeTab === "profiles"} onClick={() => { setActiveTab("profiles"); setShowMobileMenu(false); }} label="Profiles" />
              <TabButton active={activeTab === "shares"} onClick={() => { setActiveTab("shares"); setShowMobileMenu(false); }} label="Shared Messages" />

              <div className="px-2 mt-[18px] mb-2">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                  Audio & Video
                </h3>
              </div>
              <TabButton active={activeTab === "voice"} onClick={() => { setActiveTab("voice"); setShowMobileMenu(false); }} label="Voice" />
              <TabButton active={activeTab === "camera"} onClick={() => { setActiveTab("camera"); setShowMobileMenu(false); }} label="Camera" />
              <div className="px-2 mt-[18px] mb-2">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                  App Settings
                </h3>
              </div>
              <TabButton active={activeTab === "appearance"} onClick={() => { setActiveTab("appearance"); setShowMobileMenu(false); }} label="Appearance" />
              <TabButton active={activeTab === "media"} onClick={() => { setActiveTab("media"); setShowMobileMenu(false); }} label="Media & Content" />
              <TabButton active={activeTab === "accessibility"} onClick={() => { setActiveTab("accessibility"); setShowMobileMenu(false); }} label="Accessibility" />
              <TabButton active={activeTab === "notifications"} onClick={() => { setActiveTab("notifications"); setShowMobileMenu(false); }} label="Notifications" />
              <TabButton active={activeTab === "devices"} onClick={() => { setActiveTab("devices"); setShowMobileMenu(false); }} label="Devices" />

              {isDesktopApp && (
                <>
                  <div className="px-2 mt-[18px] mb-2">
                    <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                      System
                    </h3>
                  </div>
                  <TabButton active={activeTab === "os-settings"} onClick={() => { setActiveTab("os-settings"); setShowMobileMenu(false); }} label={`${osName} Settings`} />
                </>
              )}

              <Separator className="my-4 bg-rm-border mx-2" />

              <button
                onClick={handleSignOut}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[14px] font-medium text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-400 transition-colors group"
              >
                <span>Log Out</span>
                <LogOut size={16} className="opacity-50 group-hover:opacity-100" />
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className={cn(
            "flex-1 flex-col relative overflow-hidden bg-rm-bg-primary",
            "max-md:absolute max-md:inset-0 max-md:z-20 max-md:transition-transform max-md:duration-300 max-md:ease-out flex",
            !showMobileMenu ? "max-md:translate-x-0" : "max-md:translate-x-full"
          )}>
            {/* Mobile Header */}
            <div
              className="md:hidden flex items-center gap-3 px-4 pb-2 border-b border-rm-border shrink-0 bg-rm-bg-primary z-50"
              style={{ paddingTop: 'calc(16px + var(--safe-area-top, 0px))' }}
            >
              <IconButton
                icon={ChevronLeft}
                size="sm"
                shape="circle"
                className="bg-rm-bg-elevated border border-rm-border"
                onClick={() => setShowMobileMenu(true)}
              />
              <h2 className="text-base font-bold text-rm-text uppercase tracking-wider">
                {getTabTitle(activeTab)}
              </h2>
            </div>

            {/* Close Button (Desktop Only) */}
            <div className="hidden md:flex absolute right-[40px] top-[60px] z-20 flex-col items-center gap-2">
              <IconButton
                icon={X}
                shape="circle"
                className="h-9 w-9 border border-rm-border"
                onClick={onClose}
              />
              <span className="text-[13px] font-bold text-rm-text-muted group-hover:text-rm-text-secondary hidden md:block">
                ESC
              </span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pt-6 md:pt-[60px] pb-[60px]">
              <div
                className={cn(
                  "px-[16px] md:px-[40px] max-w-[740px] w-full mx-auto transition-opacity duration-150",
                )}
              >
                {activeTab === "account" && <SettingsAccountTab authUserLoaded={isUserLoaded} />}
                {activeTab === "appearance" && <SettingsAppearanceTab onOpenPreview={() => setPreviewOpen(true)} />}
                {activeTab === "media" && <SettingsMediaTab />}
                {activeTab === "voice" && <SettingsVoiceTab />}
                {activeTab === "camera" && <SettingsCameraTab />}
                {activeTab === "notifications" && <SettingsNotificationsTab />}
                {activeTab === "devices" && <SettingsDevicesTab />}
                {activeTab === "os-settings" && isDesktopApp && <SettingsOSTab />}
                {activeTab === "shares" && <SettingsSharesTab />}

                {activeTab === "profiles" && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
                      Profiles
                    </h1>
                    <p className="text-sm text-rm-text-muted mb-6 md:mb-8">
                      You can use a different identity across all your servers.
                    </p>

                    <div className="bg-rm-bg-surface rounded-xl border border-rm-border p-6 flex flex-col items-center justify-center min-h-[300px] text-center shadow-sm">
                      <div className="w-16 h-16 rounded-full bg-rm-accent/10 flex items-center justify-center text-rm-accent mb-4">
                        <UserIcon size={32} />
                      </div>
                      <h2 className="text-lg font-bold text-rm-text mb-2">
                        Server Profiles are coming soon
                      </h2>
                      <p className="text-sm text-rm-text-muted max-w-[320px]">
                        Soon you'll be able to set a unique avatar, banner, and bio
                        for each server you're in!
                      </p>
                    </div>
                  </div>
                )}

                {activeTab === "accessibility" && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
                      Accessibility
                    </h1>
                    <p className="text-sm text-rm-text-muted mb-6 md:mb-8">
                      Configure additional application preferences.
                    </p>

                    <div className="bg-rm-bg-surface rounded-xl border border-rm-border p-6 flex flex-col items-center justify-center min-h-[300px] text-center shadow-sm">
                      <div className="w-16 h-16 rounded-full bg-rm-accent/10 flex items-center justify-center text-rm-accent mb-4">
                        <Zap size={32} />
                      </div>
                      <h2 className="text-lg font-bold text-rm-text mb-2">
                        These settings are coming soon
                      </h2>
                      <p className="text-sm text-rm-text-muted max-w-[320px]">
                        We're working on bringing more advanced customization options to Ralph Meet. Stay tuned!
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
            </>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
