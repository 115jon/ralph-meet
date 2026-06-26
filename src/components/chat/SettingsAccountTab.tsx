import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api-client";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useUser } from "@kova/react";
import { AlertTriangle, Check, Loader2, Trash2, Upload, UserRoundCheck } from "lucide-react";
import { clog } from "@/lib/console-logger";
import { useCallback, useEffect, useRef, useState } from "react";

const log = clog("Profile");

type ClaimCandidate = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  match_method: string;
};

type AssetPreview = {
  url: string;
  contentType: string;
};

function createAssetPreview(file: File): AssetPreview {
  return {
    url: URL.createObjectURL(file),
    contentType: file.type || "application/octet-stream",
  };
}

function useAccountState(user: any, chatUser: any) {
  const [displayName, setDisplayName] = useState(
    () =>
      chatUser?.display_name ||
      (user?.unsafeMetadata?.displayName as string) ||
      user?.fullName ||
      user?.firstName ||
      "",
  );
  const [username, setUsername] = useState(() => chatUser?.username || user?.username || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid" | "own"
  >("idle");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<AssetPreview | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [nameplatePreview, setNameplatePreview] = useState<AssetPreview | null>(null);
  const [nameplateFile, setNameplateFile] = useState<File | null>(null);
  const [removeBanner, setRemoveBanner] = useState(false);
  const [removeNameplate, setRemoveNameplate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const nameplateInputRef = useRef<HTMLInputElement>(null);
  const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const lastUserId = useRef(user?.id);
  if (user?.id !== lastUserId.current) {
    setDisplayName(
      chatUser?.display_name ||
      (user?.unsafeMetadata?.displayName as string) ||
      user?.fullName ||
      user?.firstName ||
      "",
    );
    setUsername(chatUser?.username || user?.username || "");
    setError(null);
    setSaved(false);
    setUsernameStatus("idle");
    setAvatarPreview(null);
    setAvatarFile(null);
    setBannerPreview(null);
    setBannerFile(null);
    setNameplatePreview(null);
    setNameplateFile(null);
    setRemoveBanner(false);
    setRemoveNameplate(false);
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
    bannerPreview, setBannerPreview,
    bannerFile, setBannerFile,
    nameplatePreview, setNameplatePreview,
    nameplateFile, setNameplateFile,
    removeBanner, setRemoveBanner,
    removeNameplate, setRemoveNameplate,
    fileInputRef, checkTimeoutRef, abortRef,
    bannerInputRef,
    nameplateInputRef,
  };
}

export default function SettingsAccountTab({ authUserLoaded = true }: { authUserLoaded?: boolean }) {
  const { user } = useUser();
  const chatUser = useChatStore(s => s.user);
  const loadCurrentUser = useChatStore(s => s.actions.loadCurrentUser);

  const {
    displayName, setDisplayName,
    username, setUsername,
    saving, setSaving,
    saved, setSaved,
    error, setError,
    usernameStatus, setUsernameStatus,
    avatarPreview, setAvatarPreview,
    avatarFile, setAvatarFile,
    bannerPreview, setBannerPreview,
    bannerFile, setBannerFile,
    nameplatePreview, setNameplatePreview,
    nameplateFile, setNameplateFile,
    removeBanner, setRemoveBanner,
    removeNameplate, setRemoveNameplate,
    fileInputRef, checkTimeoutRef, abortRef,
    bannerInputRef,
    nameplateInputRef,
  } = useAccountState(user, chatUser);
  const [claimCandidates, setClaimCandidates] = useState<ClaimCandidate[]>([]);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setClaimLoading(true);
    setClaimError(null);
    apiGet<{ claimed: boolean; candidates: ClaimCandidate[] }>("/api/account-claims")
      .then((data) => {
        if (!cancelled) setClaimCandidates(data.claimed ? [] : data.candidates);
      })
      .catch((err) => {
        if (!cancelled) setClaimError(err instanceof Error ? err.message : "Unable to check claimable accounts.");
      })
      .finally(() => {
        if (!cancelled) setClaimLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!avatarPreview?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  useEffect(() => {
    if (!bannerPreview?.url.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(bannerPreview.url);
  }, [bannerPreview]);

  useEffect(() => {
    if (!nameplatePreview?.url.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(nameplatePreview.url);
  }, [nameplatePreview]);

  const hasChanges =
    displayName !== (chatUser?.display_name || (user?.unsafeMetadata?.displayName as string) || user?.username || "") ||
    username !== (chatUser?.username || user?.username || "") ||
    avatarFile !== null ||
    bannerFile !== null ||
    nameplateFile !== null ||
    removeBanner ||
    removeNameplate;

  const currentAvatarSrc = avatarPreview
    || (chatUser?.avatar_url ? getAuthAssetUrl(chatUser.avatar_url) : null)
    || user?.imageUrl
    || undefined;

  const currentBannerUrl = removeBanner
    ? null
    : bannerPreview?.url || chatUser?.banner_url || null;
  const currentBannerContentType = removeBanner
    ? null
    : bannerPreview?.contentType || chatUser?.banner_content_type || null;
  const currentNameplateUrl = removeNameplate
    ? null
    : nameplatePreview?.url || chatUser?.nameplate_url || null;
  const currentNameplateContentType = removeNameplate
    ? null
    : nameplatePreview?.contentType || chatUser?.nameplate_content_type || null;

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
    [user?.username, checkTimeoutRef, abortRef, setUsernameStatus],
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

  const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRemoveBanner(false);
    setBannerFile(file);
    setBannerPreview(createAssetPreview(file));
  };

  const handleNameplateSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRemoveNameplate(false);
    setNameplateFile(file);
    setNameplatePreview(createAssetPreview(file));
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

      if (bannerFile) {
        const formData = new FormData();
        formData.append("kind", "banner");
        formData.append("file", bannerFile);
        await apiUpload<{ url: string; content_type: string }>("/api/profile-assets/manage", formData);
        setBannerFile(null);
        setBannerPreview(null);
        setRemoveBanner(false);
      } else if (removeBanner && chatUser?.banner_url) {
        await apiDelete<{ ok: true }, { kind: "banner" }>("/api/profile-assets/manage", { kind: "banner" });
        setRemoveBanner(false);
      }

      if (nameplateFile) {
        const formData = new FormData();
        formData.append("kind", "nameplate");
        formData.append("file", nameplateFile);
        await apiUpload<{ url: string; content_type: string }>("/api/profile-assets/manage", formData);
        setNameplateFile(null);
        setNameplatePreview(null);
        setRemoveNameplate(false);
      } else if (removeNameplate && chatUser?.nameplate_url) {
        await apiDelete<{ ok: true }, { kind: "nameplate" }>("/api/profile-assets/manage", { kind: "nameplate" });
        setRemoveNameplate(false);
      }

      if (typeof user.reload === "function") {
        await user.reload();
      }
      await loadCurrentUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      log.error("Failed to save:", err);
      setError(err instanceof Error ? err.message : "Failed to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    user,
    displayName,
    username,
    avatarFile,
    bannerFile,
    nameplateFile,
    removeBanner,
    removeNameplate,
    chatUser?.banner_url,
    chatUser?.nameplate_url,
    loadCurrentUser,
    setSaving,
    setSaved,
    setError,
    setAvatarPreview,
    setAvatarFile,
    setBannerPreview,
    setBannerFile,
    setNameplatePreview,
    setNameplateFile,
    setRemoveBanner,
    setRemoveNameplate,
  ]);

  const handleClaimAccount = useCallback(async (legacyUserId: string) => {
    setClaimingId(legacyUserId);
    setClaimError(null);
    try {
      await apiPost("/api/account-claims", { legacyUserId });
      await loadCurrentUser();
      setClaimCandidates([]);
      window.location.reload();
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Unable to claim that account.");
    } finally {
      setClaimingId(null);
    }
  }, [loadCurrentUser]);

  if (!user) {
    return (
      <div className="animate-in fade-in slide-in-from-right-4 duration-300">
        <h1 className="text-2xl font-bold text-rm-text mb-6 hidden md:block">
          My Account
        </h1>
        <div className="rounded-xl border border-rm-border bg-rm-bg-surface p-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
              {authUserLoaded ? <AlertTriangle size={18} /> : <Loader2 size={18} className="animate-spin" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-rm-text">
                {authUserLoaded ? "Account profile unavailable" : "Loading account profile"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-rm-text-secondary">
                {authUserLoaded
                  ? "Your chat session is active, but the auth profile did not load. Other settings are still available."
                  : "We are still resolving your Ralph Auth profile."}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <h1 className="text-2xl font-bold text-rm-text mb-6 hidden md:block">
        My Account
      </h1>

      <div className="rounded-xl border border-rm-border bg-rm-bg-surface overflow-hidden md:shadow-xl mb-6">
        {/* Profile Header */}
        <div className="relative h-[96px] md:h-[132px] overflow-hidden bg-linear-to-r from-[#6f5d46] via-[#8b6f4e] to-[#4e6588]">
          <ProfileAssetLayer
            url={currentBannerUrl}
            contentType={currentBannerContentType}
            alt="Profile banner"
            className="opacity-95"
          />
          <div className="absolute inset-0 bg-linear-to-r from-black/18 via-transparent to-black/28" />
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            {currentBannerUrl && (
              <button
                onClick={() => {
                  setRemoveBanner(true);
                  setBannerFile(null);
                  setBannerPreview(null);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white transition-colors hover:bg-black/55"
                title="Remove banner"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              onClick={() => bannerInputRef.current?.click()}
              className="flex items-center gap-2 rounded-full bg-black/35 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-black/55"
            >
              <Upload size={14} />
              Banner
            </button>
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/*"
              onChange={handleBannerSelect}
              className="hidden"
            />
          </div>
        </div>
        <div className="px-4 pb-4 -mt-10 md:-mt-12 flex flex-col items-center md:flex-row md:items-start md:gap-4 text-center md:text-left">
          <div className="relative shrink-0 mb-3 md:mb-0">
            <div className="h-[80px] w-[80px] md:h-[80px] md:w-[80px] rounded-full border-[6px] border-[var(--rm-bg-surface)] bg-rm-bg-elevated overflow-hidden relative shadow-md">
              {currentAvatarSrc ? (
                <img
                  src={currentAvatarSrc}
                  alt="Profile"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-primary text-2xl font-bold text-primary-foreground">
                  {getDisplayInitial({ name: chatUser?.display_name || chatUser?.username || user.username })}
                </div>
              )}
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
              {chatUser?.display_name || chatUser?.username || user.username}
            </h2>
            <p className="text-sm text-rm-text-muted">
              @{chatUser?.username || user.username}
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-rm-border bg-rm-bg-surface p-4 md:p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-rm-text">Member Nameplate</h3>
            <p className="mt-1 text-xs leading-5 text-rm-text-secondary">
              Shown behind your member entry in server sidebars. Animated images and short looping video are supported.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {currentNameplateUrl && (
              <button
                onClick={() => {
                  setRemoveNameplate(true);
                  setNameplateFile(null);
                  setNameplatePreview(null);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-rm-border bg-rm-bg-elevated text-rm-text-muted transition-colors hover:text-rm-text"
                title="Remove nameplate"
              >
                <Trash2 size={14} />
              </button>
            )}
            <Button
              type="button"
              variant="outline"
              className="border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover"
              onClick={() => nameplateInputRef.current?.click()}
            >
              <Upload size={14} />
              Change
            </Button>
            <input
              ref={nameplateInputRef}
              type="file"
              accept="image/*,video/mp4,video/webm,video/ogg"
              onChange={handleNameplateSelect}
              className="hidden"
            />
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-rm-border/70 bg-rm-bg-elevated">
          <div className="relative m-3 overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface">
            <ProfileAssetLayer
              url={currentNameplateUrl}
              contentType={currentNameplateContentType}
              alt="Nameplate preview"
              className="opacity-75"
            />
            <div className="absolute inset-0 bg-linear-to-r from-black/60 via-black/35 to-black/60" />
            <div className="relative z-10 flex items-center gap-3 p-3">
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/15 bg-primary text-xs font-bold text-primary-foreground">
                {currentAvatarSrc ? (
                  <img src={currentAvatarSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    {getDisplayInitial({ name: chatUser?.display_name || chatUser?.username || user.username })}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-white">
                  {chatUser?.display_name || chatUser?.username || user.username}
                </div>
                <div className="truncate text-xs text-white/70">
                  {chatUser?.custom_status || "Your nameplate preview appears here."}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {(claimLoading || claimCandidates.length > 0 || claimError) && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
              {claimLoading ? <Loader2 size={18} className="animate-spin" /> : <UserRoundCheck size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-rm-text">Claim Existing Ralph Meet Account</h3>
              <p className="mt-1 text-sm text-rm-text-secondary">
                Move servers, messages, friends, DMs, and profile data from a matching pre-migration account to this Ralph Auth login.
              </p>
              {claimError && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle size={14} />
                  {claimError}
                </div>
              )}
              {claimCandidates.length > 0 && (
                <div className="mt-4 space-y-2">
                  {claimCandidates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="flex flex-col gap-3 rounded-lg border border-rm-border bg-rm-bg-elevated/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-rm-bg-primary">
                          {candidate.avatar_url ? (
                            <img src={candidate.avatar_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm font-bold text-rm-text-muted">
                              {getDisplayInitial(candidate)}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-rm-text">
                            {candidate.display_name || candidate.username}
                          </p>
                          <p className="truncate text-xs text-rm-text-muted">@{candidate.username}</p>
                        </div>
                      </div>
                      <Button
                        onClick={() => handleClaimAccount(candidate.id)}
                        disabled={claimingId !== null}
                        className="bg-amber-500 text-black hover:bg-amber-400"
                      >
                        {claimingId === candidate.id ? <Loader2 size={16} className="animate-spin" /> : "Claim"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Form */}
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
                setDisplayName(chatUser?.display_name || (user?.unsafeMetadata?.displayName as string) || user?.username || "");
                setUsername(chatUser?.username || user?.username || "");
                setAvatarFile(null);
                setAvatarPreview(null);
                setBannerFile(null);
                setBannerPreview(null);
                setNameplateFile(null);
                setNameplatePreview(null);
                setRemoveBanner(false);
                setRemoveNameplate(false);
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
  );
}
