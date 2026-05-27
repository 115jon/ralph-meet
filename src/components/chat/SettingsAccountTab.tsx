import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useUser } from "@kova/react";
import { AlertTriangle, Check, Loader2, Upload, UserRoundCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type ClaimCandidate = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  match_method: string;
};

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
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    fileInputRef, checkTimeoutRef, abortRef,
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

  const hasChanges =
    displayName !== (chatUser?.display_name || (user?.unsafeMetadata?.displayName as string) || user?.username || "") ||
    username !== (chatUser?.username || user?.username || "") ||
    avatarFile !== null;

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

      if (typeof user.reload === "function") {
        await user.reload();
      }
      await loadCurrentUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("[Profile] Failed to save:", err);
      setError(err instanceof Error ? err.message : "Failed to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [user, displayName, username, avatarFile, loadCurrentUser, setSaving, setSaved, setError, setAvatarPreview, setAvatarFile]);

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
        <div className="h-[80px] md:h-[100px] bg-gradient-to-r from-indigo-500 to-purple-500" />
        <div className="px-4 pb-4 -mt-10 md:-mt-12 flex flex-col items-center md:flex-row md:items-start md:gap-4 text-center md:text-left">
          <div className="relative shrink-0 mb-3 md:mb-0">
            <div className="h-[80px] w-[80px] md:h-[80px] md:w-[80px] rounded-full border-[6px] border-[var(--rm-bg-surface)] bg-rm-bg-elevated overflow-hidden relative shadow-md">
              <img
                src={avatarPreview || chatUser?.avatar_url || user.imageUrl}
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
              {chatUser?.display_name || chatUser?.username || user.username}
            </h2>
            <p className="text-sm text-rm-text-muted">
              @{chatUser?.username || user.username}
            </p>
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
                              {candidate.username[0]?.toUpperCase()}
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
