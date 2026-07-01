import { AvatarFrameEditor } from "@/components/chat/AvatarFrameEditor";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { CollectiblesCatalogModal } from "@/components/chat/CollectiblesCatalogModal";
import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api-client";
import { getAvatarCollectibles, serializeAvatarDisplay, type AvatarDisplay } from "@/lib/avatar-display";
import type { CollectibleKind } from "@/lib/collectibles-catalog";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useUser } from "@kova/react";
import { AlertTriangle, Check, Crop, Loader2, Pencil, Sparkles, Trash2, Upload, UserRoundCheck, X } from "lucide-react";
import { clog } from "@/lib/console-logger";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const log = clog("Profile");

type ClaimCandidate = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_display?: AvatarDisplay | string | null;
  match_method: string;
};

type AssetPreview = {
  url: string;
  contentType: string;
};

type CollectibleApplyUser = {
  avatar_display: AvatarDisplay | null;
  nameplate_url: string | null;
  nameplate_content_type: string | null;
  updated_at: string | null;
};

const SETTINGS_TOOLTIP_CONTENT_CLASS =
  "bg-rm-bg-floating border border-rm-border text-rm-text-primary text-[12px] font-bold shadow-xl px-3 py-2 rounded-lg";

function createAssetPreview(file: File): AssetPreview {
  return {
    url: URL.createObjectURL(file),
    contentType: file.type || "application/octet-stream",
  };
}

function AccountActionIconButton({
  label,
  onClick,
  children,
  disabled = false,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "rounded-full border-rm-border bg-rm-bg-surface text-rm-text shadow-sm hover:bg-rm-bg-hover hover:text-rm-text",
            className,
          )}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={10} className={SETTINGS_TOOLTIP_CONTENT_CLASS}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ProfileEditorTile({
  title,
  status,
  helper,
  preview,
  actions,
  className,
}: {
  title: string;
  status: string;
  helper?: string;
  preview: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "group/tile overflow-hidden rounded-[28px] border border-white/8 bg-[#101216] p-4 shadow-[0_22px_60px_rgba(0,0,0,0.28)] transition duration-300 hover:-translate-y-1 hover:scale-[1.015] hover:border-white/16",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-rm-text-muted">{title}</div>
          <h3 className="mt-2 text-sm font-semibold text-rm-text">{status}</h3>
          {helper ? <p className="mt-1 text-xs leading-5 text-rm-text-muted">{helper}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2 opacity-100 transition duration-200 md:opacity-0 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100">
            {actions}
          </div>
        ) : null}
      </div>
      <div className="mt-4">{preview}</div>
    </section>
  );
}

