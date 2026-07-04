import { AvatarFrameEditor } from "@/components/chat/AvatarFrameEditor";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { CollectiblesCatalogModal } from "@/components/chat/CollectiblesCatalogModal";
import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import splashLogo from "@/assets/splash-logo.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api-client";
import {
  getAvatarCollectibles,
  normalizeAvatarDisplay,
  serializeAvatarDisplay,
  type AvatarDisplay,
} from "@/lib/avatar-display";
import type { CollectibleKind } from "@/lib/collectibles-catalog";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useUser } from "@kova/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronsRight,
  Crop,
  Loader2,
  Pencil,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
  Upload,
  UserRoundCheck,
  X,
} from "lucide-react";
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
const PROFILE_SURFACE_ASPECT_RATIO = "450 / 880";

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
            "h-7 w-7 rounded-lg border-rm-border bg-rm-bg-floating/92 text-rm-text-muted shadow-[0_10px_22px_rgba(0,0,0,0.32)] backdrop-blur-sm hover:bg-rm-bg-hover hover:text-rm-text",
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

function ProfileRailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-rm-border/80 pt-5 first:border-t-0 first:pt-0">
      <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-rm-text-secondary">{title}</div>
      {children}
    </section>
  );
}

function ProfileRailCard({
  children,
  actions,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group/rail relative overflow-hidden rounded-[16px] border border-rm-border bg-rm-bg-surface/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_40px_rgba(0,0,0,0.24)] transition duration-200 hover:scale-[1.015] hover:border-rm-border hover:bg-rm-bg-elevated/80",
        className,
      )}
    >
      {actions ? (
        <div className="absolute right-2 top-2 z-20 flex items-center gap-1 opacity-100 transition duration-200 md:opacity-0 md:group-hover/rail:opacity-100 md:group-focus-within/rail:opacity-100">
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function ProfilePreviewWidgetCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[24px] border border-rm-border bg-rm-bg-elevated/80 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.22)]",
        className,
      )}
    >
      <div className="mb-4">
        <div className="text-[13px] font-semibold text-rm-text">{title}</div>
        {subtitle ? <div className="mt-1 text-[12px] text-rm-text-muted">{subtitle}</div> : null}
      </div>
      {children}
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
  const [removeAvatar, setRemoveAvatar] = useState(false);
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
    setRemoveAvatar(false);
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
    removeAvatar, setRemoveAvatar,
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
    setSaved,
    error, setError,
    usernameStatus, setUsernameStatus,
    avatarPreview, setAvatarPreview,
    avatarFile, setAvatarFile,
    bannerPreview, setBannerPreview,
    bannerFile, setBannerFile,
    nameplatePreview, setNameplatePreview,
    nameplateFile, setNameplateFile,
    removeAvatar, setRemoveAvatar,
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
    removeAvatar ||
    avatarDisplayChanged ||
    bannerFile !== null ||
    nameplateFile !== null ||
    removeBanner ||
    removeNameplate;

  const persistedAvatarSrc = chatUser?.avatar_url ? getAuthAssetUrl(chatUser.avatar_url) : null;
  const fallbackAvatarSrc = user?.imageUrl || undefined;
  const draftAvatarDisplay = avatarDisplayChanged || avatarFile
    ? avatarDisplay
    : chatUser?.avatar_display ?? null;
  const avatarDisplayWithoutCrop = (() => {
    const normalizedDisplay = normalizeAvatarDisplay(draftAvatarDisplay);
    if (!normalizedDisplay?.crop) {
      return normalizedDisplay ?? draftAvatarDisplay;
    }

    return normalizedDisplay.collectibles
      ? ({
        version: 1,
        collectibles: normalizedDisplay.collectibles,
      } satisfies AvatarDisplay)
      : null;
  })();
  const currentAvatarSrc = removeAvatar
    ? fallbackAvatarSrc
    : avatarPreview || persistedAvatarSrc || fallbackAvatarSrc;
  const currentAvatarDisplay = removeAvatar
    ? avatarDisplayWithoutCrop
    : draftAvatarDisplay;
  const currentDisplayName = displayName.trim() || chatUser?.display_name || chatUser?.username || user?.username || "Profile";
  const currentUsername = username.trim() || chatUser?.username || user?.username || "profile";
  const currentCollectibles = getAvatarCollectibles(currentAvatarDisplay);
  const currentAvatarDecoration = currentCollectibles?.avatarDecoration;
  const currentProfileEffect = currentCollectibles?.profileEffect;
  const currentNameplateSelection = currentCollectibles?.nameplate;
  const hasPersistedUploadedAvatar = Boolean(chatUser?.avatar_url?.startsWith("/api/avatars/"));
  const hasAvatarCrop = Boolean(normalizeAvatarDisplay(draftAvatarDisplay)?.crop);
  const hasRemovableAvatar = Boolean(avatarFile || avatarPreview || hasPersistedUploadedAvatar || hasAvatarCrop);
  const currentAvatarDisplayWithoutDecoration = (() => {
    const normalizedDisplay = normalizeAvatarDisplay(currentAvatarDisplay);
    if (!normalizedDisplay?.collectibles?.avatarDecoration) {
      return normalizedDisplay ?? currentAvatarDisplay;
    }

    const { avatarDecoration: _avatarDecoration, ...remainingCollectibles } = normalizedDisplay.collectibles;
    return {
      ...normalizedDisplay,
      collectibles: Object.keys(remainingCollectibles).length > 0 ? remainingCollectibles : undefined,
    } satisfies AvatarDisplay;
  })();

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

  const resetDraftState = useCallback(() => {
    setDisplayName(chatUser?.display_name || (user?.unsafeMetadata?.displayName as string) || user?.username || "");
    setUsername(chatUser?.username || user?.username || "");
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarDisplay(chatUser?.avatar_display ?? null);
    setAvatarDisplayChanged(false);
    setRemoveAvatar(false);
    setBannerFile(null);
    setBannerPreview(null);
    setNameplateFile(null);
    setNameplatePreview(null);
    setRemoveBanner(false);
    setRemoveNameplate(false);
    setError(null);
    setSaved(false);
    setUsernameStatus("idle");
  }, [
    chatUser?.avatar_display,
    chatUser?.display_name,
    chatUser?.username,
    setAvatarDisplay,
    setAvatarDisplayChanged,
    setAvatarFile,
    setAvatarPreview,
    setBannerFile,
    setBannerPreview,
    setDisplayName,
    setError,
    setNameplateFile,
    setNameplatePreview,
    setRemoveAvatar,
    setRemoveBanner,
    setRemoveNameplate,
    setSaved,
    setUsername,
    setUsernameStatus,
    user?.unsafeMetadata?.displayName,
    user?.username,
  ]);

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
    setRemoveAvatar(false);
    setAvatarDisplay(display);
    setAvatarDisplayChanged(true);
    setAvatarEditor(null);
  };

  const handleRemoveAvatar = useCallback(() => {
    if (!hasRemovableAvatar) return;
    setError(null);
    setAvatarFile(null);
    setAvatarPreview(null);
    setRemoveAvatar(true);
    setAvatarDisplayChanged(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [
    fileInputRef,
    hasRemovableAvatar,
    setAvatarDisplayChanged,
    setAvatarFile,
    setAvatarPreview,
    setError,
    setRemoveAvatar,
  ]);

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
        ...(removeAvatar ? { removeAvatar: true } : {}),
        ...((removeAvatar && currentAvatarDisplay)
          ? { avatarDisplay: currentAvatarDisplay }
          : (avatarDisplayChanged && !avatarFile ? { avatarDisplay } : {})),
      });

      if (removeAvatar) {
        setAvatarFile(null);
        setAvatarPreview(null);
        setRemoveAvatar(false);
        setAvatarDisplay(currentAvatarDisplay);
        setAvatarDisplayChanged(false);
      } else if (avatarFile) {
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
    currentAvatarDisplay,
    nameplateFile,
    removeAvatar,
    removeBanner,
    removeNameplate,
    chatUser?.banner_url,
    chatUser?.nameplate_url,
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
    setRemoveAvatar,
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
    <div className={cn("animate-in fade-in slide-in-from-right-4 duration-300", asModal && "relative flex h-full min-h-0 flex-col overflow-hidden bg-rm-bg-primary")}>
      {asModal ? (
        onClose ? (
          <div className="pointer-events-none absolute right-5 top-5 z-30">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="pointer-events-auto h-10 w-10 rounded-full border border-rm-border bg-rm-bg-floating/92 text-rm-text-muted shadow-[0_14px_34px_rgba(0,0,0,0.26)] backdrop-blur-md hover:bg-rm-bg-hover hover:text-rm-text"
              aria-label="Close profile editor"
            >
              <X size={18} />
            </Button>
          </div>
        ) : null
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

      <div className={cn(asModal ? "min-h-0 flex-1 overflow-y-auto bg-rm-bg-primary custom-scrollbar lg:overflow-hidden" : "bg-transparent")}>
        <div className={cn("px-4 pb-6 md:px-6 md:pb-8", asModal ? "h-full pt-6 pb-24 md:pt-7 md:pb-28 lg:pb-8" : "pt-2 md:pt-4")}>
          {asModal && error ? (
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          ) : null}

          <div className={cn("grid gap-6 lg:grid-cols-[228px_minmax(0,390px)_minmax(0,1fr)]", asModal && "lg:h-full lg:min-h-0 lg:items-start")}>
            <aside className="self-start">
              <div className="overflow-hidden rounded-[22px] border border-rm-border bg-rm-bg-primary">
                <div className="flex items-center justify-between border-b border-rm-border px-4 py-3.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg border border-rm-border bg-rm-bg-surface px-2.5 py-1 text-[15px] font-semibold text-rm-text transition hover:bg-rm-bg-hover"
                  >
                    <span>Main Profile</span>
                    <ChevronDown size={14} className="text-rm-text-muted" />
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-transparent bg-transparent p-1.5 text-rm-text-muted transition hover:border-rm-border hover:bg-rm-bg-hover hover:text-rm-text"
                    aria-label="View profile variants"
                  >
                    <ChevronsRight size={16} />
                  </button>
                </div>

                <div className="space-y-5 p-4">
                  <ProfileRailSection title="Nameplate">
                    <ProfileRailCard
                      className="p-3"
                      actions={(
                        <>
                          <AccountActionIconButton label="Browse nameplates" onClick={() => handleOpenCollectibles("nameplate")}>
                            <Sparkles size={12} />
                          </AccountActionIconButton>
                          <AccountActionIconButton label="Upload nameplate" onClick={() => nameplateInputRef.current?.click()}>
                            <Upload size={12} />
                          </AccountActionIconButton>
                          <AccountActionIconButton
                            label="Remove nameplate"
                            onClick={handleRemoveNameplate}
                            disabled={!currentNameplateUrl && !currentNameplateSelection && !nameplateFile}
                            className="text-rose-300 hover:bg-rose-500/12 hover:text-rose-100"
                          >
                            {collectibleActionKind === "nameplate" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </AccountActionIconButton>
                        </>
                      )}
                    >
                        <div
                          className="relative h-10 overflow-hidden rounded-[10px] border border-rm-border/70 bg-rm-bg-surface"
                          title={nameplateStatus}
                        >
                        {nameplateAssetUrl ? (
                          <>
                            <div className="absolute inset-0 transition duration-300 group-hover/rail:opacity-0">
                              {currentNameplateUrl ? (
                                <ProfileAssetLayer
                                  url={currentNameplateUrl}
                                  contentType={currentNameplateContentType}
                                  alt="Nameplate preview"
                                  className="opacity-95"
                                />
                              ) : (
                                <img
                                  src={getAuthAssetUrl(nameplateAssetUrl)}
                                  alt=""
                                  className="absolute inset-0 h-full w-full object-cover opacity-92"
                                  loading="lazy"
                                  decoding="async"
                                />
                              )}
                            </div>
                            <div className="absolute inset-0 opacity-0 transition duration-300 group-hover/rail:opacity-100">
                              {currentNameplateUrl ? (
                                <ProfileAssetLayer
                                  url={currentNameplateUrl}
                                  contentType={currentNameplateContentType}
                                  alt="Nameplate preview"
                                  className="opacity-95"
                                />
                              ) : (
                                <img
                                  src={getAuthAssetUrl(nameplateAssetUrl)}
                                  alt=""
                                  className="absolute inset-0 h-full w-full object-cover opacity-92"
                                  loading="lazy"
                                  decoding="async"
                                />
                              )}
                              <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(10,12,16,0.82)_0%,_rgba(10,12,16,0.28)_38%,_rgba(10,12,16,0.18)_68%,_rgba(10,12,16,0.82)_100%)]" />
                              <div className="absolute inset-y-0 left-2 flex items-center gap-2">
                                <div className="h-6 w-6 overflow-hidden rounded-full border border-rm-border bg-rm-bg-surface/80">
                                  {currentAvatarSrc ? (
                                    <AvatarImage src={currentAvatarSrc} alt="" display={currentAvatarDisplayWithoutDecoration} />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-white/80">
                                      {getDisplayInitial({ name: currentDisplayName })}
                                    </div>
                                  )}
                                </div>
                                <span className="max-w-[90px] truncate text-[11px] font-semibold text-white/88">{currentDisplayName}</span>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="flex h-full items-center justify-center text-[11px] text-rm-text-muted">No nameplate selected</div>
                        )}
                      </div>
                    </ProfileRailCard>
                  </ProfileRailSection>

                  <ProfileRailSection title="Avatar & Decoration">
                    <div className="grid grid-cols-2 gap-3">
                      <ProfileRailCard
                        className="flex h-[98px] items-center justify-center p-3"
                        actions={(
                          <>
                            <AccountActionIconButton label="Crop avatar" onClick={handleEditAvatarFrame} disabled={!currentAvatarSrc}>
                              <Crop size={12} />
                            </AccountActionIconButton>
                            <AccountActionIconButton
                              label="Remove avatar"
                              onClick={handleRemoveAvatar}
                              disabled={!hasRemovableAvatar}
                              className="text-rose-300 hover:bg-rose-500/12 hover:text-rose-100"
                            >
                              <Trash2 size={12} />
                            </AccountActionIconButton>
                          </>
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="group/avatar relative flex h-[72px] w-[72px] items-center justify-center rounded-[18px] border border-rm-border bg-rm-bg-surface/70 outline-none transition-transform hover:scale-[1.03]"
                          aria-label="Change profile picture"
                        >
                          <div className="relative h-[56px] w-[56px] overflow-hidden rounded-full border border-rm-border/80 bg-rm-bg-elevated shadow-[0_14px_28px_rgba(0,0,0,0.24)]">
                            {currentAvatarSrc ? (
                              <AvatarImage src={currentAvatarSrc} alt={currentDisplayName} display={currentAvatarDisplayWithoutDecoration} />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-rm-bg-elevated text-xl font-bold text-rm-text">
                                {getDisplayInitial({ name: currentDisplayName })}
                              </div>
                            )}
                          </div>
                        </button>
                      </ProfileRailCard>

                      <ProfileRailCard
                        className="flex h-[98px] items-center justify-center p-3"
                        actions={(
                          <>
                            <AccountActionIconButton label="Change decoration" onClick={() => handleOpenCollectibles("avatar_decoration")}>
                              <Sparkles size={12} />
                            </AccountActionIconButton>
                            <AccountActionIconButton
                              label="Remove decoration"
                              onClick={() => handleRemoveCollectible("avatar_decoration")}
                              disabled={!currentAvatarDecoration}
                              className="text-rose-300 hover:bg-rose-500/12 hover:text-rose-100"
                            >
                              {collectibleActionKind === "avatar_decoration" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </AccountActionIconButton>
                          </>
                        )}
                      >
                        <div className="relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-[18px] border border-rm-border bg-rm-bg-surface/70">
                          {currentAvatarDecoration ? (
                            <>
                              <div className="absolute inset-0 transition duration-300 group-hover/rail:opacity-0">
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(109,124,255,0.22),_transparent_56%),linear-gradient(180deg,_rgba(9,11,17,0.98),_rgba(10,12,18,0.95))]" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="relative h-[56px] w-[56px] overflow-visible rounded-full border border-rm-border bg-rm-bg-elevated/90 p-2 shadow-[0_14px_30px_rgba(0,0,0,0.32)]">
                                    <img src={splashLogo} alt="" className="h-full w-full object-contain opacity-80" />
                                    <img
                                      src={currentAvatarDecoration.imageUrl}
                                      alt=""
                                      className="pointer-events-none absolute left-1/2 top-1/2 h-[124%] w-[124%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="absolute inset-0 opacity-0 transition duration-300 group-hover/rail:opacity-100">
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="relative h-[56px] w-[56px] overflow-visible rounded-full border border-rm-border bg-rm-bg-elevated/90 shadow-[0_14px_30px_rgba(0,0,0,0.32)]">
                                    {currentAvatarSrc ? (
                                      <AvatarImage src={currentAvatarSrc} alt="" display={currentAvatarDisplay} />
                                    ) : (
                                      <>
                                        <div className="flex h-full w-full items-center justify-center rounded-full bg-rm-bg-elevated text-xl font-bold text-white/80">
                                          {getDisplayInitial({ name: currentDisplayName })}
                                        </div>
                                        <img
                                          src={currentAvatarDecoration.imageUrl}
                                          alt=""
                                          className="pointer-events-none absolute left-1/2 top-1/2 h-[124%] w-[124%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-rm-text-muted">None</div>
                          )}
                        </div>
                      </ProfileRailCard>
                    </div>
                  </ProfileRailSection>

                  <ProfileRailSection title="Banner">
                    <ProfileRailCard
                      className="p-2.5"
                      actions={(
                        <>
                          <AccountActionIconButton label="Upload banner" onClick={() => bannerInputRef.current?.click()}>
                            <Upload size={12} />
                          </AccountActionIconButton>
                          <AccountActionIconButton
                            label="Remove banner"
                            onClick={() => {
                              setRemoveBanner(true);
                              setBannerFile(null);
                              setBannerPreview(null);
                            }}
                            disabled={!currentBannerUrl && !bannerFile}
                            className="text-rose-300 hover:bg-rose-500/12 hover:text-rose-100"
                          >
                            <Trash2 size={12} />
                          </AccountActionIconButton>
                        </>
                      )}
                    >
                      <div className="relative h-10 overflow-hidden rounded-[10px] bg-[linear-gradient(135deg,_#3d8b58,_#103b32_72%,_#172230)]" title={bannerStatus}>
                        <ProfileAssetLayer
                          url={currentBannerUrl}
                          contentType={currentBannerContentType}
                          alt="Banner preview"
                          className="opacity-92"
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(10,12,16,0.18),_rgba(10,12,16,0.02),_rgba(10,12,16,0.20))]" />
                      </div>
                    </ProfileRailCard>
                  </ProfileRailSection>

                  <ProfileRailSection title="Profile Effect">
                    <ProfileRailCard
                      className="p-2.5"
                      actions={(
                        <>
                          <AccountActionIconButton label="Change profile effect" onClick={() => handleOpenCollectibles("profile_effect")}>
                            <Sparkles size={12} />
                          </AccountActionIconButton>
                          <AccountActionIconButton
                            label="Remove profile effect"
                            onClick={() => handleRemoveCollectible("profile_effect")}
                            disabled={!currentProfileEffect}
                            className="text-rose-300 hover:bg-rose-500/12 hover:text-rose-100"
                          >
                            {collectibleActionKind === "profile_effect" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </AccountActionIconButton>
                        </>
                      )}
                    >
                        <div className="relative h-[96px] overflow-hidden rounded-[10px] border border-rm-border/70 bg-rm-bg-surface">
                          <div className="absolute inset-0 flex items-center justify-center transition duration-300 group-hover/rail:opacity-0">
                            <div className="relative h-[84px] overflow-hidden rounded-[10px] border border-rm-border/70 bg-rm-bg-elevated shadow-[0_18px_34px_rgba(0,0,0,0.3)]" style={{ aspectRatio: PROFILE_SURFACE_ASPECT_RATIO }}>
                            {profileEffectPosterUrl ? (
                              <img
                                src={getAuthAssetUrl(profileEffectPosterUrl)}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover opacity-94"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className="absolute inset-0" style={{ background: "var(--rm-profile-banner-fallback)" }} />
                            )}
                          </div>
                          </div>
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition duration-300 group-hover/rail:opacity-100">
                            <div className="relative h-[84px] overflow-hidden rounded-[10px] border border-rm-border/70 bg-rm-bg-elevated shadow-[0_18px_34px_rgba(0,0,0,0.32)]" style={{ aspectRatio: PROFILE_SURFACE_ASPECT_RATIO }}>
                              <div className="absolute inset-0" style={{ background: "var(--rm-profile-banner-fallback)" }} />
                              <div className="absolute left-3 top-[17px] h-7 w-7 overflow-hidden rounded-full border-2 border-rm-bg-elevated bg-rm-bg-surface shadow-[0_10px_20px_rgba(0,0,0,0.28)]">
                                {currentAvatarSrc ? (
                                  <AvatarImage src={currentAvatarSrc} alt="" display={currentAvatarDisplayWithoutDecoration} />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-white/80">
                                    {getDisplayInitial({ name: currentDisplayName })}
                                  </div>
                                )}
                              </div>
                              <div className="absolute inset-x-3 bottom-3 rounded-[10px] border border-white/8 bg-black/16 p-2">
                                <div className="h-1.5 w-10 rounded-full bg-white/18" />
                                <div className="mt-2 h-1.5 w-16 rounded-full bg-white/10" />
                              </div>
                              <ProfileCollectiblesLayer display={currentAvatarDisplay} effectOpacity={1} fit="contain" className="z-10 opacity-100" />
                              <div className="absolute inset-0 z-0" style={{ background: "var(--rm-profile-surface-overlay)" }} />
                            </div>
                          </div>
                        </div>
                    </ProfileRailCard>
                  </ProfileRailSection>
                </div>
              </div>
            </aside>

            <section
              className="relative self-start w-full overflow-hidden rounded-[30px] border border-rm-border bg-rm-bg-elevated shadow-[0_26px_80px_rgba(0,0,0,0.34)] lg:max-w-[390px]"
              style={{ aspectRatio: PROFILE_SURFACE_ASPECT_RATIO }}
            >
              <div className="pointer-events-none absolute inset-0 z-0" style={{ background: "var(--rm-profile-surface-overlay)" }} />
              <ProfileCollectiblesLayer display={currentAvatarDisplay} effectOpacity={1} fit="contain" className="z-40 opacity-100" />
              <button
                type="button"
                onClick={() => bannerInputRef.current?.click()}
                className="group/preview-banner relative block h-[18%] min-h-[128px] w-full overflow-hidden text-left"
                style={{ background: "var(--rm-profile-banner-fallback)" }}
                aria-label="Change profile banner"
              >
                <ProfileAssetLayer
                  url={currentBannerUrl}
                  contentType={currentBannerContentType}
                  alt="Profile banner"
                  className="opacity-94"
                />
                <div className="absolute inset-0" style={{ background: "var(--rm-profile-banner-overlay)" }} />
                <div className="absolute inset-0 bg-black/0 transition group-hover/preview-banner:bg-black/28" />
                <span className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-rm-border bg-rm-bg-floating/92 text-white opacity-0 shadow-[0_14px_28px_rgba(0,0,0,0.24)] backdrop-blur-sm transition group-hover/preview-banner:opacity-100">
                  <Pencil size={15} />
                </span>
              </button>

              <div className="relative z-10 px-6 pb-7">
                <div className="-mt-9 flex items-start gap-4">
                  <div className="flex min-w-0 gap-4">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="group/preview-avatar relative h-28 w-28 shrink-0 rounded-full border-[6px] border-rm-bg-elevated bg-white/10 shadow-[0_18px_46px_rgba(0,0,0,0.42)]"
                      aria-label="Change profile picture"
                    >
                      {currentAvatarSrc ? (
                        <AvatarImage src={currentAvatarSrc} alt={currentDisplayName} display={currentAvatarDisplayWithoutDecoration} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center rounded-full text-3xl font-bold text-white">
                          {getDisplayInitial({ name: currentDisplayName })}
                        </div>
                      )}
                      <span className="absolute inset-0 rounded-full bg-black/0 transition group-hover/preview-avatar:bg-black/36" />
                      <span className="absolute inset-0 z-10 flex items-center justify-center opacity-0 transition group-hover/preview-avatar:opacity-100">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-rm-border bg-rm-bg-floating/92 text-white shadow-[0_14px_28px_rgba(0,0,0,0.24)] backdrop-blur-sm">
                          <Pencil size={16} />
                        </span>
                      </span>
                    </button>

                    <div className="min-w-0 pt-11">
                      {chatUser?.custom_status ? (
                        <div className="mb-3 inline-flex max-w-[180px] items-center rounded-full border border-rm-border bg-rm-bg-floating/92 px-3.5 py-2 text-[12px] font-medium text-rm-text shadow-[0_14px_28px_rgba(0,0,0,0.22)] backdrop-blur-sm">
                          <span className="truncate">{chatUser.custom_status}</span>
                        </div>
                      ) : null}
                      <h2 className="truncate text-[20px] font-semibold tracking-[-0.03em] text-rm-text">{currentDisplayName}</h2>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-rm-text-muted">
                        <span>@{currentUsername}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center gap-2">
                  <Button
                    type="button"
                    className="h-10 rounded-xl bg-primary px-4 text-primary-foreground shadow-[0_14px_28px_rgba(0,0,0,0.24)] hover:bg-primary/90"
                  >
                    Message
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-9 w-9 rounded-xl border border-rm-border bg-rm-bg-floating/92 text-rm-text-muted shadow-[0_12px_24px_rgba(0,0,0,0.22)] hover:bg-rm-bg-hover hover:text-rm-text"
                    aria-label="Open profile shop"
                  >
                    <ShoppingBag size={16} />
                  </Button>
                </div>

                <div className="mt-5 space-y-5">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rm-text-muted">Member Since</div>
                    <div className="mt-2 text-[14px] text-rm-text">Mar 5, 2016</div>
                  </div>
                </div>
              </div>
            </section>

            <aside className={cn("self-start", asModal && "min-h-0 lg:flex lg:h-full lg:flex-col")}>
              <div className="flex items-center gap-6 border-b border-rm-border px-1 pb-4">
                {["Board", "Activity", "Wishlist"].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={cn(
                      "pb-2 text-[14px] font-semibold text-rm-text-muted transition",
                      tab === "Board" && "border-b-2 border-rm-text text-rm-text",
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between">
                <div className="text-[13px] font-medium text-rm-text-secondary">Your Widgets</div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-rm-border bg-rm-bg-floating/90 px-3 py-2 text-[14px] font-semibold text-rm-text transition hover:bg-rm-bg-hover"
                >
                  <Plus size={15} />
                  Add Widget
                </button>
              </div>

              <div className={cn("mt-4 space-y-4", asModal && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2")}>
                <ProfilePreviewWidgetCard title="Featured Widget" subtitle="Example board card">
                  <div className="flex gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold text-rm-text-muted">Ralph Meet</div>
                      <div className="mt-3 text-[18px] font-semibold text-rm-text">{currentDisplayName}</div>
                      <div className="mt-1 text-[13px] text-rm-text-muted">Season preview and profile card composition.</div>
                    </div>
                    <div className="relative hidden w-[150px] overflow-hidden rounded-[18px] border border-white/8 bg-[radial-gradient(circle_at_top_right,_rgba(255,141,87,0.28),_transparent_40%),linear-gradient(135deg,_rgba(45,36,33,0.95),_rgba(23,26,35,0.98))] md:block">
                      <ProfileCollectiblesLayer display={currentAvatarDisplay} effectOpacity={0.82} fit="cover" className="opacity-[0.88]" />
                      <div className="absolute bottom-3 right-3 h-16 w-16 overflow-hidden rounded-full border border-white/10 bg-white/8">
                        {currentAvatarSrc ? (
                          <AvatarImage src={currentAvatarSrc} alt="" display={currentAvatarDisplayWithoutDecoration} />
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
                    {[
                      { label: "Highlights", value: "2.1K" },
                      { label: "Sessions", value: "665h" },
                      { label: "Wins", value: "3.8K" },
                    ].map((item) => (
                      <div key={item.label}>
                        <div className="font-semibold text-rm-text">{item.value}</div>
                        <div className="mt-1 text-rm-text-muted">{item.label}</div>
                      </div>
                    ))}
                  </div>
                </ProfilePreviewWidgetCard>

                <ProfilePreviewWidgetCard title="Favorite game" subtitle="Choose 1 game">
                  <div className="flex items-center gap-4">
                    <div className="h-[84px] w-[84px] shrink-0 overflow-hidden rounded-[18px] border border-white/8 bg-[linear-gradient(135deg,_#d8dde7,_#64748b_70%,_#1f2937)]" />
                    <div className="min-w-0">
                      <div className="truncate text-[16px] font-semibold text-rm-text">Your featured title goes here</div>
                      <div className="mt-2 text-[13px] italic text-rm-text-muted">
                        Let everyone know why this is your favorite.
                      </div>
                      <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-rm-text-muted">
                        + Tags
                      </div>
                    </div>
                  </div>
                </ProfilePreviewWidgetCard>

                <ProfilePreviewWidgetCard title="Games in rotation" subtitle="Add up to 5 games">
                  <div className="space-y-3">
                    {[1, 2].map((item) => (
                      <div key={item} className="flex items-center gap-3 rounded-[18px] border border-white/8 bg-black/16 p-3">
                        <div className="h-[54px] w-[54px] shrink-0 overflow-hidden rounded-[14px] bg-[linear-gradient(135deg,_#f2c94c,_#f97316_72%,_#7c2d12)]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-semibold text-rm-text">Rotating game slot {item}</div>
                          <div className="mt-1 text-[12px] text-rm-text-muted">Add art, tags, and quick notes here.</div>
                        </div>
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/8 bg-white/[0.03] text-rm-text-muted transition hover:bg-white/[0.08] hover:text-rm-text"
                          aria-label={`Remove rotating game slot ${item}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </ProfilePreviewWidgetCard>

                {!asModal ? (
                  <ProfilePreviewWidgetCard title="Profile Details" subtitle="Display names and usernames update everywhere this account appears.">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rm-text-muted">Display Name</Label>
                        <Input
                          value={displayName}
                          onChange={(event) => setDisplayName(event.target.value)}
                          className="h-11 rounded-xl border-white/10 bg-white/[0.03] text-rm-text shadow-none placeholder:text-rm-text-muted focus-visible:ring-primary/40"
                          placeholder="Add a display name"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rm-text-muted">Username</Label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-rm-text-muted/50">@</span>
                          <Input
                            value={username}
                            onChange={handleUsernameChange}
                            className="h-11 rounded-xl border-white/10 bg-white/[0.03] pl-8 text-rm-text shadow-none placeholder:text-rm-text-muted focus-visible:ring-primary/40"
                          />
                        </div>
                        {usernameStatus !== "idle" && usernameStatus !== "own" ? (
                          <p
                            className={cn(
                              "flex items-center gap-1.5 text-[12px]",
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
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rm-text-muted">Email</Label>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-rm-text-secondary">
                          {user.primaryEmailAddress?.emailAddress || "No email on file"}
                        </div>
                      </div>

                      <div className="rounded-[18px] border border-white/8 bg-black/16 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rm-text-muted">Current Setup</div>
                        <div className="mt-3 space-y-2 text-sm text-rm-text-secondary">
                          <div className="flex items-center justify-between gap-3">
                            <span>Avatar decoration</span>
                            <span className="truncate text-rm-text">{currentAvatarDecoration?.name ?? "None"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Nameplate</span>
                            <span className="truncate text-rm-text">{currentNameplateSelection?.name ?? (currentNameplateUrl ? "Custom upload" : "None")}</span>
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
                    </div>
                  </ProfilePreviewWidgetCard>
                ) : null}
              </div>
            </aside>
          </div>

          {!asModal && (claimLoading || claimCandidates.length > 0 || claimError) ? (
            <section className="mt-6 rounded-[32px] border border-amber-500/25 bg-amber-500/10 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.20)]">
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
          ) : null}

          {!asModal && hasChanges ? (
            <div className="mt-6 flex flex-col gap-3 rounded-[24px] border border-rm-border bg-rm-bg-elevated/92 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-rm-text">Don&apos;t forget to save your changes.</p>
                <p className="mt-1 text-xs text-rm-text-muted">Reset this draft or save it when you&apos;re ready.</p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetDraftState}
                  disabled={saving}
                  className="h-10 rounded-xl border border-rm-border bg-rm-bg-surface/80 px-4 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
                >
                  Reset
                </Button>
                <Button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="h-10 rounded-xl bg-primary px-4 text-primary-foreground hover:bg-primary/90"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : "Save Changes"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {asModal && hasChanges ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[120] flex justify-center px-4 md:bottom-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="pointer-events-auto flex w-full max-w-[520px] flex-col gap-3 rounded-[24px] border border-rm-border bg-rm-bg-elevated/94 px-4 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-rm-text">Don&apos;t forget to save your changes.</p>
              <p className="mt-1 text-xs text-rm-text-muted">Reset this draft or save it when you&apos;re ready.</p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={resetDraftState}
                disabled={saving}
                className="h-10 rounded-xl border border-rm-border bg-rm-bg-surface/80 px-4 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
              >
                Reset
              </Button>
              <Button
                onClick={handleSaveProfile}
                disabled={saving}
                className="h-10 rounded-xl bg-primary px-4 text-primary-foreground hover:bg-primary/90"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
