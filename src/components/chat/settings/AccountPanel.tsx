import { AvatarImage } from "@/components/chat/AvatarImage";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import type { AvatarDisplay } from "@/lib/avatar-display";
import { clog } from "@/lib/console-logger";
import {
  clearDesktopAuthSession,
  markAuthLogoutIntent,
} from "@/lib/desktop-auth";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { DisplayNameSchema, UsernameSchema } from "@/lib/validations";
import { useChatStore } from "@/stores/chat-store";
import { useAuth, useUser } from "@kova/react";
import { useEffect, useRef, useState } from "react";
import {
  ComingLater,
  ConfirmStrip,
  SettingsCard,
  SettingsRow,
  useConfirm,
  useSettings,
  useSettingsEscape,
  ValueText,
} from "./primitives";

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

/** Display name and username: a value with Edit, and an inline editor. */
function ProfileFieldRow({
  rowId,
  field,
  label,
  value,
  onSave,
}: {
  rowId: string;
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

  useSettingsEscape(editing && !saving, handleCancel);

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
      const status = (saveError as { status?: number } | null)?.status;
      setError(
        field === "username" && status === 409
          ? "That username is taken. Try another one."
          : describeApiError(
              saveError,
              field === "username"
                ? "save your username"
                : "save your display name",
            ),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const usernameMessage =
    field === "username"
      ? usernameCheck === "checking"
        ? "Checking availability…"
        : usernameCheck === "available"
          ? "Username is available"
          : usernameCheck === "unavailable"
            ? "That username is taken. Try another."
            : usernameCheck === "invalid"
              ? "Use 2–32 letters, numbers, dots, hyphens or underscores."
              : usernameCheck === "error"
                ? "Couldn't check availability. Try again."
                : null
      : null;

  return (
    <SettingsRow
      id={rowId}
      layout="inline"
      footer={
        editing ? (
          <div className="mt-3">
            <div className="flex flex-col gap-2 @min-[560px]:flex-row">
              <div className="relative min-w-0 flex-1">
                {field === "username" ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ui-sm text-rm-text-secondary"
                  >
                    @
                  </span>
                ) : null}
                <Input
                  autoFocus
                  aria-label={label}
                  aria-invalid={
                    error || usernameCheck === "unavailable" ? true : undefined
                  }
                  value={draft}
                  autoComplete={field === "username" ? "username" : "nickname"}
                  spellCheck={false}
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
                  }}
                  className={field === "username" ? "pl-7" : undefined}
                />
              </div>
              <div className="flex shrink-0 justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleCancel}
                  disabled={saving}
                  aria-label={`Cancel ${label.toLowerCase()} edit`}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSave()}
                  loading={saving}
                  disabled={
                    field === "username" && usernameCheck !== "available"
                  }
                  aria-label={`Save ${label.toLowerCase()}`}
                >
                  Save
                </Button>
              </div>
            </div>
            <p
              className="mt-2 min-h-4 text-ui-xs text-rm-text-secondary"
              role="status"
              aria-live="polite"
            >
              {usernameMessage}
            </p>
            {error ? (
              <p className="mt-1 text-ui-xs text-rm-danger-ink" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null
      }
    >
      {() =>
        editing ? null : (
          <>
            <ValueText>{field === "username" ? `@${value}` : value}</ValueText>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleEdit}
              ref={editButtonRef}
              aria-label={`Edit ${label.toLowerCase()}`}
            >
              Edit
            </Button>
          </>
        )
      }
    </SettingsRow>
  );
}

type ClaimCandidate = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_display?: AvatarDisplay | string | null;
  match_method: string;
};

const claimLog = clog("AccountClaims");

/**
 * Legacy Ralph Meet accounts that match this login. Renders nothing unless
 * the server offers at least one; claiming merges it and reloads the app.
 */
