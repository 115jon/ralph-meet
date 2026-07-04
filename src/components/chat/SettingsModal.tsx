import { AvatarImage } from "@/components/chat/AvatarImage";
import { BaseModal } from "@/components/ui/BaseModal";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { clearDesktopAuthSession, markAuthLogoutIntent } from "@/lib/desktop-auth";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl, isDesktop } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { getOSName, useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { ChevronLeft, LogOut, Search, User as UserIcon, X, Zap } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useKovaAuth, useUser } from "@kova/react";

import SettingsAccountTab from "./SettingsAccountTab";
import SettingsAccountOverviewTab from "./SettingsAccountOverviewTab";
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
  initialProfileEditorOpen?: boolean;
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

type TabGroup = {
  title: string;
  items: Array<{
    tab: Tab;
    label: string;
    keywords: string[];
  }>;
};

function normalizeTab(tab?: Tab): Tab {
  if (tab === "text") return "media";
  return tab ?? "account";
}

function getTabTitle(tab: Tab): string {
  switch (tab) {
    case "account":
      return "Account";
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
        "flex w-full items-center rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors",
        active
          ? "bg-rm-bg-elevated text-rm-text shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
          : "text-rm-text-muted hover:bg-rm-bg-elevated/60 hover:text-rm-text-secondary",
      )}
    >
      {label}
    </button>
  );
}

