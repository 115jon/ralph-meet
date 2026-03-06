import { BaseModal } from "@/components/ui/BaseModal";
import { Separator } from "@/components/ui/separator";
import { clearDesktopToken } from "@/lib/desktop-auth";
import { isDesktop } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { getOSName, useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, LogOut, User as UserIcon, X, Zap } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useClerk as useClerkHook, useUser } from "@clerk/tanstack-react-start";

import SettingsAccountTab from "./SettingsAccountTab";
import SettingsAppearanceTab from "./SettingsAppearanceTab";
import SettingsDevicesTab from "./SettingsDevicesTab";
import SettingsNotificationsTab from "./SettingsNotificationsTab";
import SettingsOSTab from "./SettingsOSTab";
import SettingsVoiceTab from "./SettingsVoiceTab";

interface SettingsModalProps {
  onClose: () => void;
}

type Tab =
  | "account"
  | "profiles"
  | "appearance"
  | "voice"
  | "accessibility"
  | "text"
  | "notifications"
  | "devices"
  | "os-settings";

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

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { user } = useUser();
  const clk = useClerkHook();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>("account");
  const [showMobileMenu, setShowMobileMenu] = useState(true);

  const mounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );

  const handleSignOut = () => {
    if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
      clearDesktopToken();
      navigate({ to: "/", replace: true });
    } else {
      clk.signOut({ redirectUrl: "/" });
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

  const handleModalCloseOrBack = useCallback(() => {
    if (!showMobileMenu && window.innerWidth < 768) {
      setShowMobileMenu(true);
    } else {
      onClose();
    }
  }, [showMobileMenu, onClose]);

  if (!mounted || !user) {
    return (
      <div
        className="fixed inset-0 z-[1000] flex bg-rm-bg-primary"
        suppressHydrationWarning
      />
    );
  }

  return (
    <BaseModal onClose={handleModalCloseOrBack}>
      <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center p-0 md:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div
          className="relative flex flex-col md:flex-row w-full h-full md:max-h-[820px] md:max-w-[1040px] md:rounded-xl overflow-hidden shadow-2xl bg-rm-bg-primary border-0 md:border md:border-rm-border"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          {/* Sidebar */}
          <div className={cn(
            "w-full md:w-[218px] flex-col shrink-0 bg-rm-bg-primary md:bg-rm-server-bar pt-0 md:pt-[60px] pb-5 md:pl-5 pr-0 md:pr-1.5 overflow-y-auto overflow-x-hidden custom-scrollbar",
            showMobileMenu ? "flex animate-in slide-in-from-left-4 duration-300" : "hidden md:flex"
          )}>
            {/* Mobile Header */}
            <div
              className="flex items-center justify-between px-4 pb-4 border-b border-rm-border md:hidden mb-4 shrink-0"
              style={{ paddingTop: 'calc(16px + var(--safe-area-top, 0px))' }}
            >
              <h2 className="text-lg font-bold text-rm-text">Settings</h2>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-[2px] px-2 md:px-0">
              <div className="px-2 mb-2">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                  User Settings
                </h3>
              </div>
              <TabButton active={activeTab === "account"} onClick={() => { setActiveTab("account"); setShowMobileMenu(false); }} label="My Account" />
              <TabButton active={activeTab === "profiles"} onClick={() => { setActiveTab("profiles"); setShowMobileMenu(false); }} label="Profiles" />

              <div className="px-2 mt-[18px] mb-2">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                  App Settings
                </h3>
              </div>
              <TabButton active={activeTab === "appearance"} onClick={() => { setActiveTab("appearance"); setShowMobileMenu(false); }} label="Appearance" />
              <TabButton active={activeTab === "accessibility"} onClick={() => { setActiveTab("accessibility"); setShowMobileMenu(false); }} label="Accessibility" />
              <TabButton active={activeTab === "voice"} onClick={() => { setActiveTab("voice"); setShowMobileMenu(false); }} label="Voice & Video" />
              <TabButton active={activeTab === "text"} onClick={() => { setActiveTab("text"); setShowMobileMenu(false); }} label="Text & Images" />
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
            !showMobileMenu ? "flex animate-in slide-in-from-right-4 duration-300" : "hidden md:flex"
          )}>
            {/* Mobile Header */}
            <div
              className="md:hidden flex items-center gap-3 px-4 pb-2 border-b border-rm-border shrink-0 bg-rm-bg-primary z-[50]"
              style={{ paddingTop: 'calc(16px + var(--safe-area-top, 0px))' }}
            >
              <button
                onClick={() => setShowMobileMenu(true)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-rm-bg-elevated border border-rm-border text-rm-text-muted hover:text-rm-text transition-all"
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-base font-bold text-rm-text uppercase tracking-wider">
                {activeTab.replace('-', ' ')}
              </h2>
            </div>

            {/* Close Button (Desktop Only) */}
            <div className="hidden md:flex absolute right-[40px] top-[60px] z-20 flex-col items-center gap-2">
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-rm-border text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-all group hidden md:flex"
              >
                <X size={18} />
              </button>
              <span className="text-[13px] font-bold text-rm-text-muted group-hover:text-rm-text-secondary hidden md:block">
                ESC
              </span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-[16px] md:px-[40px] pt-6 md:pt-[60px] pb-[60px] max-w-[740px] w-full mx-auto">
              {activeTab === "account" && <SettingsAccountTab />}
              {activeTab === "appearance" && <SettingsAppearanceTab />}
              {activeTab === "voice" && <SettingsVoiceTab />}
              {activeTab === "notifications" && <SettingsNotificationsTab />}
              {activeTab === "devices" && <SettingsDevicesTab />}
              {activeTab === "os-settings" && isDesktopApp && <SettingsOSTab />}

              {activeTab === "profiles" && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
                    Profiles
                  </h1>
                  <p className="text-sm text-rm-text-muted mb-6 md:mb-8">
                    You can use a different identity across all your servers.
                  </p>

                  <div className="bg-rm-bg-surface rounded-xl border border-rm-border p-6 flex flex-col items-center justify-center min-h-[300px] text-center shadow-sm">
                    <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 mb-4">
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

              {(activeTab === "text" || activeTab === "accessibility") && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
                    {activeTab === "text" ? "Text & Images" : "Accessibility"}
                  </h1>
                  <p className="text-sm text-rm-text-muted mb-6 md:mb-8">
                    Configure additional application preferences.
                  </p>

                  <div className="bg-rm-bg-surface rounded-xl border border-rm-border p-6 flex flex-col items-center justify-center min-h-[300px] text-center shadow-sm">
                    <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 mb-4">
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
      </div>
    </BaseModal>
  );
}