function ClaimAccountCard() {
  const loadCurrentUser = useChatStore((s) => s.actions.loadCurrentUser);
  const [candidates, setCandidates] = useState<ClaimCandidate[]>([]);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    let cancelled = false;
    apiGet<{ claimed: boolean; candidates: ClaimCandidate[] }>(
      "/api/account-claims",
    )
      .then((data) => {
        if (!cancelled)
          setCandidates(data?.claimed ? [] : (data?.candidates ?? []));
      })
      .catch((err) => {
        // Optional discovery: a failed check hides the card.
        claimLog.warn("Unable to check claimable accounts:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cancel = () => {
    const id = armedId;
    setArmedId(null);
    setError(null);
    if (id) requestAnimationFrame(() => triggerRefs.current.get(id)?.focus());
  };
  useSettingsEscape(armedId !== null && !claiming, cancel);

  const claim = async (legacyUserId: string) => {
    setClaiming(true);
    setError(null);
    try {
      await apiPost("/api/account-claims", { legacyUserId });
      await loadCurrentUser();
      window.location.reload();
    } catch (err) {
      setError(describeApiError(err, "claim that account"));
      setClaiming(false);
    }
  };

  if (candidates.length === 0) return null;

  return (
    <SettingsCard
      title="Claim an existing account"
      description="We found a Ralph Meet account that may be yours. Claim it to bring its servers, messages and profile into this sign-in."
    >
      {candidates.map((candidate) => {
        const name = candidate.display_name || candidate.username;
        const armed = armedId === candidate.id;
        return (
          <SettingsRow
            key={candidate.id}
            id={`claim-${candidate.id}`}
            label={<InlineEmojiText text={name} />}
            description={`@${candidate.username}`}
            layout="inline"
            leading={
              <span className="relative flex size-10 overflow-hidden rounded-full bg-rm-tint-2">
                {candidate.avatar_url ? (
                  <AvatarImage
                    src={candidate.avatar_url}
                    alt=""
                    display={candidate.avatar_display}
                  />
                ) : (
                  <span className="flex size-full items-center justify-center text-ui-sm font-semibold text-rm-text-secondary">
                    {getDisplayInitial(candidate)}
                  </span>
                )}
              </span>
            }
            footer={
              armed ? (
                <ConfirmStrip
                  consequence={`@${candidate.username} will be merged into this sign-in and the app will reload. You can't undo this.`}
                  confirmLabel="Claim account"
                  busy={claiming}
                  irreversible
                  error={error}
                  onCancel={cancel}
                  onConfirm={() => void claim(candidate.id)}
                />
              ) : null
            }
          >
            {() => (
              <Button
                ref={(node) => {
                  if (node) triggerRefs.current.set(candidate.id, node);
                  else triggerRefs.current.delete(candidate.id);
                }}
                type="button"
                variant="secondary"
                aria-label={`Claim @${candidate.username}`}
                aria-expanded={armed}
                disabled={claiming}
                onClick={() => {
                  setError(null);
                  setArmedId(candidate.id);
                }}
              >
                Claim
              </Button>
            )}
          </SettingsRow>
        );
      })}
    </SettingsCard>
  );
}

export default function AccountPanel() {
  const { user, isLoaded } = useUser();
  const { signOut } = useAuth();
  const { openProfileEditor } = useSettings();
  const chatUser = useChatStore((s) => s.user);
  const loadCurrentUser = useChatStore((s) => s.actions.loadCurrentUser);
  const signOutConfirm = useConfirm();
  const [signingOut, setSigningOut] = useState(false);

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

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    (isLoaded === false ? "Loading…" : "No email on file");
  const avatarUrl = chatUser?.avatar_url
    ? getAuthAssetUrl(chatUser.avatar_url)
    : (user?.imageUrl ?? null);
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

  const handleSignOut = () => {
    setSigningOut(true);
    markAuthLogoutIntent();
    clearDesktopAuthSession();
    void signOut("/sign-in").finally(() => {
      if (typeof window !== "undefined") {
        window.location.replace("/sign-in");
      }
    });
  };

  return (
    <>
      <SettingsCard id="profile">
        <SettingsRow
          id="profile"
          layout="stack"
          leading={
            <span className="relative flex size-11 overflow-hidden rounded-full bg-rm-bg-elevated">
              {avatarUrl ? (
                <AvatarImage src={avatarUrl} alt="" display={avatarDisplay} />
              ) : (
                <span className="flex size-full items-center justify-center text-ui-base font-semibold text-rm-text">
                  {getDisplayInitial({ name: profileValues.displayName })}
                </span>
              )}
            </span>
          }
        >
          {() => (
            <Button
              type="button"
              onClick={(event) => openProfileEditor(event.currentTarget)}
              disabled={identitySaving}
            >
              <Icon name="edit" size="sm" />
              Edit profile
            </Button>
          )}
        </SettingsRow>
        <ProfileFieldRow
          rowId="display-name"
          field="displayName"
          label="Display name"
          value={profileValues.displayName}
          onSave={(value) => saveProfileField("displayName", value)}
        />
        <ProfileFieldRow
          rowId="username"
          field="username"
          label="Username"
          value={profileValues.username}
          onSave={(value) => saveProfileField("username", value)}
        />
        <SettingsRow id="server-profiles" layout="inline">
          {() => <ComingLater />}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard id="sign-in">
        <SettingsRow id="email" layout="inline">
          {() => <ValueText>{email}</ValueText>}
        </SettingsRow>
        <SettingsRow id="sign-in-method" layout="inline">
          {() => <ValueText>Ralph Auth</ValueText>}
        </SettingsRow>
        <SettingsRow
          id="sign-out"
          layout="inline"
          footer={
            signOutConfirm.armed ? (
              <ConfirmStrip
                consequence="You'll be signed out on this device, and any call you're in will end."
                confirmLabel="Sign out"
                busy={signingOut}
                onCancel={signOutConfirm.cancel}
                onConfirm={handleSignOut}
              />
            ) : null
          }
        >
          {(ids) => (
            <Button
              ref={signOutConfirm.triggerRef}
              type="button"
              variant="destructive"
              aria-describedby={ids.descId}
              aria-expanded={signOutConfirm.armed}
              onClick={signOutConfirm.arm}
            >
              <Icon name="logout" size="sm" />
              Sign out
            </Button>
          )}
        </SettingsRow>
      </SettingsCard>

      <ClaimAccountCard />
    </>
  );
}