export default function SettingsModal({
  onClose,
  initialTab,
  initialProfileEditorOpen = false,
  isClosing,
}: SettingsModalProps) {
  const { isLoaded: isUserLoaded } = useUser();
  const { clearSessionToken } = useKovaAuth();
  const chatUser = useChatStore((s) => s.user);

  const [activeTab, setActiveTab] = useState<Tab>(() => normalizeTab(initialTab));
  const [showMobileMenu, setShowMobileMenu] = useState(
    () => !(typeof window !== "undefined" && window.innerWidth < 768 && initialProfileEditorOpen),
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(initialProfileEditorOpen);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

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
  const profileDisplayName = getDisplayName({
    display_name: chatUser?.display_name ?? null,
    username: chatUser?.username ?? "",
  });
  const profileAvatarUrl = chatUser?.avatar_url ? getAuthAssetUrl(chatUser.avatar_url) : null;
  const tabGroups = useMemo<TabGroup[]>(
    () => [
      {
        title: "User settings",
        items: [
          { tab: "account", label: "Account", keywords: ["profile", "email", "username", "identity"] },
          { tab: "profiles", label: "Profiles", keywords: ["server profile", "avatar", "banner"] },
          { tab: "shares", label: "Shared Messages", keywords: ["shares", "messages", "links"] },
        ],
      },
      {
        title: "Audio & video",
        items: [
          { tab: "voice", label: "Voice", keywords: ["microphone", "audio", "voice"] },
          { tab: "camera", label: "Camera", keywords: ["video", "webcam", "camera"] },
        ],
      },
      {
        title: "App settings",
        items: [
          { tab: "appearance", label: "Appearance", keywords: ["theme", "color", "display"] },
          { tab: "media", label: "Media & Content", keywords: ["images", "content", "text"] },
          { tab: "accessibility", label: "Accessibility", keywords: ["motion", "readability", "contrast"] },
          { tab: "notifications", label: "Notifications", keywords: ["alerts", "sounds", "badges"] },
          { tab: "devices", label: "Devices", keywords: ["input", "output", "hardware"] },
        ],
      },
      ...(isDesktopApp
        ? [{
          title: "System",
          items: [
            { tab: "os-settings" as Tab, label: `${osName} Settings`, keywords: ["desktop", "system", osName.toLowerCase()] },
          ],
        }]
        : []),
    ],
    [isDesktopApp, osName],
  );
  const filteredTabGroups = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) return tabGroups;

    return tabGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.keywords.join(" ")}`.toLowerCase().includes(normalizedQuery),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [deferredSearchQuery, tabGroups]);

  useEffect(() => {
    if (isDesktop()) {
      desktopSettings.syncToBackend();
    }
  }, [desktopSettings]);

  const handleModalCloseOrBack = useCallback(() => {
    if (profileEditorOpen) {
      setProfileEditorOpen(false);
    } else if (previewOpen) {
      setPreviewOpen(false);
    } else if (!showMobileMenu && window.innerWidth < 768) {
      setShowMobileMenu(true);
    } else {
      onClose();
    }
  }, [previewOpen, profileEditorOpen, showMobileMenu, onClose]);

  if (!mounted) {
    return (
      <div
        className="fixed inset-0 z-1000 flex bg-rm-bg-primary"
        suppressHydrationWarning
      />
    );
  }

  return (
    <BaseModal onClose={handleModalCloseOrBack}>
      <div className={cn(
        "fixed inset-0 z-1000 flex flex-col items-center justify-center animate-in fade-in duration-200",
        previewOpen ? "bg-transparent p-0" : "bg-black/60 backdrop-blur-sm p-0 md:p-8",
        isClosing && "animate-out fade-out"
      )}>
        <dialog
          open
          className={cn(
            "relative m-0 flex w-full overflow-hidden p-0 outline-none animate-in duration-200",
            previewOpen
              ? "h-full max-w-none flex-row bg-transparent shadow-none border-0 rounded-none"
              : "h-full flex-col bg-rm-bg-primary md:flex-row md:max-h-[820px] md:max-w-[1040px] md:rounded-xl shadow-2xl border-0 md:border md:border-rm-border",
            !previewOpen && "zoom-in-95",
            isClosing && "animate-out zoom-out-95"
          )}
          aria-label="Settings"
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
            "w-full md:w-[248px] flex-col shrink-0 bg-rm-bg-sidebar pt-0 md:pt-4 pb-5 md:pl-4 pr-0 md:pr-2 overflow-y-auto overflow-x-hidden custom-scrollbar",
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

            <div className="space-y-4 px-2 md:px-0">
              <div className="rounded-[24px] border border-rm-border bg-rm-bg-primary/55 p-3 shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/10 bg-rm-bg-elevated">
                    {profileAvatarUrl ? (
                      <AvatarImage src={profileAvatarUrl} alt={profileDisplayName} display={chatUser?.avatar_display ?? null} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-base font-bold text-rm-text">
                        {getDisplayInitial({ name: profileDisplayName })}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-rm-text">{profileDisplayName}</div>
                    <button
                      type="button"
                      onClick={() => setProfileEditorOpen(true)}
                      className="mt-1 text-sm text-rm-text-muted transition-colors hover:text-rm-text"
                    >
                      Edit profile
                    </button>
                  </div>
                </div>
                <div className="relative mt-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="h-10 border-rm-border bg-rm-bg-primary/85 pl-9 text-rm-text placeholder:text-rm-text-muted"
                    placeholder="Search settings"
                    aria-label="Search settings"
                  />
                </div>
              </div>

              <div className="space-y-4">
                {filteredTabGroups.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-rm-border px-4 py-6 text-sm text-rm-text-muted">
                    No settings match “{deferredSearchQuery.trim()}”.
                  </div>
                ) : (
                  filteredTabGroups.map((group) => (
                    <div key={group.title}>
                      <div className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-rm-text-muted">
                        {group.title}
                      </div>
                      <div className="space-y-1">
                        {group.items.map((item) => (
                          <TabButton
                            key={item.tab}
                            active={activeTab === item.tab}
                            onClick={() => {
                              setActiveTab(item.tab);
                              setShowMobileMenu(false);
                            }}
                            label={item.label}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <Separator className="bg-rm-border mx-2" />

              <button
                onClick={handleSignOut}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-[14px] font-medium text-rose-400/70 transition-colors hover:bg-rose-500/10 hover:text-rose-400 group"
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

            <div className="flex-1 overflow-y-auto custom-scrollbar pt-6 md:pt-8 pb-[60px]">
              <div
                className={cn(
                  "px-[16px] md:px-[36px] max-w-[940px] w-full mx-auto transition-opacity duration-150",
                )}
              >
                {activeTab === "account" && (
                  <SettingsAccountOverviewTab onOpenProfileEditor={() => setProfileEditorOpen(true)} />
                )}
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
        </dialog>
        {profileEditorOpen && !previewOpen && (
          <div
            className="fixed inset-0 z-[1010] flex items-center justify-center bg-black/56 p-4 backdrop-blur-[2px] md:p-6"
            onClick={() => setProfileEditorOpen(false)}
          >
            <section
              className="relative overflow-hidden rounded-[30px] border border-rm-border bg-[#09090d] shadow-[0_36px_110px_rgba(0,0,0,0.52)] md:rounded-[32px]"
              style={{
                width: "min(1240px, calc(100vw - 32px))",
                height: "min(860px, calc(100dvh - 32px))",
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <SettingsAccountTab
                authUserLoaded={isUserLoaded}
                asModal
                onClose={() => setProfileEditorOpen(false)}
              />
            </section>
          </div>
        )}
      </div>
    </BaseModal>
  );
}