function isManagedNameplateUrl(url: string | null | undefined) {
  return typeof url === "string" && url.startsWith("/api/profile-assets/nameplate/");
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

export default function SettingsAccountTab({
  authUserLoaded = true,
  asModal = false,
  onClose,
}: {
  authUserLoaded?: boolean;
  asModal?: boolean;
  onClose?: () => void;
}) {
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
  const [avatarDisplay, setAvatarDisplay] = useState<AvatarDisplay | string | null>(() => chatUser?.avatar_display ?? null);
  const [avatarDisplayChanged, setAvatarDisplayChanged] = useState(false);
  const [avatarEditor, setAvatarEditor] = useState<{ src: string; file?: File } | null>(null);
  const [collectiblesKind, setCollectiblesKind] = useState<CollectibleKind | null>(null);
  const [collectibleActionKind, setCollectibleActionKind] = useState<CollectibleKind | null>(null);

  useEffect(() => {
    if (!avatarDisplayChanged && !avatarFile) {
      setAvatarDisplay(chatUser?.avatar_display ?? null);
    }
  }, [avatarDisplayChanged, avatarFile, chatUser?.avatar_display]);

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
    avatarDisplayChanged ||
    bannerFile !== null ||
    nameplateFile !== null ||
    removeBanner ||
    removeNameplate;

  const currentAvatarSrc = avatarPreview
    || (chatUser?.avatar_url ? getAuthAssetUrl(chatUser.avatar_url) : null)
    || user?.imageUrl
    || undefined;
  const currentAvatarDisplay = avatarDisplayChanged || avatarFile
    ? avatarDisplay
    : chatUser?.avatar_display ?? null;
  const currentDisplayName = displayName.trim() || chatUser?.display_name || chatUser?.username || user?.username || "Profile";
  const currentUsername = username.trim() || chatUser?.username || user?.username || "profile";
  const currentCollectibles = getAvatarCollectibles(currentAvatarDisplay);
  const currentAvatarDecoration = currentCollectibles?.avatarDecoration;
  const currentProfileEffect = currentCollectibles?.profileEffect;
  const currentNameplateSelection = currentCollectibles?.nameplate;

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
  const nameplateStatus = removeNameplate
    ? "Nameplate will be removed when you save."
    : nameplateFile
      ? `Pending upload: ${nameplateFile.name}`
      : currentNameplateSelection?.name
        ? `Selected collectible: ${currentNameplateSelection.name}`
        : currentNameplateUrl
          ? "Custom nameplate active"
          : "No nameplate selected";
  const bannerStatus = removeBanner
    ? "Banner will be removed when you save."
    : bannerFile
      ? `Pending upload: ${bannerFile.name}`
      : currentBannerUrl
        ? "Profile banner active"
        : "No banner selected";
  const nameplateAssetUrl = currentNameplateUrl || currentNameplateSelection?.staticUrl || null;
  const profileEffectPosterUrl =
    currentProfileEffect?.staticUrl
    || currentProfileEffect?.previewUrl
    || currentProfileEffect?.animatedUrl
    || null;

  const syncCollectibleState = useCallback(async (updatedUser: CollectibleApplyUser) => {
    setAvatarDisplay(updatedUser.avatar_display);
    setRemoveNameplate(false);
    setNameplateFile(null);
    setNameplatePreview(null);
    if (typeof user?.reload === "function") {
      await user.reload();
    }
    await loadCurrentUser();
    setAvatarDisplayChanged(Boolean(avatarFile));
  }, [
    avatarFile,
    loadCurrentUser,
    setAvatarDisplay,
    setAvatarDisplayChanged,
    setNameplateFile,
    setNameplatePreview,
    setRemoveNameplate,
    user,
  ]);

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
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file for your avatar.");
      return;
    }
    const src = URL.createObjectURL(file);
    setAvatarEditor({ src, file });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleEditAvatarFrame = () => {
    if (!currentAvatarSrc) return;
    setAvatarEditor({ src: currentAvatarSrc });
  };

  const handleAvatarFrameCancel = () => {
    if (avatarEditor?.file && avatarEditor.src.startsWith("blob:")) {
      URL.revokeObjectURL(avatarEditor.src);
    }
    setAvatarEditor(null);
  };

  const handleAvatarFrameConfirm = (display: AvatarDisplay) => {
    if (!avatarEditor) return;
    if (avatarEditor.file) {
      setAvatarFile(avatarEditor.file);
      setAvatarPreview(avatarEditor.src);
    }
    setAvatarDisplay(display);
    setAvatarDisplayChanged(true);
    setAvatarEditor(null);
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
    setError(null);
    setNameplateFile(file);
    setNameplatePreview(createAssetPreview(file));
  };

  const handleOpenCollectibles = useCallback((kind: CollectibleKind = "avatar_decoration") => {
    setCollectiblesKind(kind);
  }, []);

  const handleRemoveCollectible = useCallback(async (kind: CollectibleKind) => {
    if (!user) return;
    setCollectibleActionKind(kind);
    setError(null);
    try {
      const data = await apiPatch<{ ok: true; user: CollectibleApplyUser }>("/api/collectibles/apply", {
        kind,
        skuId: null,
        avatarDisplay: currentAvatarDisplay ?? null,
      });
      await syncCollectibleState(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile collectible.");
    } finally {
      setCollectibleActionKind(null);
    }
  }, [currentAvatarDisplay, setCollectibleActionKind, setError, syncCollectibleState, user]);

  const handleRemoveNameplate = useCallback(async () => {
    if (nameplateFile || nameplatePreview) {
      setRemoveNameplate(true);
      setNameplateFile(null);
      setNameplatePreview(null);
      return;
    }

    const savedNameplateUrl = chatUser?.nameplate_url ?? null;
    if (!savedNameplateUrl && !currentNameplateSelection) {
      return;
    }

    setCollectibleActionKind("nameplate");
    setError(null);
    try {
      if (savedNameplateUrl && isManagedNameplateUrl(savedNameplateUrl)) {
        await apiDelete<{ ok: true }, { kind: "nameplate" }>("/api/profile-assets/manage", { kind: "nameplate" });
      }

      if (!savedNameplateUrl || !isManagedNameplateUrl(savedNameplateUrl) || currentNameplateSelection) {
        const data = await apiPatch<{ ok: true; user: CollectibleApplyUser }>("/api/collectibles/apply", {
          kind: "nameplate",
          skuId: null,
          avatarDisplay: currentAvatarDisplay ?? null,
        });
        await syncCollectibleState(data.user);
      } else {
        setRemoveNameplate(false);
        setNameplateFile(null);
        setNameplatePreview(null);
        if (typeof user?.reload === "function") {
          await user.reload();
        }
        await loadCurrentUser();
        setAvatarDisplayChanged(Boolean(avatarFile));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove nameplate.");
    } finally {
      setCollectibleActionKind(null);
    }
  }, [
    avatarFile,
    chatUser?.nameplate_url,
    currentAvatarDisplay,
    currentNameplateSelection,
    loadCurrentUser,
    nameplateFile,
    nameplatePreview,
    setAvatarDisplayChanged,
    setCollectibleActionKind,
    setError,
    setNameplateFile,
    setNameplatePreview,
    setRemoveNameplate,
    syncCollectibleState,
    user,
  ]);

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
        ...(avatarDisplayChanged && !avatarFile ? { avatarDisplay } : {}),
      });

      if (avatarFile) {
        const formData = new FormData();
        formData.append("file", avatarFile);
        const serializedDisplay = serializeAvatarDisplay(avatarDisplay);
        if (serializedDisplay) formData.append("avatar_display", serializedDisplay);
        const uploaded = await apiUpload<{ url: string; avatar_display: AvatarDisplay | null }>("/api/avatar-upload", formData);
        setAvatarFile(null);
        setAvatarPreview(null);
        setAvatarDisplay(uploaded.avatar_display);
        setAvatarDisplayChanged(false);
      } else if (avatarDisplayChanged) {
        setAvatarDisplayChanged(false);
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
      } else if (removeNameplate) {
        const savedNameplateUrl = chatUser?.nameplate_url ?? null;
        if (savedNameplateUrl && isManagedNameplateUrl(savedNameplateUrl)) {
          await apiDelete<{ ok: true }, { kind: "nameplate" }>("/api/profile-assets/manage", { kind: "nameplate" });
        }
        if (!savedNameplateUrl || !isManagedNameplateUrl(savedNameplateUrl) || currentNameplateSelection) {
          const data = await apiPatch<{ ok: true; user: CollectibleApplyUser }>("/api/collectibles/apply", {
            kind: "nameplate",
            skuId: null,
            avatarDisplay: currentAvatarDisplay ?? null,
          });
          setAvatarDisplay(data.user.avatar_display);
        }
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
    avatarDisplay,
    avatarDisplayChanged,
    bannerFile,
    nameplateFile,
    removeBanner,
    removeNameplate,
    chatUser?.banner_url,
    chatUser?.nameplate_url,
    currentAvatarDisplay,
    currentNameplateSelection,
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
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rm-accent/15 text-rm-accent">
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
    <div className={cn("animate-in fade-in slide-in-from-right-4 duration-300", asModal && "h-full overflow-y-auto bg-[#09090d] custom-scrollbar")}>
      {asModal ? (
        <div className="sticky top-0 z-20 border-b border-white/8 bg-[#09090d]/95 backdrop-blur">
          <div className="flex items-start justify-between gap-4 px-5 py-4 md:px-7 md:py-5">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-rm-text-muted">Profiles</div>
              <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-rm-text">Edit Profile</h1>
              <p className="mt-1 text-sm text-rm-text-secondary">
                Customize the look people see across Ralph Meet.
              </p>
            </div>
            {onClose ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-10 w-10 rounded-full border border-white/8 bg-white/[0.03] text-rm-text-muted hover:bg-white/[0.07] hover:text-rm-text"
                aria-label="Close profile editor"
              >
                <X size={18} />
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-rm-text">Edit Profile</h1>
          <p className="mt-2 text-sm text-rm-text-muted">
            Update your identity, collectibles, and profile surfaces in one place.
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarSelect}
        className="hidden"
        aria-label="Upload profile picture"
      />
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/*"
        onChange={handleBannerSelect}
        className="hidden"
        aria-label="Upload profile banner"
      />
      <input
        ref={nameplateInputRef}
        type="file"
        accept="image/*,video/mp4,video/webm,video/ogg"
        onChange={handleNameplateSelect}
        className="hidden"
        aria-label="Upload member nameplate"
      />

      <div className={cn("px-4 pb-6 md:px-6 md:pb-8", asModal ? "pt-4 md:pt-6" : "")}>
        <div className="grid gap-6 xl:grid-cols-[320px,minmax(0,1fr),320px]">
          <aside className="space-y-5 xl:sticky xl:top-6 self-start">
            <ProfileEditorTile
              title="Nameplate"
              status={nameplateStatus}
              helper="Hover to see the full rendered version on your profile."
              actions={(
                <>
                  <AccountActionIconButton label="Browse nameplates" onClick={() => handleOpenCollectibles("nameplate")}>
                    <Sparkles size={14} />
                  </AccountActionIconButton>
                  <AccountActionIconButton label="Upload nameplate" onClick={() => nameplateInputRef.current?.click()}>
                    <Upload size={14} />
                  </AccountActionIconButton>
                  <AccountActionIconButton
                    label="Remove nameplate"
                    onClick={handleRemoveNameplate}
                    disabled={!currentNameplateUrl && !currentNameplateSelection && !nameplateFile}
                    className="text-rose-200 hover:text-rose-100"
                  >
                    {collectibleActionKind === "nameplate" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </AccountActionIconButton>
                </>
              )}
              preview={(
                <>
                  <div className="relative h-28 overflow-hidden rounded-[22px] border border-white/8 bg-[#0b0e14]">
                    {nameplateAssetUrl ? (
                      <>
                        {currentNameplateUrl ? (
                          <ProfileAssetLayer
                            url={currentNameplateUrl}
                            contentType={currentNameplateContentType}
                            alt="Nameplate asset"
                            className="object-contain p-3 opacity-95 transition duration-300 group-hover/tile:opacity-0"
                          />
                        ) : (
                          <img
                            src={getAuthAssetUrl(nameplateAssetUrl)}
                            alt=""
                            className="absolute inset-0 h-full w-full object-contain p-3 opacity-95 transition duration-300 group-hover/tile:opacity-0"
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                        <div className="absolute inset-0 opacity-0 transition duration-300 group-hover/tile:opacity-100">
                          {currentNameplateUrl ? (
                            <ProfileAssetLayer
                              url={currentNameplateUrl}
                              contentType={currentNameplateContentType}
                              alt="Rendered nameplate preview"
                              className="opacity-85"
                            />
                          ) : (
                            <img
                              src={getAuthAssetUrl(nameplateAssetUrl)}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover opacity-85"
                              loading="lazy"
                              decoding="async"
                            />
                          )}
                          <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(6,7,10,0.68)_0%,_rgba(6,7,10,0.20)_48%,_rgba(6,7,10,0.72)_100%)]" />
                          <div className="relative z-10 flex h-full items-end p-3">
                            <div className="w-full rounded-2xl border border-white/10 bg-black/35 p-2.5 backdrop-blur-md">
                              <div className="flex items-center gap-2.5">
                                <div className="relative h-10 w-10 shrink-0 rounded-full bg-white/10">
                                  {currentAvatarSrc ? (
                                    <AvatarImage src={currentAvatarSrc} alt="" display={currentAvatarDisplay} />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center rounded-full text-sm font-bold text-white/70">
                                      {getDisplayInitial({ name: currentDisplayName })}
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-white">{currentDisplayName}</div>
                                  <div className="truncate text-xs text-white/70">@{currentUsername}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-rm-text-muted">
                        Pick a collectible or upload a custom asset to preview your nameplate here.
                      </div>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-rm-text-muted">Raw asset at rest, full profile render on hover.</p>
                </>
              )}
            />

            <div className="grid grid-cols-2 gap-5">
              <ProfileEditorTile
                title="Avatar"
                status={avatarFile ? `Pending upload: ${avatarFile.name}` : currentAvatarSrc ? "Profile picture active" : "Using your auth avatar"}
                helper="Hover the photo to swap it out."
                actions={(
                  <>
                    <AccountActionIconButton label="Change avatar" onClick={() => fileInputRef.current?.click()}>
                      <Pencil size={14} />
                    </AccountActionIconButton>
                    <AccountActionIconButton label="Crop avatar" onClick={handleEditAvatarFrame} disabled={!currentAvatarSrc}>
                      <Crop size={14} />
                    </AccountActionIconButton>
                  </>
                )}
                preview={(
                  <div className="flex h-[150px] items-center justify-center rounded-[22px] border border-white/8 bg-[radial-gradient(circle_at_top,_rgba(126,146,255,0.24),_transparent_48%),linear-gradient(180deg,_rgba(13,15,21,1),_rgba(9,11,15,1))]">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="group/avatar relative h-24 w-24 overflow-hidden rounded-full border border-white/12 shadow-[0_18px_40px_rgba(0,0,0,0.35)] outline-none transition-transform hover:scale-[1.04] focus-visible:scale-[1.04]"
                      aria-label="Change profile picture"
                    >
                      {currentAvatarSrc ? (
                        <AvatarImage src={currentAvatarSrc} alt={currentDisplayName} display={currentAvatarDisplay} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                          {getDisplayInitial({ name: currentDisplayName })}
                        </div>
                      )}
                      <span className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover/avatar:bg-black/48 group-focus-visible/avatar:bg-black/48" />
                      <span className="absolute inset-0 z-10 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-lg backdrop-blur-sm">
                          <Pencil size={16} />
                        </span>
                      </span>
                    </button>
                  </div>
                )}
              />

              <ProfileEditorTile
                title="Decoration"
                status={currentAvatarDecoration?.name ?? "No decoration selected"}
                helper="Animated decorations sit on top of your avatar."
                actions={(
                  <>
                    <AccountActionIconButton label="Change decoration" onClick={() => handleOpenCollectibles("avatar_decoration")}>
                      <Sparkles size={14} />
                    </AccountActionIconButton>
                    <AccountActionIconButton
                      label="Remove decoration"
                      onClick={() => handleRemoveCollectible("avatar_decoration")}
                      disabled={!currentAvatarDecoration}
                      className="text-rose-200 hover:text-rose-100"
                    >
                      {collectibleActionKind === "avatar_decoration" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </AccountActionIconButton>
                  </>
                )}
                preview={(
                  <div className="flex h-[150px] items-center justify-center rounded-[22px] border border-white/8 bg-[radial-gradient(circle_at_top,_rgba(255,124,174,0.18),_transparent_44%),linear-gradient(180deg,_rgba(13,15,21,1),_rgba(9,11,15,1))]">
                    <div className="relative h-24 w-24 rounded-full bg-white/6 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
                      {currentAvatarSrc ? (
                        <AvatarImage src={currentAvatarSrc} alt="" display={currentAvatarDisplay} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center rounded-full text-2xl font-bold text-white/80">
                          {getDisplayInitial({ name: currentDisplayName })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              />
            </div>

            <ProfileEditorTile
              title="Banner"
              status={bannerStatus}
              helper="Your banner anchors the whole profile card."
              actions={(
                <>
                  <AccountActionIconButton label="Upload banner" onClick={() => bannerInputRef.current?.click()}>
                    <Upload size={14} />
                  </AccountActionIconButton>
                  <AccountActionIconButton
                    label="Remove banner"
                    onClick={() => {
                      setRemoveBanner(true);
                      setBannerFile(null);
                      setBannerPreview(null);
                    }}
                    disabled={!currentBannerUrl && !bannerFile}
                    className="text-rose-200 hover:text-rose-100"
                  >
                    <Trash2 size={14} />
                  </AccountActionIconButton>
                </>
              )}
              preview={(
                <div className="relative h-28 overflow-hidden rounded-[22px] border border-white/8 bg-[linear-gradient(135deg,_#18243a,_#103b32_48%,_#1f1928)]">
                  <ProfileAssetLayer
                    url={currentBannerUrl}
                    contentType={currentBannerContentType}
                    alt="Banner preview"
                    className="opacity-90"
                  />
                  <ProfileCollectiblesLayer display={currentAvatarDisplay} className="opacity-22" />
                  <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(6,7,10,0.46),_rgba(6,7,10,0.12),_rgba(6,7,10,0.54))]" />
                  <div className="absolute bottom-3 left-3 rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75 backdrop-blur-sm">
                    Banner preview
                  </div>
                </div>
              )}
            />

            <ProfileEditorTile
              title="Profile Effect"
              status={currentProfileEffect?.name ?? "No profile effect selected"}
              helper="Hover to swap the static card for the animated effect."
              actions={(
                <>
                  <AccountActionIconButton label="Change profile effect" onClick={() => handleOpenCollectibles("profile_effect")}>
                    <Sparkles size={14} />
                  </AccountActionIconButton>
                  <AccountActionIconButton
                    label="Remove profile effect"
                    onClick={() => handleRemoveCollectible("profile_effect")}
                    disabled={!currentProfileEffect}
                    className="text-rose-200 hover:text-rose-100"
                  >
                    {collectibleActionKind === "profile_effect" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </AccountActionIconButton>
                </>
              )}
              preview={(
                <>
                  <div className="relative h-36 overflow-hidden rounded-[22px] border border-white/8 bg-[#0b0e14]">
                    {profileEffectPosterUrl ? (
                      <img
                        src={getAuthAssetUrl(profileEffectPosterUrl)}
                        alt=""
                        className="absolute inset-0 h-full w-full object-contain p-3 opacity-92 transition duration-300 group-hover/tile:opacity-0"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(101,163,255,0.22),_transparent_48%),linear-gradient(180deg,_#0b0e14,_#11131a)] transition duration-300 group-hover/tile:opacity-0" />
                    )}
                    <div className="absolute inset-0 opacity-0 transition duration-300 group-hover/tile:opacity-100">
                      <ProfileCollectiblesLayer display={currentAvatarDisplay} className="opacity-95" />
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.14),_transparent_42%),linear-gradient(180deg,_rgba(6,7,10,0.20),_rgba(6,7,10,0.60))]" />
                      <div className="absolute bottom-4 left-4 z-10 h-16 w-16 rounded-full bg-white/6 shadow-[0_0_0_1px_rgba(255,255,255,0.10)]">
                        {currentAvatarSrc ? (
                          <AvatarImage src={currentAvatarSrc} alt="" display={currentAvatarDisplay} />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center rounded-full text-lg font-bold text-white/80">
                            {getDisplayInitial({ name: currentDisplayName })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-rm-text-muted">Static art at rest, animated profile card on hover.</p>
                </>
              )}
            />
          </aside>

          <section className="overflow-hidden rounded-[32px] border border-white/8 bg-[#101216] shadow-[0_28px_90px_rgba(0,0,0,0.34)]">
            <div className="border-b border-white/8 px-5 py-4 md:px-6">
              <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-rm-text-muted">Live Preview</div>
              <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-rm-text">Main Profile</h2>
              <p className="mt-1 text-sm text-rm-text-secondary">
                This card updates as you edit your avatar, banner, and collectibles.
              </p>
            </div>

            <div className="p-4 md:p-6">
              <div className="relative overflow-hidden rounded-[30px] border border-white/8 bg-[#0f1117] shadow-[0_24px_80px_rgba(0,0,0,0.40)]">
                <div className="relative h-[210px] overflow-hidden bg-[linear-gradient(135deg,_#1a2436,_#0d573f_52%,_#1a2133)]">
                  <ProfileAssetLayer
                    url={currentBannerUrl}
                    contentType={currentBannerContentType}
                    alt="Profile banner"
                    className="opacity-95"
                  />
                  <ProfileCollectiblesLayer display={currentAvatarDisplay} className="opacity-80" />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(0,0,0,0.04),_rgba(0,0,0,0.44))]" />
                </div>

                <div className="relative px-5 pb-6 pt-0 md:px-6">
                  <div className="-mt-14 space-y-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                      <div className="flex min-w-0 items-end gap-4">
                        <div className="relative h-28 w-28 shrink-0 rounded-full border-[6px] border-[#0f1117] bg-white/6 shadow-[0_22px_48px_rgba(0,0,0,0.38)]">
                          {currentAvatarSrc ? (
                            <AvatarImage src={currentAvatarSrc} alt={currentDisplayName} display={currentAvatarDisplay} />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center rounded-full text-3xl font-bold text-white">
                              {getDisplayInitial({ name: currentDisplayName })}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 pb-1">
                          <h3 className="truncate text-[28px] font-semibold tracking-[-0.04em] text-rm-text">{currentDisplayName}</h3>
                          <p className="truncate text-sm text-rm-text-muted">@{currentUsername}</p>
                          {nameplateAssetUrl ? (
                            <div className="mt-3 inline-flex max-w-full overflow-hidden rounded-full border border-white/10 bg-black/26">
                              <div className="relative flex min-h-10 min-w-0 items-center gap-2 overflow-hidden px-3 py-2">
                                {currentNameplateUrl ? (
                                  <ProfileAssetLayer
                                    url={currentNameplateUrl}
                                    contentType={currentNameplateContentType}
                                    alt="Active nameplate"
                                    className="opacity-80"
                                  />
                                ) : (
                                  <img
                                    src={getAuthAssetUrl(nameplateAssetUrl)}
                                    alt=""
                                    className="absolute inset-0 h-full w-full object-cover opacity-80"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                )}
                                <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(6,7,10,0.56),_rgba(6,7,10,0.12),_rgba(6,7,10,0.62))]" />
                                <div className="relative z-10 flex min-w-0 items-center gap-2">
                                  <div className="h-6 w-6 shrink-0 rounded-full bg-white/12">
                                    {currentAvatarSrc ? (
                                      <AvatarImage src={currentAvatarSrc} alt="" display={currentAvatarDisplay} />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center rounded-full text-[10px] font-bold text-white/80">
                                        {getDisplayInitial({ name: currentDisplayName })}
                                      </div>
                                    )}
                                  </div>
                                  <span className="truncate text-xs font-semibold text-white">{currentDisplayName}</span>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pb-1">
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl border-white/10 bg-white/[0.04] text-rm-text hover:bg-white/[0.08]"
                        >
                          Message
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl border-white/10 bg-white/[0.04] text-rm-text hover:bg-white/[0.08]"
                        >
                          View Profile
                        </Button>
                      </div>
                    </div>

                    {(nameplateAssetUrl || currentAvatarDecoration || currentProfileEffect) && (
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-rm-text-muted">Decoration</div>
                          <div className="mt-2 text-sm font-semibold text-rm-text">
                            {currentAvatarDecoration?.name ?? "None"}
                          </div>
                        </div>
                        <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-rm-text-muted">Nameplate</div>
                          <div className="mt-2 text-sm font-semibold text-rm-text">
                            {currentNameplateSelection?.name ?? (currentNameplateUrl ? "Custom upload" : "None")}
                          </div>
                        </div>
                        <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-rm-text-muted">Effect</div>
                          <div className="mt-2 text-sm font-semibold text-rm-text">
                            {currentProfileEffect?.name ?? "None"}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="rounded-[24px] border border-white/8 bg-black/22 p-4 text-sm leading-6 text-rm-text-secondary">
                      {chatUser?.custom_status || "Use the tiles on the left to preview exactly how your profile surfaces will look before saving."}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="space-y-6 xl:sticky xl:top-6 self-start">
            <section className="rounded-[32px] border border-white/8 bg-[#101216] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)] md:p-6">
              <div className="border-b border-white/8 pb-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-rm-text-muted">Identity</div>
                <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-rm-text">Profile Details</h2>
                <p className="mt-1 text-sm text-rm-text-secondary">
                  Display names and usernames update everywhere this account appears.
                </p>
              </div>

              <div className="mt-5 space-y-5">
                <div className="space-y-2">
                  <Label className="text-[11px] font-bold uppercase tracking-[0.18em] text-rm-text-muted">Display Name</Label>
                  <Input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className="h-11 rounded-xl border-white/10 bg-white/[0.03] text-rm-text shadow-none placeholder:text-rm-text-muted focus-visible:ring-primary/40"
                    placeholder="Add a display name"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-[11px] font-bold uppercase tracking-[0.18em] text-rm-text-muted">Username</Label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-rm-text-muted/50">@</span>
                    <Input
                      value={username}
                      onChange={handleUsernameChange}
                      className="h-11 rounded-xl border-white/10 bg-white/[0.03] pl-8 text-rm-text shadow-none placeholder:text-rm-text-muted focus-visible:ring-primary/40"
                    />
                  </div>
                  {usernameStatus !== "idle" && usernameStatus !== "own" && (
                    <p
                      className={cn(
                        "text-[12px] flex items-center gap-1.5",
                        usernameStatus === "available" ? "text-primary" : "text-destructive",
                      )}
                    >
                      {usernameStatus === "checking" ? <Loader2 size={12} className="animate-spin" /> : null}
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

                <div className="space-y-2">
                  <Label className="text-[11px] font-bold uppercase tracking-[0.18em] text-rm-text-muted">Email</Label>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-rm-text-secondary">
                    {user.primaryEmailAddress?.emailAddress || "No email on file"}
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-rm-text-muted">Current Setup</div>
                  <div className="mt-3 space-y-2 text-sm text-rm-text-secondary">
                    <div className="flex items-center justify-between gap-3">
                      <span>Avatar decoration</span>
                      <span className="truncate text-rm-text">{currentAvatarDecoration?.name ?? "None"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Nameplate</span>
                      <span className="truncate text-rm-text">
                        {currentNameplateSelection?.name ?? (currentNameplateUrl ? "Custom upload" : "None")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Profile effect</span>
                      <span className="truncate text-rm-text">{currentProfileEffect?.name ?? "None"}</span>
                    </div>
                  </div>
                </div>

                {error ? (
                  <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <AlertTriangle size={14} />
                    <span>{error}</span>
                  </div>
                ) : null}

                <div className="flex flex-col gap-3 pt-2">
                  <Button
                    onClick={handleSaveProfile}
                    disabled={saving || !hasChanges}
                    className="h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {saving ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : saved ? (
                      <Check size={18} />
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDisplayName(chatUser?.display_name || (user?.unsafeMetadata?.displayName as string) || user?.username || "");
                      setUsername(chatUser?.username || user?.username || "");
                      setAvatarFile(null);
                      setAvatarPreview(null);
                      setAvatarDisplay(chatUser?.avatar_display ?? null);
                      setAvatarDisplayChanged(false);
                      setBannerFile(null);
                      setBannerPreview(null);
                      setNameplateFile(null);
                      setNameplatePreview(null);
                      setRemoveBanner(false);
                      setRemoveNameplate(false);
                      setError(null);
                    }}
                    disabled={!hasChanges}
                    className="h-11 rounded-xl border border-white/8 bg-white/[0.03] text-rm-text-muted hover:bg-white/[0.05] hover:text-rm-text"
                  >
                    Revert Draft
                  </Button>
                  <p className="text-xs leading-5 text-rm-text-muted">
                    {hasChanges ? "You have unsaved profile changes." : "Everything here is synced to your account."}
                  </p>
                </div>
              </div>
            </section>

            {(claimLoading || claimCandidates.length > 0 || claimError) && (
              <section className="rounded-[32px] border border-amber-500/25 bg-amber-500/10 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.20)]">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
                    {claimLoading ? <Loader2 size={18} className="animate-spin" /> : <UserRoundCheck size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-rm-text">Claim Existing Ralph Meet Account</h3>
                    <p className="mt-1 text-sm leading-6 text-rm-text-secondary">
                      Pull your servers, messages, DMs, and profile history into this Ralph Auth login.
                    </p>
                    {claimError ? (
                      <div className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        <AlertTriangle size={14} />
                        {claimError}
                      </div>
                    ) : null}
                    {claimCandidates.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        {claimCandidates.map((candidate) => (
                          <div
                            key={candidate.id}
                            className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-black/18 p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="relative h-10 w-10 shrink-0 rounded-full bg-white/6">
                                {candidate.avatar_url ? (
                                  <AvatarImage src={candidate.avatar_url} alt="" display={candidate.avatar_display} />
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
                    ) : null}
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      {avatarEditor && (
        <AvatarFrameEditor
          image={avatarEditor}
          initialDisplay={currentAvatarDisplay}
          displayName={chatUser?.display_name || chatUser?.username || user.username || "Profile"}
          onCancel={handleAvatarFrameCancel}
          onConfirm={handleAvatarFrameConfirm}
        />
      )}
      {collectiblesKind && (
        <CollectiblesCatalogModal
          initialKind={collectiblesKind}
          currentDisplay={currentAvatarDisplay}
          avatarSrc={currentAvatarSrc}
          displayName={currentDisplayName}
          onClose={() => setCollectiblesKind(null)}
          onApplied={async (updatedUser) => {
            await syncCollectibleState(updatedUser);
          }}
        />
      )}
    </div>
  );
}
