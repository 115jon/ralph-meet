
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { apiDelete, apiGet, apiPatch, apiUpload } from "@/lib/api-client";
import { clearDesktopToken } from "@/lib/desktop-auth";
import { isDesktop } from "@/lib/platform";
import { playNotification } from "@/lib/sounds";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { useChatState, useChatStore } from "@/stores/chat-store";
import { getOSName, useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  BellRing,
  Check,
  ChevronDown,
  ChevronLeft,
  Headphones,
  Loader2,
  LogOut,
  Mic,
  Monitor,
  MonitorUp,
  Music,
  Power,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Speaker,
  Upload,
  User as UserIcon,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/shallow";

// Import useClerk via ESM so the desktop Vite shim alias applies.
// On desktop this resolves to the no-op shim; on web it's the real hook.
import { useClerk as useClerkHook, useUser } from "@clerk/tanstack-react-start";

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

function useAccountState(user: any) {
  const [displayName, setDisplayName] = useState(
    () =>
      (user?.unsafeMetadata?.displayName as string) ||
      user?.fullName ||
      user?.firstName ||
      "",
  );
  const [username, setUsername] = useState(() => user?.username || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid" | "own"
  >("idle");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const lastUserId = useRef(user?.id);
  if (user?.id !== lastUserId.current) {
    setDisplayName(
      (user?.unsafeMetadata?.displayName as string) ||
      user?.fullName ||
      user?.firstName ||
      "",
    );
    setUsername(user?.username || "");
    setError(null);
    setSaved(false);
    setUsernameStatus("idle");
    lastUserId.current = user?.id;
  }

  return {
    displayName, setDisplayName,
    username, setUsername,
    saving, setSaving,
    saved, setSaved,
    error, setError,
    usernameStatus, setUsernameStatus,
    avatarPreview, setAvatarPreview,
    avatarFile, setAvatarFile,
    fileInputRef, checkTimeoutRef, abortRef,
  };
}

function useDevicesState() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  return {
    sessions, setSessions,
    sessionsLoading, setSessionsLoading,
    sessionError, setSessionError
  };
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { user } = useUser();
  const clk = useClerkHook();
  const navigate = useNavigate();
  const { theme, setTheme, resolvedTheme: _resolvedTheme } = useTheme();
  const chatState = useChatState();
  const loadCurrentUser = useChatStore(s => s.actions.loadCurrentUser);
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

  // My Account state
  const {
    displayName, setDisplayName,
    username, setUsername,
    saving, setSaving,
    saved, setSaved,
    error, setError,
    usernameStatus, setUsernameStatus,
    avatarPreview, setAvatarPreview,
    avatarFile, setAvatarFile,
    fileInputRef, checkTimeoutRef, abortRef,
  } = useAccountState(user);

  // Voice settings state
  const { audioInputs, audioOutputs, videoInputs: _videoInputs } = useMediaDevices();
  const settingsUserId = user?.id ?? null;
  const vSettings = useVoiceSettingsStore(useShallow((s) => s.getSettings(settingsUserId)));
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const setCurrentUser = useVoiceSettingsStore((s) => s.setCurrentUser);

  // Sound settings
  const soundSettings = useSoundSettingsStore(useShallow((s) => s.getSettings(settingsUserId)));
  const updateSoundSettings = useSoundSettingsStore((s) => s.updateSettings);
  const setSoundCurrentUser = useSoundSettingsStore((s) => s.setCurrentUser);

  // Devices state
  const {
    sessions, setSessions,
    sessionsLoading, setSessionsLoading,
    sessionError, setSessionError
  } = useDevicesState();

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionError(null);
    try {
      const data = await apiGet<{ sessions: any[] }>("/api/sessions");
      setSessions(data.sessions);
    } catch (err: any) {
      setSessionError(err.message || "Failed to load sessions");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "devices") {
      fetchSessions();
    }
  }, [activeTab, fetchSessions]);

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await apiDelete("/api/sessions", { sessionId });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err: any) {
      setSessionError(err.message || "Failed to revoke session");
    }
  };

  // Desktop (OS) settings — only relevant on native desktop builds
  const isDesktopApp = isDesktop();
  const osName = getOSName();
  const desktopSettings = useDesktopSettingsStore();

  // Sync desktop settings to Rust backend on mount
  useEffect(() => {
    if (isDesktop()) {
      desktopSettings.syncToBackend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensure the store's currentUser is set so voice hooks can react to settings changes
  useEffect(() => {
    if (settingsUserId) {
      const storeUser = useVoiceSettingsStore.getState().currentUser;
      // Only set if no voice hook has already claimed the currentUser as a room namespace
      if (!storeUser || !storeUser.startsWith('room-')) {
        setCurrentUser(settingsUserId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize sound settings store current user
  useEffect(() => {
    if (settingsUserId) {
      setSoundCurrentUser(settingsUserId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter out browser's synthetic "default" device since we add our own Default option
  const filteredAudioInputs = audioInputs.filter(d => d.deviceId !== 'default');
  const filteredAudioOutputs = audioOutputs.filter(d => d.deviceId !== 'default');

  const hasChanges =
    displayName !== ((user?.unsafeMetadata?.displayName as string) || user?.username || "") ||
    username !== (user?.username || "") ||
    avatarFile !== null;

  // Escape key to close
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const checkUsername = useCallback(
    (value: string) => {
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
      if (abortRef.current) abortRef.current.abort();

      const trimmed = value.trim().toLowerCase();
      if (trimmed === (user?.username || "")) {
        setUsernameStatus("own");
        return;
      }
      if (trimmed.length < 2) {
        setUsernameStatus(trimmed.length > 0 ? "invalid" : "idle");
        return;
      }
      if (!/^[a-z0-9._]+$/.test(trimmed)) {
        setUsernameStatus("invalid");
        return;
      }

      setUsernameStatus("checking");
      checkTimeoutRef.current = setTimeout(async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const data = await apiGet<{ available: boolean }>(
            `/api/check-username?username=${encodeURIComponent(trimmed)}`,
            { signal: controller.signal },
          );
          setUsernameStatus(data.available ? "available" : "taken");
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            setUsernameStatus("idle");
          }
        }
      }, 400);
    },
    [user?.username],
  );

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, "");
    setUsername(cleaned);
    setError(null);
    checkUsername(cleaned);
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSaveProfile = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    setSaved(false);
    setError(null);

    const trimmedName = displayName.trim();
    const trimmedUsername = username.trim().toLowerCase();

    try {
      await apiPatch("/api/update-profile", {
        displayName: trimmedName || trimmedUsername,
        username: trimmedUsername,
      });

      if (avatarFile) {
        const formData = new FormData();
        formData.append("file", avatarFile);
        await apiUpload<{ url: string }>("/api/avatar-upload", formData);
        setAvatarFile(null);
        setAvatarPreview(null);
      }

      // On web, reload Clerk user cache. On desktop the stub has no reload()
      // so we just mark success — the Zustand store already has the real data.
      if (typeof user.reload === "function") {
        await user.reload();
      }
      // Refresh the Zustand store with latest profile from the API
      // so updated name/avatar propagates across the UI immediately.
      await loadCurrentUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("[Profile] Failed to save:", err);
      setError(err instanceof Error ? err.message : "Failed to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [user, displayName, username, avatarFile]);

  // Voice toggles
  const handleVoiceToggle = (key: string) => {
    updateUserSettings((s: any) => {
      const newVal = !s[key];
      const updates: any = { [key]: newVal };

      // High Fidelity requires ALL audio processing to be OFF to allow stereo Opus
      if (key === "streamHighFidelity" && newVal) {
        updates.echoCancellation = false;
        updates.noiseSuppression = false;
        updates.autoSensitivity = false;
      }

      // Any audio processing requires High Fidelity to be OFF (since processing downmixes to mono)
      if (
        (key === "echoCancellation" ||
          key === "noiseSuppression" ||
          key === "autoSensitivity") &&
        newVal
      ) {
        updates.streamHighFidelity = false;
      }

      return { ...s, ...updates };
    }, settingsUserId ?? undefined);
  };

  const handleVoiceSlider = (key: string, val: number) => {
    updateUserSettings((s: any) => ({ ...s, [key]: val }), settingsUserId ?? undefined);
  };

  if (!mounted || !user) {
    return (
      <div
        className="fixed inset-0 z-[1000] flex bg-rm-bg-primary"
        suppressHydrationWarning
      />
    );
  }

  return createPortal(
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
          "w-full md:w-[218px] flex-col shrink-0 bg-rm-bg-primary md:bg-rm-server-bar pt-4 md:pt-[60px] pb-5 md:pl-5 pr-0 md:pr-1.5 overflow-y-auto overflow-x-hidden custom-scrollbar",
          showMobileMenu ? "flex animate-in slide-in-from-left-4 duration-300" : "hidden md:flex"
        )}>
          {/* Mobile Header */}
          <div className="flex items-center justify-between px-4 pb-4 border-b border-rm-border md:hidden mb-4">
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
            <TabButton
              active={activeTab === "account"}
              onClick={() => { setActiveTab("account"); setShowMobileMenu(false); }}
              label="My Account"
            />
            <TabButton
              active={activeTab === "profiles"}
              onClick={() => { setActiveTab("profiles"); setShowMobileMenu(false); }}
              label="Profiles"
            />
            <div className="px-2 mt-[18px] mb-2">
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                App Settings
              </h3>
            </div>
            <TabButton
              active={activeTab === "appearance"}
              onClick={() => { setActiveTab("appearance"); setShowMobileMenu(false); }}
              label="Appearance"
            />
            <TabButton
              active={activeTab === "accessibility"}
              onClick={() => { setActiveTab("accessibility"); setShowMobileMenu(false); }}
              label="Accessibility"
            />
            <TabButton
              active={activeTab === "voice"}
              onClick={() => { setActiveTab("voice"); setShowMobileMenu(false); }}
              label="Voice & Video"
            />
            <TabButton
              active={activeTab === "text"}
              onClick={() => { setActiveTab("text"); setShowMobileMenu(false); }}
              label="Text & Images"
            />
            <TabButton
              active={activeTab === "notifications"}
              onClick={() => { setActiveTab("notifications"); setShowMobileMenu(false); }}
              label="Notifications"
            />
            <TabButton
              active={activeTab === "devices"}
              onClick={() => { setActiveTab("devices"); setShowMobileMenu(false); }}
              label="Devices"
            />

            {isDesktopApp && (
              <>
                <div className="px-2 mt-[18px] mb-2">
                  <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                    System
                  </h3>
                </div>
                <TabButton
                  active={activeTab === "os-settings"}
                  onClick={() => { setActiveTab("os-settings"); setShowMobileMenu(false); }}
                  label={`${osName} Settings`}
                />
              </>
            )}

            <Separator className="my-4 bg-rm-border mx-2" />

            <button
              onClick={handleSignOut}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[14px] font-medium text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-400 transition-colors group"
            >
              <span>Log Out</span>
              <LogOut
                size={16}
                className="opacity-50 group-hover:opacity-100"
              />
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className={cn(
          "flex-1 flex-col relative overflow-hidden bg-rm-bg-primary",
          !showMobileMenu ? "flex animate-in slide-in-from-right-4 duration-300" : "hidden md:flex"
        )}>
          {/* Mobile Header (replaces absolute back button) */}
          <div className="md:hidden flex items-center gap-3 px-4 h-14 border-b border-rm-border shrink-0 bg-rm-bg-primary z-[50]">
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
            {activeTab === "account" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-2xl font-bold text-rm-text mb-6 hidden md:block">
                  My Account
                </h1>

                <div className="rounded-xl border border-rm-border bg-rm-bg-surface overflow-hidden md:shadow-xl mb-6">
                  {/* Profile Header */}
                  <div className="h-[80px] md:h-[100px] bg-gradient-to-r from-indigo-500 to-purple-500" />
                  <div className="px-4 pb-4 -mt-10 md:-mt-12 flex flex-col items-center md:flex-row md:items-start md:gap-4 text-center md:text-left">
                    <div className="relative shrink-0 mb-3 md:mb-0">
                      <div className="h-[80px] w-[80px] md:h-[80px] md:w-[80px] rounded-full border-[6px] border-[var(--rm-bg-surface)] bg-rm-bg-elevated overflow-hidden relative shadow-md">
                        <img
                          src={avatarPreview || chatState.user?.avatar_url || user.imageUrl}
                          alt="Profile"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute bottom-1 right-1 h-7 w-7 rounded-full bg-indigo-500 border-2 border-[var(--rm-bg-surface)] flex items-center justify-center text-white hover:bg-indigo-400 transition-all shadow-lg"
                      >
                        <Upload size={14} />
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarSelect}
                        className="hidden"
                      />
                    </div>
                    <div className="md:pt-14 flex-1">
                      <h2 className="text-xl font-bold text-rm-text leading-none break-all mb-1">
                        {(user.unsafeMetadata?.displayName as string) || user.username}
                      </h2>
                      <p className="text-sm text-rm-text-muted">
                        @{user.username}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Edit Form - Unified Mobile List Format */}
                <div className="space-y-6">
                  <div className="bg-rm-bg-surface rounded-xl border border-rm-border divide-y divide-rm-border overflow-hidden">
                    <div className="p-4 flex flex-col md:flex-row md:items-center gap-2 md:gap-4 hover:bg-rm-bg-elevated/40 transition-colors">
                      <Label className="text-[11px] font-bold uppercase text-rm-text-muted tracking-wider shrink-0 md:w-[140px]">
                        Display Name
                      </Label>
                      <Input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="bg-transparent border-0 md:border md:border-rm-border focus-visible:ring-1 focus-visible:ring-primary/40 px-0 md:px-3 h-8 shadow-none"
                        placeholder="Add a display name"
                      />
                    </div>

                    <div className="p-4 flex flex-col md:flex-row md:items-start gap-2 md:gap-4 hover:bg-rm-bg-elevated/40 transition-colors">
                      <Label className="text-[11px] font-bold uppercase text-rm-text-muted tracking-wider shrink-0 md:w-[140px] md:mt-2">
                        Username
                      </Label>
                      <div className="flex-1 w-full">
                        <div className="relative">
                          <span className="absolute left-0 md:left-3 mt-[1px] md:mt-0 top-1/2 -translate-y-1/2 text-rm-text-muted/40 text-sm">
                            @
                          </span>
                          <Input
                            value={username}
                            onChange={handleUsernameChange}
                            className="pl-5 md:pl-7 bg-transparent border-0 md:border md:border-rm-border focus-visible:ring-1 focus-visible:ring-primary/40 px-0 h-8 shadow-none"
                          />
                        </div>
                        {usernameStatus !== "idle" && usernameStatus !== "own" && (
                          <p
                            className={cn(
                              "text-[12px] mt-2 flex items-center gap-1",
                              usernameStatus === "available"
                                ? "text-primary"
                                : "text-destructive",
                            )}
                          >
                            {usernameStatus === "checking" && (
                              <Loader2 size={12} className="animate-spin" />
                            )}
                            {usernameStatus === "available"
                              ? "Username available!"
                              : usernameStatus === "taken"
                                ? "Username is already taken."
                                : usernameStatus === "invalid"
                                  ? "Username is invalid."
                                  : ""}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="p-4 flex flex-col md:flex-row md:items-center gap-2 md:gap-4 hover:bg-rm-bg-elevated/40 transition-colors">
                      <Label className="text-[11px] font-bold uppercase text-rm-text-muted tracking-wider shrink-0 md:w-[140px]">
                        Email
                      </Label>
                      <div className="text-sm text-rm-text-secondary h-8 flex items-center">
                        {user.primaryEmailAddress?.emailAddress}
                      </div>
                    </div>
                  </div>

                  <div className={cn("pt-2 flex flex-col md:flex-row items-center justify-between gap-4 transition-all duration-300", hasChanges ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none")}>
                    <p className="text-xs text-rm-text-muted italic w-full md:w-auto text-center md:text-left">
                      Changes map to all servers
                    </p>
                    {error && (
                      <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-2.5 text-sm text-destructive font-medium w-full md:w-auto text-center">
                        {error}
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row w-full md:w-auto items-center gap-3">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDisplayName((user?.unsafeMetadata?.displayName as string) || user?.username || "");
                          setUsername(user?.username || "");
                          setAvatarFile(null);
                          setAvatarPreview(null);
                          setError(null);
                        }}
                        className="text-rm-text-muted hover:text-rm-text w-full sm:w-auto"
                      >
                        Revert
                      </Button>
                      <Button
                        onClick={handleSaveProfile}
                        disabled={saving || !hasChanges}
                        className="bg-primary hover:brightness-110 text-primary-foreground min-w-[120px] w-full sm:w-auto"
                      >
                        {saving ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : saved ? (
                          <Check size={18} />
                        ) : (
                          "Save Changes"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex flex-col items-center">
                <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block w-full">
                  Appearance
                </h1>
                <p className="text-sm text-rm-text-muted mb-6 md:mb-8 hidden md:block w-full">
                  Customize how Ralph Meet looks. Choose between dark, light, or
                  sync with your system.
                </p>

                <div className="w-full max-w-[400px]">
                  <section className="flex flex-col">
                    {/* Unified Mobile/Desktop Mockup View */}
                    <div className="w-full rounded-[20px] bg-rm-bg-surface border border-rm-border p-4 md:p-5 shadow-lg overflow-hidden flex flex-col pointer-events-none select-none mb-6">
                      <h3 className="font-bold text-rm-text mb-4 text-[15px] px-1">Messages</h3>

                      <div className="flex items-center gap-3 mb-5 overflow-hidden">
                        <div className="h-[46px] w-[130px] rounded-[14px] bg-rm-bg-elevated shrink-0" />
                        <div className="h-[46px] w-[180px] rounded-[14px] bg-rm-bg-elevated shrink-0" />
                        <div className="h-[46px] w-[90px] rounded-[14px] bg-rm-bg-elevated shrink-0" />
                      </div>

                      <div className="flex flex-col gap-[22px] px-1">
                        {[
                          { c: "bg-emerald-500", name: "24m", w: "w-[60px]", w2: "w-[180px]" },
                          { c: "bg-blue-500", name: "32m", w: "w-[90px]", w2: "w-[220px]" },
                          { c: "bg-indigo-500", name: "1h", w: "w-[40px]", w2: "w-[130px]" },
                          { c: "bg-rose-500", name: "2h", w: "w-[70px]", w2: "w-[160px]" },
                          { c: "bg-amber-500", name: "4h", w: "w-[80px]", w2: "w-[140px]" }
                        ].map((m) => (
                          <div key={m.name} className="flex items-start gap-4">
                            <div className={`w-[36px] h-[36px] rounded-full ${m.c}/20 flex shrink-0 border border-rm-border`} />
                            <div className="flex-1 pt-[2px]">
                              <div className="flex items-center justify-between mb-2">
                                <div className={`h-[8px] ${m.w} bg-rm-text rounded-full`} />
                                <div className="text-[10px] text-rm-text-muted font-medium pr-1">{m.name}</div>
                              </div>
                              <div className={`h-[6px] ${m.w2} bg-rm-text-muted/60 rounded-full`} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Current theme label */}
                    <div className="text-center font-bold text-[14px] tracking-wide text-rm-text mb-3">
                      {theme === 'system' ? 'Sync with Computer' : theme === 'light' ? 'Light' : 'Midnight'}
                    </div>

                    {/* Theme swatches row */}
                    <div className="flex px-2 pb-2 items-center justify-center gap-[14px]">
                      <ThemeSwatch id="light" active={theme === 'light'} onClick={() => setTheme('light')} previewClass="bg-[#f2f3f5]" />
                      <ThemeSwatch id="dark" active={theme === 'dark'} onClick={() => setTheme('dark')} previewClass="bg-[#0f0f11]" />
                      <ThemeSwatch id="system" active={theme === 'system'} onClick={() => setTheme('system')} previewClass="bg-gradient-to-br from-[#0f0f11] to-[#f2f3f5]" />
                    </div>

                    <p className="text-center text-[12px] text-rm-text-muted mt-[18px] font-semibold">
                      This will change the theme across all your devices.
                    </p>
                  </section>
                </div>
              </div>
            )}

            {activeTab === "voice" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
                  Voice & Video
                </h1>
                <p className="text-sm text-rm-text-muted mb-6 md:mb-10">
                  Configure your media devices and audio processing preferences.
                </p>

                <div className="space-y-12">
                  {/* Hardware */}
                  <section className="space-y-6">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={16} className="text-indigo-400" />
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
                        Hardware Selection
                      </h3>
                    </div>
                    <div className="bg-rm-bg-surface border border-rm-border rounded-xl flex flex-col divide-y divide-rm-border">
                      <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-rm-bg-elevated/20 transition-colors">
                        <Label className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted shrink-0 w-[120px]">
                          Input Device
                        </Label>
                        <div className="flex-1 w-full max-w-full md:max-w-[280px]">
                          <CustomSelect
                            value={vSettings.inputDeviceId}
                            onChange={(val) => setDevice("input", val, settingsUserId ?? undefined)}
                            options={[
                              { value: "default", label: "Default" },
                              ...filteredAudioInputs.map((d) => ({
                                value: d.deviceId,
                                label:
                                  d.label ||
                                  `Microphone ${d.deviceId.slice(0, 5)}`,
                              })),
                            ]}
                          />
                        </div>
                      </div>
                      <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-rm-bg-elevated/20 transition-colors">
                        <Label className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted shrink-0 w-[120px]">
                          Output Device
                        </Label>
                        <div className="flex-1 w-full max-w-full md:max-w-[280px]">
                          <CustomSelect
                            value={vSettings.outputDeviceId}
                            onChange={(val) => setDevice("output", val, settingsUserId ?? undefined)}
                            options={[
                              { value: "default", label: "Default" },
                              ...filteredAudioOutputs.map((d) => ({
                                value: d.deviceId,
                                label:
                                  d.label || `Speaker ${d.deviceId.slice(0, 5)}`,
                              })),
                            ]}
                          />
                        </div>
                      </div>
                    </div>
                  </section>

                  <Separator className="bg-rm-border" />

                  {/* Volume */}
                  <section className="space-y-6">
                    <div className="flex items-center gap-2">
                      <Volume2 size={16} className="text-emerald-400" />
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
                        Volume & Levels
                      </h3>
                    </div>
                    <div className="bg-rm-bg-surface border border-rm-border rounded-xl flex flex-col p-4 gap-6">
                      <div className="space-y-4">
                        <div className="flex justify-between items-end px-1">
                          <label
                            htmlFor="output-volume"
                            className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted"
                          >
                            Output Volume
                          </label>
                          <span className="text-sm font-black text-indigo-400 tabular-nums">
                            {vSettings.outputVolume}%
                          </span>
                        </div>
                        <input
                          id="output-volume"
                          type="range"
                          min="0"
                          max="200"
                          value={vSettings.outputVolume}
                          onChange={(e) =>
                            handleVoiceSlider(
                              "outputVolume",
                              parseInt(e.target.value),
                            )
                          }
                          className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
                        />
                      </div>
                      {!vSettings.autoSensitivity && (
                        <>
                          <Separator className="bg-rm-border -mx-4 w-[calc(100%+2rem)] block max-w-none" />
                          <div className="space-y-4">
                            <div className="flex justify-between items-end px-1">
                              <label
                                htmlFor="input-sensitivity"
                                className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted"
                              >
                                Input Sensitivity
                              </label>
                              <span className="text-sm font-black text-amber-400 tabular-nums">
                                {vSettings.sensitivity}dB
                              </span>
                            </div>
                            <input
                              id="input-sensitivity"
                              type="range"
                              min="-100"
                              max="0"
                              value={vSettings.sensitivity}
                              onChange={(e) =>
                                handleVoiceSlider(
                                  "sensitivity",
                                  parseInt(e.target.value),
                                )
                              }
                              className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-amber-500 hover:accent-amber-400 transition-all"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </section>

                  <Separator className="bg-rm-border" />

                  {/* Audio Processing */}
                  <section className="space-y-6">
                    <div className="flex items-center gap-2">
                      <Zap size={16} className="text-amber-400" />
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
                        Audio Processing
                      </h3>
                    </div>
                    <div className="flex flex-col rounded-xl overflow-hidden bg-rm-bg-surface border border-rm-border divide-y divide-rm-border">
                      {[
                        {
                          id: "noiseSuppression",
                          label: "Noise Suppression",
                          desc: "Removes background noise like fans and keyboard clicks (Disables High Fidelity)",
                          icon: <Mic size={18} />,
                        },
                        {
                          id: "echoCancellation",
                          label: "Echo Cancellation",
                          desc: "Prevents your microphone from picking up your speakers (Disables High Fidelity)",
                          icon: <Speaker size={18} />,
                        },
                        {
                          id: "autoSensitivity",
                          label: "Input Sensitivity",
                          desc: "Automatically determine the best input volume level (Disables High Fidelity)",
                          icon: <Volume2 size={18} />,
                        },
                        {
                          id: "streamHighFidelity",
                          label: "High Fidelity Audio",
                          desc: "Disables all audio processing to allow stereo microphone input (requires headphones)",
                          icon: <Music size={18} />,
                        },
                      ].map((opt) => (
                        <div
                          key={opt.id}
                          className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-transparent hover:bg-rm-bg-elevated/40 transition-all gap-4 sm:gap-6"
                        >
                          <div className="flex items-start gap-4">
                            <div className="w-10 h-10 shrink-0 rounded-xl bg-rm-bg-elevated border border-rm-border flex items-center justify-center text-rm-text-secondary group-hover:text-rm-text transition-colors">
                              {opt.icon}
                            </div>
                            <div>
                              <h4 className="text-[14px] font-bold text-rm-text">
                                {opt.label}
                              </h4>
                              <p className="text-[12px] text-rm-text-muted leading-snug pr-2">
                                {opt.desc}
                              </p>
                            </div>
                          </div>
                          <div className="flex justify-end w-full sm:w-auto mt-2 sm:mt-0">
                            <Switch
                              checked={(vSettings as any)[opt.id]}
                              onChange={() => handleVoiceToggle(opt.id)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}
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

            {activeTab === "notifications" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
                  Notifications & Sounds
                </h1>
                <p className="text-sm text-rm-text-muted mb-6 md:mb-10">
                  Configure notification preferences and sound effects.
                </p>

                <div className="space-y-12">
                  {/* Master Sound Toggle */}
                  <section className="space-y-6">
                    <div className="flex items-center gap-2">
                      <Volume2 size={16} className="text-indigo-400" />
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
                        Sound Effects
                      </h3>
                    </div>

                    <div className="flex flex-col bg-rm-bg-surface border border-rm-border rounded-xl p-0 overflow-hidden divide-y divide-rm-border">
                      <div className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-rm-bg-elevated/40 transition-all gap-4 sm:gap-6 bg-indigo-500/5">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 shrink-0 rounded-xl bg-indigo-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
                            {soundSettings.soundsEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                          </div>
                          <div>
                            <h4 className="text-[14px] font-bold text-rm-text">Enable Sound Effects</h4>
                            <p className="text-[12px] text-rm-text-muted opacity-80">Master switch for all in-app sounds</p>
                          </div>
                        </div>
                        <div className="flex justify-end w-full sm:w-auto">
                          <Switch
                            checked={soundSettings.soundsEnabled}
                            onChange={() => updateSoundSettings({ soundsEnabled: !soundSettings.soundsEnabled })}
                          />
                        </div>
                      </div>

                      {soundSettings.soundsEnabled && (
                        <div className="p-4 space-y-4 bg-transparent fade-in animate-in">
                          <div className="flex justify-between items-end">
                            <label htmlFor="sound-volume" className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted">
                              Master Volume
                            </label>
                            <span className="text-sm font-black text-indigo-400 tabular-nums">
                              {soundSettings.soundVolume}%
                            </span>
                          </div>
                          <input
                            id="sound-volume"
                            type="range"
                            min="0"
                            max="100"
                            value={soundSettings.soundVolume}
                            onChange={(e) => updateSoundSettings({ soundVolume: parseInt(e.target.value) })}
                            className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
                          />
                        </div>
                      )}
                    </div>

                    {soundSettings.soundsEnabled && (
                      <div className="flex flex-col rounded-xl overflow-hidden bg-rm-bg-surface border border-rm-border divide-y divide-rm-border fade-in slide-in-from-top-4 animate-in">
                        {[
                          {
                            id: "notifications" as const,
                            label: "Notification Sounds",
                            desc: "Play a chime when you receive a mention, reply, or DM",
                            icon: <BellRing size={18} />,
                            color: "text-rose-400",
                            bgColor: "bg-rose-500/10 border-rose-500/20",
                          },
                          {
                            id: "voiceJoinLeave" as const,
                            label: "Voice Join / Leave",
                            desc: "Play a tone when someone joins or leaves your voice channel",
                            icon: <Headphones size={18} />,
                            color: "text-emerald-400",
                            bgColor: "bg-emerald-500/10 border-emerald-500/20",
                          },
                          {
                            id: "selfConnectDisconnect" as const,
                            label: "Connect / Disconnect",
                            desc: "Play a chime when you join or leave a voice channel",
                            icon: <Zap size={18} />,
                            color: "text-amber-400",
                            bgColor: "bg-amber-500/10 border-amber-500/20",
                          },
                          {
                            id: "muteDeafen" as const,
                            label: "Mute / Deafen",
                            desc: "Play a click when you toggle mute or deafen",
                            icon: <Mic size={18} />,
                            color: "text-violet-400",
                            bgColor: "bg-violet-500/10 border-violet-500/20",
                          },
                          {
                            id: "screenShare" as const,
                            label: "Screen Share",
                            desc: "Play a tone when starting or stopping a screen share",
                            icon: <MonitorUp size={18} />,
                            color: "text-sky-400",
                            bgColor: "bg-sky-500/10 border-sky-500/20",
                          },
                        ].map((opt) => (
                          <div
                            key={opt.id}
                            className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-rm-bg-elevated/40 transition-all gap-4 sm:gap-6"
                          >
                            <div className="flex items-start gap-4">
                              <div className={`w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center ${opt.bgColor} ${opt.color}`}>
                                {opt.icon}
                              </div>
                              <div>
                                <h4 className="text-[14px] font-bold text-rm-text">{opt.label}</h4>
                                <p className="text-[12px] text-rm-text-muted leading-snug pt-0.5">{opt.desc}</p>
                              </div>
                            </div>
                            <div className="flex justify-end w-full sm:w-auto">
                              <Switch
                                checked={soundSettings[opt.id]}
                                onChange={() => updateSoundSettings({ [opt.id]: !soundSettings[opt.id] })}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Test Sound Button */}
                    <div className="flex justify-end mt-4">
                      <button
                        onClick={() => playNotification()}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-rm-bg-elevated border border-rm-border text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text transition-all"
                      >
                        <Bell size={14} />
                        Test Notification Sound
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {activeTab === "devices" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
                  Devices
                </h1>
                <p className="text-sm text-rm-text-muted mb-8 leading-relaxed">
                  Here are all the devices that are currently logged in with your Ralph Meet account. You can log out of each one individually or all other devices.
                  <br /><br />
                  If you see an entry you don't recognize, log out of that device and change your account password immediately.
                </p>

                {sessionError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive font-medium mb-6">
                    {sessionError}
                  </div>
                )}

                {sessionsLoading && !sessions.length ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 size={32} className="animate-spin text-rm-text-muted mb-4" />
                    <p className="text-rm-text-muted font-medium">Loading devices...</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {sessions.some(s => s.isCurrent) && (
                      <section>
                        <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted mb-4">
                          Current Device
                        </h3>
                        <div className="bg-rm-bg-surface border border-rm-border rounded-xl flex flex-col divide-y divide-rm-border">
                          {sessions.filter(s => s.isCurrent).map(s => (
                            <DeviceRow key={s.id} session={s} onRevoke={handleRevokeSession} now={Date.now()} />
                          ))}
                        </div>
                      </section>
                    )}

                    {sessions.some(s => !s.isCurrent) && (
                      <section>
                        <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted mb-4">
                          Other Devices
                        </h3>
                        <div className="bg-rm-bg-surface border border-rm-border rounded-xl flex flex-col divide-y divide-rm-border">
                          {sessions.filter(s => !s.isCurrent).map(s => (
                            <DeviceRow key={s.id} session={s} onRevoke={handleRevokeSession} now={Date.now()} />
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === "os-settings" && isDesktopApp && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-2xl font-bold text-rm-text mb-2">
                  {osName} Settings
                </h1>
                <p className="text-sm text-rm-text-muted mb-8">
                  Configure how Ralph Meet behaves on your system.
                </p>

                <div className="space-y-3">
                  {/* Open on Startup */}
                  <div className="group flex items-center justify-between p-4 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg border flex items-center justify-center bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                        <Power size={18} />
                      </div>
                      <div>
                        <h4 className="text-[14px] font-bold text-rm-text">Open Ralph Meet on Startup</h4>
                        <p className="text-[12px] text-rm-text-muted">
                          Save yourself a few clicks and let Ralph Meet greet you when your computer starts.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={desktopSettings.openOnStartup}
                      onChange={() => desktopSettings.updateSettings({ openOnStartup: !desktopSettings.openOnStartup })}
                    />
                  </div>

                  {/* Start Minimized */}
                  <div className="group flex items-center justify-between p-4 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg border flex items-center justify-center bg-violet-500/10 border-violet-500/20 text-violet-400">
                        <Monitor size={18} />
                      </div>
                      <div>
                        <h4 className="text-[14px] font-bold text-rm-text">Start Minimized</h4>
                        <p className="text-[12px] text-rm-text-muted">
                          When launched on startup, Ralph Meet runs in the background so it stays out of your way.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={desktopSettings.startMinimized}
                      onChange={() => desktopSettings.updateSettings({ startMinimized: !desktopSettings.startMinimized })}
                    />
                  </div>

                  {/* Close Button Minimizes to Tray */}
                  <div className="group flex items-center justify-between p-4 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg border flex items-center justify-center bg-sky-500/10 border-sky-500/20 text-sky-400">
                        <X size={18} />
                      </div>
                      <div>
                        <h4 className="text-[14px] font-bold text-rm-text">Close Button Minimizes to Tray</h4>
                        <p className="text-[12px] text-rm-text-muted">
                          Hitting ✕ will make Ralph Meet sit back and relax in your system tray when you close the app.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={desktopSettings.closeToTray}
                      onChange={() => desktopSettings.updateSettings({ closeToTray: !desktopSettings.closeToTray })}
                    />
                  </div>
                </div>
              </div>
            )}

            {(activeTab === "accessibility" ||
              activeTab === "text") && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <h1 className="text-2xl font-bold text-rm-text mb-2 capitalize">
                    {activeTab}
                  </h1>
                  <p className="text-sm text-rm-text-muted mb-8">
                    This section is currently under development.
                  </p>

                  <div className="bg-rm-bg-surface rounded-xl border border-rm-border p-12 flex flex-col items-center justify-center text-center">
                    <div className="animate-pulse flex flex-col items-center">
                      <Zap size={48} className="text-rm-text-muted/20 mb-4" />
                      <div className="h-4 w-48 bg-rm-bg-elevated/60 rounded-full mb-3" />
                      <div className="h-3 w-32 bg-rm-bg-elevated/40 rounded-full" />
                    </div>
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
    </div >,
    document.body,
  );
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

function ThemeSwatch({
  id,
  active,
  onClick,
  previewClass,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  previewClass: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 w-[60px] h-20 rounded-2xl transition-all relative overflow-hidden",
        active
          ? "ring-2 ring-primary ring-offset-2 ring-offset-[var(--rm-bg-primary)] border-transparent"
          : "border-2 border-rm-border/30 hover:border-rm-border/60"
      )}
    >
      <div className={cn("absolute inset-0", previewClass)} />
      {id === 'system' && (
        <div className="absolute inset-0 flex items-center justify-center z-10 text-white/50 backdrop-blur-[2px]">
          <RefreshCw size={24} strokeWidth={2.5} />
        </div>
      )}
    </button>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className={cn(
        "shrink-0 w-[50px] h-[28px] rounded-[16px] relative transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        checked ? "bg-primary" : "bg-[#2b2d31]",
      )}
    >
      <div
        className={cn(
          "absolute top-[2px] left-[2px] h-[24px] w-[24px] bg-white rounded-full transition-transform duration-200 ease-in-out shadow-sm",
          checked ? "translate-x-[22px]" : "translate-x-0"
        )}
      />
    </button>
  );
}

function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select an option",
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    const clickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", clickOutside);
    return () => document.removeEventListener("mousedown", clickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between rounded-xl border border-rm-border bg-rm-bg-elevated/50 px-4 py-3 text-sm text-rm-text outline-none transition-all hover:bg-rm-bg-elevated focus:border-primary/40"
      >
        <span className="truncate">{selectedOption?.label || placeholder}</span>
        <ChevronDown
          size={16}
          className={cn(
            "text-rm-text-muted transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute z-[400] mt-2 w-full animate-in fade-in slide-in-from-top-2 rounded-xl border border-rm-border bg-rm-bg-floating p-1.5 shadow-2xl duration-200">
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all text-left",
                  opt.value === value
                    ? "bg-primary text-primary-foreground"
                    : "text-rm-text-secondary hover:bg-rm-bg-elevated hover:text-rm-text",
                )}
              >
                <span className="truncate flex-1 font-medium">{opt.label}</span>
                {opt.value === value && (
                  <Check size={14} className="shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeviceRow({ session, onRevoke, now }: { session: any, onRevoke: (id: string) => void, now: number }) {
  const Icon = session.activity?.isMobile ? Smartphone : Monitor;

  const browserName = session.activity?.browserName || (session.activity?.isMobile ? "Mobile Client" : "Desktop Client");
  const deviceType = session.activity?.deviceType || (session.activity?.isMobile ? "Mobile" : "Desktop");
  const title = `${deviceType} · ${browserName}`.toUpperCase();

  const location = [session.activity?.city, session.activity?.country].filter(Boolean).join(", ") || "Unknown Location";

  let timeAgo = "Unknown time";
  if (session.lastActiveAt) {
    const minDiff = Math.floor((now - session.lastActiveAt) / 60000);
    if (minDiff < 1) timeAgo = "less than a minute ago";
    else if (minDiff < 60) timeAgo = `less than an hour ago`;
    else if (minDiff < 1440) timeAgo = `${Math.floor(minDiff / 60)} hour${Math.floor(minDiff / 60) === 1 ? '' : 's'} ago`;
    else timeAgo = `${Math.floor(minDiff / 1440)} day${Math.floor(minDiff / 1440) === 1 ? '' : 's'} ago`;
  }

  return (
    <div className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 px-5 hover:bg-rm-bg-elevated/40 transition-all gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-[42px] h-[42px] rounded-full border border-rm-border flex items-center justify-center bg-rm-bg-elevated text-rm-text shrink-0">
          <Icon size={22} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <h4 className="text-[13px] font-bold text-rm-text truncate">{title}</h4>
          <p className="text-[13px] text-rm-text-muted truncate">
            {location}{!session.isCurrent && ` · ${timeAgo}`}
          </p>
        </div>
      </div>
      {!session.isCurrent && (
        <button
          onClick={() => onRevoke(session.id)}
          className="flex items-center justify-center w-8 h-8 rounded-full text-rm-text-muted hover:bg-destructive/10 hover:text-destructive transition-all shrink-0 self-end sm:self-auto"
        >
          <X size={20} />
        </button>
      )}
    </div>
  );
}
