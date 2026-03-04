
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiPatch, apiUpload } from "@/lib/api-client";
import { clearDesktopToken } from "@/lib/desktop-auth";
import { isTauri } from "@/lib/platform";
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
  Headphones,
  Loader2,
  LogOut,
  Mic,
  Monitor,
  MonitorUp,
  Music,
  Power,
  ShieldCheck,
  Speaker,
  Upload,
  User as UserIcon,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
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
  | "os-settings";

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { user } = useUser();
  const clk = useClerkHook();
  const navigate = useNavigate();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const chatState = useChatState();
  const loadCurrentUser = useChatStore(s => s.actions.loadCurrentUser);
  const [activeTab, setActiveTab] = useState<Tab>("account");
  const [mounted, setMounted] = useState(false);

  const handleSignOut = () => {
    if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
      clearDesktopToken();
      navigate({ to: "/", replace: true });
    } else {
      clk.signOut({ redirectUrl: "/" });
    }
  };

  // My Account state
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

  // Voice settings state
  const { audioInputs, audioOutputs, videoInputs } = useMediaDevices();
  const settingsUserId = user?.id ?? null;
  const vSettings = useVoiceSettingsStore(useShallow((s) => s.getSettings(settingsUserId)));
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const setCurrentUser = useVoiceSettingsStore((s) => s.setCurrentUser);

  // Sound settings
  const soundSettings = useSoundSettingsStore(useShallow((s) => s.getSettings(settingsUserId)));
  const updateSoundSettings = useSoundSettingsStore((s) => s.updateSettings);
  const setSoundCurrentUser = useSoundSettingsStore((s) => s.setCurrentUser);

  // Desktop (OS) settings — only relevant on Tauri desktop builds
  const isDesktop = isTauri();
  const osName = getOSName();
  const desktopSettings = useDesktopSettingsStore();

  // Sync desktop settings to Rust backend on mount
  useEffect(() => {
    if (isDesktop) {
      desktopSettings.syncToBackend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop]);

  // Ensure the store's currentUser is set so voice hooks can react to settings changes
  useEffect(() => {
    if (settingsUserId) {
      const storeUser = useVoiceSettingsStore.getState().currentUser;
      // Only set if no voice hook has already claimed the currentUser as a room namespace
      if (!storeUser || !storeUser.startsWith('room-')) {
        setCurrentUser(settingsUserId);
      }
    }
  }, [settingsUserId, setCurrentUser]);

  // Initialize sound settings store current user
  useEffect(() => {
    if (settingsUserId) {
      setSoundCurrentUser(settingsUserId);
    }
  }, [settingsUserId, setSoundCurrentUser]);

  // Filter out browser's synthetic "default" device since we add our own Default option
  const filteredAudioInputs = audioInputs.filter(d => d.deviceId !== 'default');
  const filteredAudioOutputs = audioOutputs.filter(d => d.deviceId !== 'default');

  useEffect(() => {
    setMounted(true);
  }, []);

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
        className="relative flex w-full h-full md:max-h-[820px] md:max-w-[1040px] md:rounded-xl overflow-hidden shadow-2xl bg-rm-bg-primary border border-rm-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-[218px] flex flex-col shrink-0 bg-rm-server-bar pt-[40px] md:pt-[60px] pb-5 pl-5 pr-1.5 overflow-y-auto overflow-x-hidden custom-scrollbar">
          <div className="space-y-[2px]">
            <div className="px-2 mb-2">
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                User Settings
              </h3>
            </div>
            <TabButton
              active={activeTab === "account"}
              onClick={() => setActiveTab("account")}
              label="My Account"
            />
            <TabButton
              active={activeTab === "profiles"}
              onClick={() => setActiveTab("profiles")}
              label="Profiles"
            />
            <div className="px-2 mt-[18px] mb-2">
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                App Settings
              </h3>
            </div>
            <TabButton
              active={activeTab === "appearance"}
              onClick={() => setActiveTab("appearance")}
              label="Appearance"
            />
            <TabButton
              active={activeTab === "accessibility"}
              onClick={() => setActiveTab("accessibility")}
              label="Accessibility"
            />
            <TabButton
              active={activeTab === "voice"}
              onClick={() => setActiveTab("voice")}
              label="Voice & Video"
            />
            <TabButton
              active={activeTab === "text"}
              onClick={() => setActiveTab("text")}
              label="Text & Images"
            />
            <TabButton
              active={activeTab === "notifications"}
              onClick={() => setActiveTab("notifications")}
              label="Notifications"
            />

            {isDesktop && (
              <>
                <div className="px-2 mt-[18px] mb-2">
                  <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
                    System
                  </h3>
                </div>
                <TabButton
                  active={activeTab === "os-settings"}
                  onClick={() => setActiveTab("os-settings")}
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
        <div className="flex-1 flex flex-col pt-[40px] md:pt-[60px] relative overflow-hidden bg-rm-bg-primary">
          {/* Close Button */}
          <div className="absolute right-[20px] top-[40px] md:right-[40px] md:top-[60px] z-20 flex flex-col items-center gap-2">
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-rm-border text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-all group"
            >
              <X size={18} />
            </button>
            <span className="text-[13px] font-bold text-rm-text-muted group-hover:text-rm-text-secondary hidden md:block">
              ESC
            </span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar px-[20px] md:px-[40px] pb-[60px] max-w-[740px]">
            {activeTab === "account" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-2xl font-bold text-rm-text mb-6">
                  My Account
                </h1>

                <div className="rounded-xl border border-rm-border bg-rm-bg-surface overflow-hidden shadow-2xl">
                  {/* Profile Header */}
                  <div className="h-[100px] bg-gradient-to-r from-indigo-500 to-purple-500" />
                  <div className="px-4 pb-4 -mt-12 flex items-start gap-4">
                    <div className="relative">
                      <div className="h-[80px] w-[80px] rounded-full border-[6px] border-[var(--rm-bg-surface)] bg-rm-bg-elevated overflow-hidden relative">
                        <img
                          src={avatarPreview || chatState.user?.avatar_url || user.imageUrl}
                          alt="Profile"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-indigo-500 border-2 border-[var(--rm-bg-surface)] flex items-center justify-center text-white hover:bg-indigo-400 transition-all shadow-lg"
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
                    <div className="pt-14 flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-xl font-bold text-rm-text leading-none">
                            {(user.unsafeMetadata?.displayName as string) ||
                              user.username}
                          </h2>
                          <p className="text-sm text-rm-text-muted mt-1">
                            @{user.username}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          className="bg-primary hover:brightness-110 text-primary-foreground text-xs"
                        >
                          Edit User Profile
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-rm-bg-elevated/50 m-4 rounded-lg border border-rm-border space-y-4">
                    <div className="flex items-center justify-between group cursor-pointer p-2 rounded hover:bg-rm-bg-elevated">
                      <div>
                        <p className="text-[11px] font-bold uppercase text-rm-text-secondary tracking-wider">
                          Display Name
                        </p>
                        <p className="text-sm text-rm-text mt-1">
                          {displayName}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="bg-rm-bg-elevated hover:bg-primary/10 hover:text-primary text-rm-text h-8"
                      >
                        Edit
                      </Button>
                    </div>
                    <div className="flex items-center justify-between group cursor-pointer p-2 rounded hover:bg-rm-bg-elevated">
                      <div>
                        <p className="text-[11px] font-bold uppercase text-rm-text-secondary tracking-wider">
                          Username
                        </p>
                        <p className="text-sm text-rm-text mt-1">{username}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="bg-rm-bg-elevated hover:bg-primary/10 hover:text-primary text-rm-text h-8"
                      >
                        Edit
                      </Button>
                    </div>
                    <div className="flex items-center justify-between group cursor-pointer p-2 rounded hover:bg-rm-bg-elevated">
                      <div>
                        <p className="text-[11px] font-bold uppercase text-rm-text-secondary tracking-wider">
                          Email
                        </p>
                        <p className="text-sm text-rm-text mt-1">
                          {user.primaryEmailAddress?.emailAddress}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="bg-rm-bg-elevated text-rm-text-muted h-8"
                        disabled
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Edit Form */}
                <div className="mt-8 pt-8 border-t border-rm-border space-y-6">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-rm-text-muted tracking-wider">
                      Edit Display Name
                    </Label>
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="bg-rm-bg-floating border-rm-border text-rm-text focus:ring-primary/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-rm-text-muted tracking-wider">
                      Edit Username
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rm-text-muted/40 text-sm">
                        @
                      </span>
                      <Input
                        value={username}
                        onChange={handleUsernameChange}
                        className="pl-7 bg-rm-bg-floating border-rm-border text-rm-text focus:ring-primary/20"
                      />
                    </div>
                    {usernameStatus !== "idle" && usernameStatus !== "own" && (
                      <p
                        className={cn(
                          "text-[12px] mt-1 flex items-center gap-1",
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

                  <div className="pt-4 flex items-center justify-between">
                    <p className="text-xs text-rm-text-muted italic">
                      Changes will be reflected across all your servers
                    </p>
                    {error && (
                      <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-2.5 text-sm text-destructive font-medium mb-3">
                        {error}
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <Button
                        variant="ghost"
                        onClick={() => setActiveTab("account")}
                        className="text-rm-text-muted hover:text-rm-text"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleSaveProfile}
                        disabled={saving}
                        className="bg-primary hover:brightness-110 text-primary-foreground min-w-[100px]"
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
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-2xl font-bold text-rm-text mb-2">
                  Appearance
                </h1>
                <p className="text-sm text-rm-text-muted mb-8">
                  Customize how Ralph Meet looks. Choose between dark, light, or
                  sync with your system.
                </p>

                <div className="space-y-8">
                  <section>
                    <h3 className="text-[12px] font-bold uppercase tracking-widest text-rm-text-muted mb-4">
                      Theme
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <ThemeCard
                        id="dark"
                        label="Dark"
                        active={theme === "dark"}
                        onClick={() => setTheme("dark")}
                        previewClass="bg-[#0f0f11]"
                        accentClass="bg-[#5865f2]"
                      />
                      <ThemeCard
                        id="light"
                        label="Light"
                        active={theme === "light"}
                        onClick={() => setTheme("light")}
                        previewClass="bg-[#f2f3f5]"
                        accentClass="bg-[#5865f2]"
                      />
                      <ThemeCard
                        id="system"
                        label="Sync with Computer"
                        active={theme === "system"}
                        onClick={() => setTheme("system")}
                        previewClass="bg-gradient-to-br from-[#0f0f11] to-[#f2f3f5]"
                        accentClass="bg-primary"
                      />
                    </div>
                  </section>

                  <Separator className="bg-rm-border" />

                  <section className="bg-rm-bg-elevated/40 border border-rm-border rounded-2xl p-6">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-xl bg-primary/10 text-primary border border-primary/20">
                        <Monitor size={24} />
                      </div>
                      <div>
                        <h4 className="text-md font-bold text-rm-text mb-1">
                          Visual Accessibility
                        </h4>
                        <p className="text-sm text-rm-text-muted max-w-[500px]">
                          Ralph Meet is designed to be easy on the eyes. Our
                          dark mode uses true black and slate tones to reduce
                          blue light exposure and ocular strain during late
                          night gaming sessions.
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {activeTab === "voice" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-2xl font-bold text-rm-text mb-2">
                  Voice & Video
                </h1>
                <p className="text-sm text-rm-text-muted mb-10">
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted ml-1">
                          Input Device
                        </Label>
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
                      <div className="space-y-2">
                        <Label className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted ml-1">
                          Output Device
                        </Label>
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
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
                    <div className="grid grid-cols-1 gap-4">
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
                          className="group flex items-center justify-between p-4 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-rm-bg-surface flex items-center justify-center text-rm-text-muted group-hover:text-rm-text-secondary">
                              {opt.icon}
                            </div>
                            <div>
                              <h4 className="text-[14px] font-bold text-rm-text">
                                {opt.label}
                              </h4>
                              <p className="text-[12px] text-rm-text-muted">
                                {opt.desc}
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={(vSettings as any)[opt.id]}
                            onChange={() => handleVoiceToggle(opt.id)}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}
            {activeTab === "profiles" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-2xl font-bold text-rm-text mb-2">
                  Profiles
                </h1>
                <p className="text-sm text-rm-text-muted mb-8">
                  You can use a different identity across all your servers.
                </p>

                <div className="bg-rm-bg-surface rounded-xl border border-rm-border p-6 flex flex-col items-center justify-center min-h-[300px] text-center">
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

            {activeTab === "notifications" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-2xl font-bold text-rm-text mb-2">
                  Notifications & Sounds
                </h1>
                <p className="text-sm text-rm-text-muted mb-10">
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

                    <div className="group flex items-center justify-between p-4 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                          {soundSettings.soundsEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                        </div>
                        <div>
                          <h4 className="text-[14px] font-bold text-rm-text">Enable Sound Effects</h4>
                          <p className="text-[12px] text-rm-text-muted">Master switch for all in-app sounds</p>
                        </div>
                      </div>
                      <Switch
                        checked={soundSettings.soundsEnabled}
                        onChange={() => updateSoundSettings({ soundsEnabled: !soundSettings.soundsEnabled })}
                      />
                    </div>

                    {soundSettings.soundsEnabled && (
                      <>
                        {/* Sound Volume */}
                        <div className="space-y-4 px-1">
                          <div className="flex justify-between items-end">
                            <label htmlFor="sound-volume" className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted">
                              Sound Volume
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

                        {/* Individual Sound Toggles */}
                        <div className="grid grid-cols-1 gap-3">
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
                              className="group flex items-center justify-between p-4 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all"
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${opt.bgColor} ${opt.color}`}>
                                  {opt.icon}
                                </div>
                                <div>
                                  <h4 className="text-[14px] font-bold text-rm-text">{opt.label}</h4>
                                  <p className="text-[12px] text-rm-text-muted">{opt.desc}</p>
                                </div>
                              </div>
                              <Switch
                                checked={soundSettings[opt.id]}
                                onChange={() => updateSoundSettings({ [opt.id]: !soundSettings[opt.id] })}
                              />
                            </div>
                          ))}
                        </div>

                        {/* Test Sound Button */}
                        <div className="flex justify-end">
                          <button
                            onClick={() => playNotification()}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-rm-bg-elevated border border-rm-border text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text transition-all"
                          >
                            <Bell size={14} />
                            Test Notification Sound
                          </button>
                        </div>
                      </>
                    )}
                  </section>
                </div>
              </div>
            )}

            {activeTab === "os-settings" && isDesktop && (
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
    </div>,
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

function ThemeCard({
  id,
  label,
  active,
  onClick,
  previewClass,
  accentClass,
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
  previewClass: string;
  accentClass: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col gap-3 group text-left",
        active
          ? "opacity-100"
          : "opacity-60 hover:opacity-100 transition-opacity",
      )}
    >
      <div
        className={cn(
          "relative aspect-[16/10] w-full rounded-xl border-2 transition-all overflow-hidden",
          active
            ? "border-primary shadow-[0_0_20px_var(--rm-glow)]"
            : "border-rm-border group-hover:border-rm-text-muted/20",
        )}
      >
        <div className={cn("absolute inset-0", previewClass)} />
        {/* Mock UI in theme card */}
        <div className="absolute top-2 left-2 right-2 h-3 flex gap-1">
          <div className="w-6 h-1 rounded-full bg-rm-bg-elevated" />
          <div className="w-4 h-1 rounded-full bg-rm-bg-elevated opacity-50" />
        </div>
        <div className="absolute left-2 top-6 bottom-2 w-10 bg-rm-bg-primary/20 rounded-lg border border-rm-border" />
        <div className="absolute left-14 top-6 bottom-2 right-2 space-y-2">
          <div className="h-6 bg-rm-bg-primary/20 rounded-lg border border-rm-border flex items-center px-2">
            <div className={cn("w-2 h-2 rounded-full", accentClass)} />
          </div>
          <div className="h-10 bg-rm-bg-primary/20 rounded-lg border border-rm-border" />
        </div>

        {active && (
          <div className="absolute bottom-2 right-2 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg animate-in zoom-in-50">
            <Check size={14} />
          </div>
        )}
      </div>
      <p
        className={cn(
          "text-[13px] font-bold px-1",
          active ? "text-rm-text" : "text-rm-text-muted",
        )}
      >
        {label}
      </p>
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
        "w-12 h-6 rounded-full relative transition-all duration-300 ring-2 ring-transparent focus:ring-primary/40",
        checked ? "bg-primary" : "bg-rm-bg-elevated",
      )}
    >
      <div
        className={cn(
          "absolute top-1 left-1 bottom-1 aspect-square bg-white rounded-full transition-all duration-300 shadow-sm",
          checked ? "translate-x-6" : "translate-x-0",
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
