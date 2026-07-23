import { AvatarImage } from "@/components/chat/AvatarImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPatch } from "@/lib/api-client";
import { getDisplayName, getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { DisplayNameSchema, UsernameSchema } from "@/lib/validations";
import { useChatStore } from "@/stores/chat-store";
import { useUser } from "@kova/react";
import {
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const USERNAME_CHECK_DELAY_MS = 400;

type EditableProfileField = "displayName" | "username";
type UsernameCheckState =
  | "idle"
  | "checking"
  | "available"
  | "unavailable"
  | "invalid"
  | "error";

type UsernameCheckResponse = {
  available: boolean;
};

function InlineProfileRow({
  field,
  label,
  value,
  onSave,
}: {
  field: EditableProfileField;
  label: string;
  value: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameCheck, setUsernameCheck] =
    useState<UsernameCheckState>("idle");
  const [checkedUsername, setCheckedUsername] = useState<string | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing || field !== "username") return undefined;

    const normalized = draft.trim().toLowerCase();
    if (normalized === value.trim().toLowerCase()) {
      setUsernameCheck("available");
      setCheckedUsername(normalized);
      return undefined;
    }
    if (!UsernameSchema.safeParse(draft).success) {
      setUsernameCheck("invalid");
      setCheckedUsername(null);
      return undefined;
    }
    setCheckedUsername(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setUsernameCheck("checking");
      void apiGet<UsernameCheckResponse>(
        `/api/check-username?username=${encodeURIComponent(normalized)}`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setCheckedUsername(normalized);
            setUsernameCheck(result.available ? "available" : "unavailable");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setUsernameCheck("error");
        });
    }, USERNAME_CHECK_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [draft, editing, field, value]);

  useEffect(() => {
    if (!editing && wasEditing.current) editButtonRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const handleEdit = () => {
    setDraft(value);
    setError(null);
    setUsernameCheck(field === "username" ? "available" : "idle");
    setCheckedUsername(
      field === "username" ? value.trim().toLowerCase() : null,
    );
    setEditing(true);
  };

  const handleCancel = () => {
    setDraft(value);
    setError(null);
    setUsernameCheck("idle");
    setCheckedUsername(null);
    setEditing(false);
  };

  const handleSave = async () => {
    if (saving || savingRef.current) return;

    const parsed =
      field === "username"
        ? UsernameSchema.safeParse(draft)
        : DisplayNameSchema.safeParse(draft);
    if (!parsed.success) {
      if (field === "username") setUsernameCheck("invalid");
      setError(parsed.error.issues[0]?.message ?? "Invalid value");
      return;
    }
    const nextValue = parsed.data;

    if (field === "username") {
      if (usernameCheck !== "available" || checkedUsername !== nextValue) {
        return;
      }
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(nextValue);
      setEditing(false);
      setUsernameCheck("idle");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save this value.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (editing) {
    const usernameMessage =
      field === "username"
        ? usernameCheck === "checking"
          ? "Checking availability..."
          : usernameCheck === "available"
            ? "Username is available"
            : usernameCheck === "unavailable"
              ? "That username is already taken"
              : usernameCheck === "invalid"
                ? "Use 2-32 letters, numbers, dots, hyphens, or underscores"
                : usernameCheck === "error"
                  ? "Could not check username availability"
                  : null
        : null;

    return (
      <div className="flex flex-col gap-3 border-b border-rm-border/70 py-5 last:border-b-0 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-rm-text">{label}</div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              autoFocus
              aria-label={label}
              value={draft}
              onChange={(event) => {
                const nextDraft = event.target.value;
                setDraft(nextDraft);
                setError(null);
                if (field === "username") {
                  const normalized = nextDraft.trim().toLowerCase();
                  setUsernameCheck(
                    normalized === value.trim().toLowerCase()
                      ? "available"
                      : UsernameSchema.safeParse(nextDraft).success
                        ? "checking"
                        : "invalid",
                  );
                  setCheckedUsername(
                    normalized === value.trim().toLowerCase()
                      ? normalized
                      : null,
                  );
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSave();
                }
                if (event.key === "Escape" && !saving) {
                  event.preventDefault();
                  handleCancel();
                }
              }}
              className="h-10 border-rm-border bg-rm-bg-primary text-rm-text"
            />
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="icon"
                onClick={() => void handleSave()}
                disabled={
                  saving ||
                  (field === "username" && usernameCheck !== "available")
                }
                aria-label={`Save ${label.toLowerCase()}`}
                className="h-10 w-10 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? <Loader2 className="animate-spin" /> : <Check />}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={handleCancel}
                disabled={saving}
                aria-label={`Cancel ${label.toLowerCase()} edit`}
                className="h-10 w-10 border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover"
              >
                <X />
              </Button>
            </div>
          </div>
          {usernameMessage ? (
            <div
              className="mt-2 text-xs text-rm-text-muted"
              role="status"
              aria-live="polite"
            >
              {usernameMessage}
            </div>
          ) : null}
          {error ? (
            <div className="mt-2 text-xs text-destructive" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-b border-rm-border/70 py-5 last:border-b-0 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-rm-text">{label}</div>
        <div className="mt-1 truncate text-sm text-rm-text-secondary">
          {field === "username" ? `@${value}` : value}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={handleEdit}
        ref={editButtonRef}
        aria-label={`Edit ${label.toLowerCase()}`}
        className="h-10 shrink-0 border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover"
      >
        <Pencil size={15} />
        Edit
      </Button>
    </div>
  );
}

function OverviewRow({
  label,
  value,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  actionLabel?: string;
  onAction?: (trigger?: HTMLElement) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-rm-border/70 py-5 last:border-b-0 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="text-sm font-semibold text-rm-text">{label}</div>
        <div className="mt-1 text-sm text-rm-text-secondary">{value}</div>
      </div>
      {actionLabel && onAction && (
        <Button
          type="button"
          variant="outline"
          onClick={(event) => onAction(event.currentTarget)}
          className="h-10 shrink-0 border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export default function SettingsAccountOverviewTab({
  onOpenProfileEditor,
}: {
  onOpenProfileEditor: (trigger?: HTMLElement) => void;
}) {
  const { user } = useUser();
  const chatUser = useChatStore((s) => s.user);
  const loadCurrentUser = useChatStore((s) => s.actions.loadCurrentUser);

  const displayName = getDisplayName({
    display_name: chatUser?.display_name ?? null,
    username: chatUser?.username ?? user?.username ?? "",
  });
  const username = chatUser?.username || user?.username || "Unknown";
  const [savedProfileValues, setSavedProfileValues] = useState<{
    displayName: string | null;
    username: string;
  } | null>(null);
  const profileValues = savedProfileValues
    ? {
        displayName:
          savedProfileValues.displayName ?? savedProfileValues.username,
        username: savedProfileValues.username,
      }
    : { displayName, username };
  const latestProfileValues = useRef<{
    displayName: string | null;
    username: string;
  }>({ displayName, username });
  const [identitySaving, setIdentitySaving] = useState(false);
  const identitySaveChain = useRef(Promise.resolve());

  useEffect(() => {
    if (!savedProfileValues) {
      latestProfileValues.current = { displayName, username };
    }
  }, [displayName, savedProfileValues, username]);

  if (!user) {
    return (
      <div className="animate-in fade-in slide-in-from-right-4 duration-300">
        <h1 className="mb-2 hidden text-2xl font-bold text-rm-text md:block">
          Account
        </h1>
        <p className="mb-8 text-sm text-rm-text-muted">
          We are still loading your account details.
        </p>
      </div>
    );
  }

  const email = user.primaryEmailAddress?.emailAddress || "No email on file";
  const avatarUrl = chatUser?.avatar_url
    ? getAuthAssetUrl(chatUser.avatar_url)
    : user.imageUrl;
  const avatarDisplay = chatUser?.avatar_display ?? null;

  const saveProfileField = async (
    field: EditableProfileField,
    value: string,
  ) => {
    const saveOperation = identitySaveChain.current.then(async () => {
      setIdentitySaving(true);
      try {
        await apiPatch("/api/update-profile", {
          [field]: value,
        });
        const current = latestProfileValues.current;
        const nextValues = {
          displayName:
            field === "displayName"
              ? value || null
              : current.displayName || null,
          username: field === "username" ? value : current.username,
        };
        latestProfileValues.current = nextValues;
        setSavedProfileValues(nextValues);
        const refreshed = await loadCurrentUser();
        if (refreshed) setSavedProfileValues(null);
      } finally {
        setIdentitySaving(false);
      }
    });
    identitySaveChain.current = saveOperation.catch(() => undefined);
    return saveOperation;
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <h1 className="mb-2 hidden text-2xl font-bold text-rm-text md:block">
        Account
      </h1>
      <p className="mb-8 max-w-2xl text-sm text-rm-text-muted">
        Manage your identity, security, and profile appearance from one place.
      </p>

      <section className="overflow-hidden rounded-[26px] border border-rm-border bg-rm-bg-surface shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
        <div className="flex flex-col gap-4 border-b border-rm-border/70 bg-[radial-gradient(circle_at_top,_rgba(92,112,255,0.16),_transparent_48%),linear-gradient(180deg,_rgba(255,255,255,0.02),_rgba(255,255,255,0))] px-5 py-5 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-rm-bg-elevated">
              {avatarUrl ? (
                <AvatarImage
                  src={avatarUrl}
                  alt={profileValues.displayName}
                  display={avatarDisplay}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-bold text-rm-text">
                  {getDisplayInitial({ name: profileValues.displayName })}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-bold text-rm-text">
                {profileValues.displayName}
              </div>
              <div className="truncate text-sm text-rm-text-muted">
                @{profileValues.username}
              </div>
            </div>
          </div>
          <Button
            type="button"
            onClick={(event) => onOpenProfileEditor(event.currentTarget)}
            disabled={identitySaving}
            className="h-10 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Sparkles size={16} />
            Edit profile
          </Button>
        </div>

        <div className="px-5 py-5 md:px-8">
          <div className="border-b border-rm-border/70 pb-4">
            <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-rm-text">
              Account info
            </h2>
          </div>
          <InlineProfileRow
            field="displayName"
            label="Display name"
            value={profileValues.displayName}
            onSave={(value) => saveProfileField("displayName", value)}
          />
          <InlineProfileRow
            field="username"
            label="Username"
            value={profileValues.username}
            onSave={(value) => saveProfileField("username", value)}
          />
          <OverviewRow label="Email" value={email} />
          <OverviewRow
            label="Profile appearance"
            value="Avatar, decoration, banner, nameplate, and profile effect"
            actionLabel="Customize"
            onAction={onOpenProfileEditor}
          />
        </div>

        <div className="grid gap-6 px-5 py-6 md:grid-cols-2 md:px-8">
          <section className="rounded-2xl border border-rm-border bg-rm-bg-primary/40 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-300">
                <CheckCircle2 size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-rm-text">
                  Account standing
                </h3>
                <p className="text-sm text-rm-text-secondary">
                  Your account is in good shape.
                </p>
              </div>
            </div>
            <p className="text-sm leading-6 text-rm-text-muted">
              We do not see any current restrictions on this account.
            </p>
          </section>

          <section className="rounded-2xl border border-rm-border bg-rm-bg-primary/40 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-300">
                <Shield size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-rm-text">Security</h3>
                <p className="text-sm text-rm-text-secondary">
                  Signed in with Ralph Auth.
                </p>
              </div>
            </div>
            <p className="text-sm leading-6 text-rm-text-muted">
              Password, sessions, and additional security controls will appear
              here as we expand account management.
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
