/**
 * The profile editor: everything inside the ProfileEditorModal frame.
 *
 *   header  ─ "Edit profile" + close, in every state (loading, signed out)
 *   body    ─ the one scroller: live preview beside the form on wide
 *             containers, stacked above it on phones
 *   footer  ─ the save bar (unsaved changes, Reset, Save) with the
 *             safe-area bottom; shown while there is a draft or an error
 *
 * The form follows the Studio settings recipe (SettingsCard / SettingsRow).
 * Edits are a draft until Save; the preview renders the draft.
 */

import { AvatarFrameEditor } from "@/components/chat/AvatarFrameEditor";
import { AvatarImage } from "@/components/chat/AvatarImage";
import {
  AvatarPickerModal,
  type AvatarUploadItem,
} from "@/components/chat/AvatarPickerModal";
import { CollectiblePicker } from "@/components/chat/collectibles/CollectiblePicker";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import { UserNameplateLayer } from "@/components/chat/UserNameplateLayer";
import {
  RowError,
  SettingsCard,
  SettingsRow,
  type RowIds,
} from "@/components/chat/settings/primitives";
import { Button, Spinner } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { HIT, PRESS } from "@/components/ui/interaction";
import { apiDelete, apiPatch, apiUpload } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import {
  getAvatarCollectibles,
  normalizeAvatarDisplay,
  serializeAvatarDisplay,
  type AvatarCollectibles,
  type AvatarDisplay,
} from "@/lib/avatar-display";
import type { CollectibleKind } from "@/lib/collectibles-catalog";
import { clog } from "@/lib/console-logger";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import {
  applyProfileThemeDefaults,
  hasCustomProfileColors,
  createRandomDisplayNameStyle,
  DEFAULT_DISPLAY_NAME_STYLE,
  DEFAULT_PROFILE_THEME,
  DISPLAY_NAME_COLOR_SWATCHES,
  DISPLAY_NAME_EFFECT_OPTIONS,
  DISPLAY_NAME_FONT_OPTIONS,
  normalizeDisplayNameStyle,
  normalizeHexColor,
  PROFILE_BANNER_CHIP_STYLE,
  PROFILE_COLOR_SWATCHES,
  resolveProfileTheme,
  type DisplayNameStyle,
} from "@/lib/profile-customization";
import { resolveProfileReferenceDate } from "@/lib/profile-dates";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useUser } from "@kova/react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";

const log = clog("Profile");

const PRONOUNS_MAX = 40;
const BIO_MAX = 190;
const CUSTOM_STATUS_MAX = 128;

const COLLECTIBLE_DISPLAY_KEYS: Record<
  CollectibleKind,
  keyof AvatarCollectibles
> = {
  avatar_decoration: "avatarDecoration",
  profile_effect: "profileEffect",
  nameplate: "nameplate",
  profile_frame: "profileFrame",
};

type JoinedMemberPreview = {
  user: User;
  joined_at?: string | number | null;
};

type AssetPreview = { url: string; contentType: string };

type CollectibleApplyUser = {
  avatar_display: AvatarDisplay | null;
  nameplate_url: string | null;
  nameplate_content_type: string | null;
  updated_at: string | null;
};

/** Starting values for fixtures and tests; production passes none. */
export type ProfileEditorDraft = {
  pronouns?: string;
  bio?: string;
  customStatus?: string;
};

function createAssetPreview(file: File): AssetPreview {
  return {
    url: URL.createObjectURL(file),
    contentType: file.type || "application/octet-stream",
  };
}

function areDisplayNameStylesEqual(
  left: DisplayNameStyle | string | null | undefined,
  right: DisplayNameStyle | string | null | undefined,
) {
  const leftStyle = normalizeDisplayNameStyle(left);
  const rightStyle = normalizeDisplayNameStyle(right);
  if (!leftStyle || !rightStyle) return leftStyle === rightStyle;
  return JSON.stringify(leftStyle) === JSON.stringify(rightStyle);
}

function isManagedNameplateUrl(url: string | null | undefined) {
  return (
    typeof url === "string" && url.startsWith("/api/profile-assets/nameplate/")
  );
}

function removeCollectibleFromAvatarDisplay(
  display: AvatarDisplay | string | null,
  kind: CollectibleKind,
): AvatarDisplay | null {
  const normalized = normalizeAvatarDisplay(display);
  const key = COLLECTIBLE_DISPLAY_KEYS[kind];
  if (!normalized?.collectibles?.[key]) return normalized ?? null;
  const remaining = { ...normalized.collectibles };
  delete remaining[key];
  return {
    ...normalized,
    collectibles: Object.keys(remaining).length > 0 ? remaining : undefined,
  } satisfies AvatarDisplay;
}

function withoutCrop(
  display: AvatarDisplay | string | null,
): AvatarDisplay | string | null {
  const normalized = normalizeAvatarDisplay(display);
  if (!normalized?.crop) return normalized ?? display;
  return normalized.collectibles
    ? ({
        version: 1,
        collectibles: normalized.collectibles,
      } satisfies AvatarDisplay)
    : null;
}

function withoutDecoration(
  display: AvatarDisplay | string | null,
): AvatarDisplay | string | null {
  const normalized = normalizeAvatarDisplay(display);
  if (!normalized?.collectibles?.avatarDecoration) {
    return normalized ?? display;
  }
  return removeCollectibleFromAvatarDisplay(normalized, "avatar_decoration");
}

/* ------------------------------------------------------------------ */
/* Frame                                                                */
/* ------------------------------------------------------------------ */

function EditorHeader({ onClose }: { onClose?: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-rm-border px-4 md:px-6">
      <h2 className="min-w-0 flex-1 truncate text-ui-xl font-semibold text-rm-text">
        Edit profile
      </h2>
      {onClose ? (
        <IconButton
          icon="close"
          size="sm"
          aria-label="Close profile editor"
          onClick={onClose}
        />
      ) : null}
    </header>
  );
}

function EditorStateBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto overscroll-contain px-6 py-12 text-center">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                             */
/* ------------------------------------------------------------------ */

const FIELD =
  "min-h-11 border-rm-field-edge text-ui-md md:min-h-9 md:text-ui-sm";

const SWATCH = cn(
  "size-9 shrink-0 rounded-md border border-rm-border-strong md:size-7",
  PRESS,
  HIT,
  "aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-(--rm-focus)",
);

/**
 * Preset swatches, the system colour picker and a hex field. `value` null
 * means "use the default" (`allowAuto`) or falls back to `fallback`.
 */
function ColorControl({
  ids,
  name,
  value,
  fallback,
  presets,
  onChange,
  allowAuto = false,
}: {
  ids: RowIds;
  /** Lowercase noun for control names ("background color"). */
  name: string;
  value: string | null;
  fallback: string;
  presets: readonly string[];
  onChange: (value: string | null) => void;
  allowAuto?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const resolved = normalizeHexColor(value) ?? normalizeHexColor(fallback);
  const shown = draft ?? (value ? value.replace(/^#/, "") : "");
  const isDefault = allowAuto
    ? value === null
    : normalizeHexColor(value) === normalizeHexColor(fallback);

  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      if (allowAuto) onChange(null);
    } else {
      const next = normalizeHexColor(
        trimmed.startsWith("#") ? trimmed : `#${trimmed}`,
      );
      if (next) onChange(next);
    }
    setDraft(null);
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <div
        role="group"
        aria-labelledby={ids.labelId}
        className="flex flex-wrap gap-2"
      >
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={SWATCH}
            style={{ background: preset }}
            aria-label={preset}
            aria-pressed={normalizeHexColor(value) === preset}
            onClick={() => onChange(preset)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label
          className={cn(
            SWATCH,
            "flex cursor-pointer items-center justify-center bg-rm-tint-1 text-rm-text-secondary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--rm-focus)",
          )}
        >
          <Icon name="eyedropper" size="sm" />
          <input
            type="color"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label={`Pick a custom ${name}`}
            value={(resolved ?? "#000000").toLowerCase()}
            onChange={(event) =>
              onChange(normalizeHexColor(event.currentTarget.value))
            }
          />
        </label>
        <div className="relative w-28">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ui-sm text-rm-text-muted"
          >
            #
          </span>
          <Input
            aria-label={`Hex ${name}`}
            aria-describedby={ids.descId}
            value={shown}
            placeholder={allowAuto ? "Auto" : fallback.replace(/^#/, "")}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
            className={cn(FIELD, "pl-6 tabular-nums")}
          />
        </div>
        <IconButton
          icon="reset"
          size="sm"
          variant="muted"
          tooltip={`Use the default ${name}`}
          disabled={isDefault}
          onClick={() => {
            setDraft(null);
            onChange(allowAuto ? null : fallback);
          }}
        />
      </div>
    </div>
  );
}

function CountedField({
  ids,
  value,
  max,
  placeholder,
  multiline = false,
  onChange,
}: {
  ids: RowIds;
  value: string;
  max: number;
  placeholder: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const countId = useId();
  const describedBy = [ids.descId, countId].filter(Boolean).join(" ");
  return (
    <div className="flex w-full flex-col gap-1">
      {multiline ? (
        <textarea
          aria-labelledby={ids.labelId}
          aria-describedby={describedBy}
          value={value}
          maxLength={max}
          rows={3}
          placeholder={placeholder}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="w-full resize-y rounded-md border border-rm-field-edge bg-transparent px-3 py-2 text-ui-md text-rm-text outline-none placeholder:text-rm-text-muted md:text-ui-sm"
        />
      ) : (
        <Input
          aria-labelledby={ids.labelId}
          aria-describedby={describedBy}
          value={value}
          maxLength={max}
          placeholder={placeholder}
          onChange={(event) => onChange(event.currentTarget.value)}
          className={FIELD}
        />
      )}
      <p
        id={countId}
        className="self-end text-ui-xs tabular-nums text-rm-text-muted"
      >
        {value.length}/{max}
      </p>
    </div>
  );
}

/** Small preview tile in a row's leading slot. */
function Thumb({
  children,
  wide = false,
  round = false,
  style,
}: {
  children?: ReactNode;
  wide?: boolean;
  round?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "relative flex h-11 shrink-0 items-center justify-center overflow-hidden border border-rm-border bg-rm-tint-1 text-rm-text-muted",
        wide ? "w-20" : "w-11",
        round ? "rounded-full" : "rounded-md",
      )}
      style={style}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Display name style dialog                                            */
/* ------------------------------------------------------------------ */

const TILE = cn(
  "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md border px-2 py-2 transition-colors duration-150",
  PRESS,
  "aria-pressed:border-rm-accent-ink/60 aria-pressed:bg-rm-accent-tint",
  "border-rm-border-strong pointer-fine:hover:bg-rm-tint-1",
);

function DisplayNameStyleDialog({
  open,
  displayName,
  username,
  initialStyle,
  themeStyle,
  themeBackgroundColor,
  themeTextColor,
  avatarSrc,
  avatarDisplay,
  onClose,
  onApply,
}: {
  open: boolean;
  displayName: string;
  username: string;
  initialStyle: DisplayNameStyle | null;
  themeStyle: CSSProperties;
  themeBackgroundColor: string | null;
  themeTextColor: string | null;
  avatarSrc?: string | null;
  avatarDisplay?: AvatarDisplay | string | null;
  onClose: () => void;
  onApply: (style: DisplayNameStyle | null) => void;
}) {
  const [draft, setDraft] = useState<DisplayNameStyle>(
    () => initialStyle ?? DEFAULT_DISPLAY_NAME_STYLE,
  );
  const fontLabelId = useId();
  const effectLabelId = useId();
  const baseLabelId = useId();
  const glowLabelId = useId();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <DialogOverlay className="z-70" />
        <DialogSurface
          showCloseButton={false}
          className="fixed inset-0 z-70 flex flex-col overflow-hidden bg-rm-bg-primary pt-[var(--safe-area-top,0px)] outline-none animate-in fade-in duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-150 md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[min(720px,calc(100dvh-32px))] md:w-[min(880px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border md:border-rm-border md:bg-rm-bg-surface md:pt-0 md:shadow-2xl md:dark:bg-rm-bg-elevated"
        >
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-rm-border px-4 md:px-6">
            <DialogTitle className="min-w-0 flex-1 truncate">
              Display name style
            </DialogTitle>
            <DialogDescription className="sr-only">
              Pick a font, an effect and colors for your display name.
            </DialogDescription>
            <IconButton
              icon="close"
              size="sm"
              aria-label="Close display name style"
              onClick={onClose}
            />
          </header>

          <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6 md:py-6">
            <div className="grid gap-6 @min-[640px]:grid-cols-[minmax(0,1fr)_280px] @min-[640px]:items-start">
              <div className="flex min-w-0 flex-col gap-6">
                <section className="flex flex-col gap-2">
                  <h3
                    id={fontLabelId}
                    className="text-ui-sm font-medium text-rm-text"
                  >
                    Font
                  </h3>
                  <div
                    role="group"
                    aria-labelledby={fontLabelId}
                    className="grid grid-cols-3 gap-2 @min-[420px]:grid-cols-4"
                  >
                    {DISPLAY_NAME_FONT_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={TILE}
                        aria-pressed={draft.font === option.id}
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, font: option.id }))
                        }
                      >
                        <ProfileDisplayName
                          text="Ag"
                          displayNameStyle={{ ...draft, font: option.id }}
                          className="block text-ui-lg font-semibold leading-none"
                        />
                        <span className="text-ui-xs text-rm-text-secondary">
                          {option.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h3
                    id={effectLabelId}
                    className="text-ui-sm font-medium text-rm-text"
                  >
                    Effect
                  </h3>
                  <div
                    role="group"
                    aria-labelledby={effectLabelId}
                    className="grid grid-cols-2 gap-2 @min-[420px]:grid-cols-3"
                  >
                    {DISPLAY_NAME_EFFECT_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={TILE}
                        aria-pressed={draft.effect === option.id}
                        aria-label={option.label}
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, effect: option.id }))
                        }
                      >
                        <ProfileDisplayName
                          text={option.label}
                          displayNameStyle={{
                            ...draft,
                            font: DEFAULT_DISPLAY_NAME_STYLE.font,
                            effect: option.id,
                          }}
                          className="block max-w-full truncate text-ui-sm font-semibold"
                        />
                      </button>
                    ))}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h3
                    id={baseLabelId}
                    className="text-ui-sm font-medium text-rm-text"
                  >
                    Base color
                  </h3>
                  <ColorControl
                    ids={{ labelId: baseLabelId }}
                    name="base color"
                    value={draft.primaryColor}
                    fallback={DEFAULT_DISPLAY_NAME_STYLE.primaryColor}
                    presets={DISPLAY_NAME_COLOR_SWATCHES}
                    onChange={(value) =>
                      setDraft((prev) => ({
                        ...prev,
                        primaryColor:
                          value ?? DEFAULT_DISPLAY_NAME_STYLE.primaryColor,
                      }))
                    }
                  />
                </section>

                <section className="flex flex-col gap-2">
                  <h3
                    id={glowLabelId}
                    className="text-ui-sm font-medium text-rm-text"
                  >
                    Highlight color
                  </h3>
                  <ColorControl
                    ids={{ labelId: glowLabelId }}
                    name="highlight color"
                    value={draft.secondaryColor}
                    fallback={DEFAULT_DISPLAY_NAME_STYLE.secondaryColor}
                    presets={DISPLAY_NAME_COLOR_SWATCHES}
                    onChange={(value) =>
                      setDraft((prev) => ({
                        ...prev,
                        secondaryColor:
                          value ?? DEFAULT_DISPLAY_NAME_STYLE.secondaryColor,
                      }))
                    }
                  />
                </section>
              </div>

              <section
                aria-label="Style preview"
                className="flex flex-col gap-3 @min-[640px]:sticky @min-[640px]:top-0"
              >
                <div
                  className="overflow-hidden rounded-lg border border-[color:var(--rm-profile-custom-card-border)]"
                  style={{
                    ...themeStyle,
                    backgroundColor: themeBackgroundColor ?? undefined,
                    backgroundImage: "var(--rm-profile-custom-surface)",
                  }}
                >
                  <div
                    className="h-12"
                    style={{
                      background: "var(--rm-profile-custom-banner-fallback)",
                    }}
                  />
                  <div className="flex flex-col gap-1 px-4 pb-4">
                    <span className="relative -mt-6 block size-12 rounded-full border-2 border-[color:var(--rm-profile-custom-background)] bg-[var(--rm-profile-custom-card-bg-strong)]">
                      {avatarSrc ? (
                        <AvatarImage
                          src={avatarSrc}
                          alt=""
                          display={withoutDecoration(avatarDisplay ?? null)}
                        />
                      ) : null}
                    </span>
                    <ProfileDisplayName
                      text={displayName}
                      displayNameStyle={draft}
                      className="mt-1 block truncate text-ui-xl font-semibold"
                      backgroundColor={themeBackgroundColor}
                      readableFallbackColor={themeTextColor}
                    />
                    <span className="truncate text-ui-sm text-[color:var(--rm-profile-custom-muted)]">
                      @{username}
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-rm-border bg-rm-bg-primary px-3 py-3">
                  <span className="relative block size-10 shrink-0 overflow-hidden rounded-full bg-rm-tint-2">
                    {avatarSrc ? (
                      <AvatarImage
                        src={avatarSrc}
                        alt=""
                        display={withoutDecoration(avatarDisplay ?? null)}
                      />
                    ) : null}
                  </span>
                  <div className="min-w-0">
                    <ProfileDisplayName
                      text={displayName}
                      displayNameStyle={draft}
                      className="block truncate text-ui-base font-medium"
                    />
                    <p className="text-ui-base text-rm-text">
                      Does anyone read this?
                    </p>
                  </div>
                </div>
                <p className="text-pretty text-ui-xs text-rm-text-secondary">
                  Colors and effects can look a little different on light and
                  dark themes.
                </p>
              </section>
            </div>
          </div>

          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-rm-border px-4 pt-3 pb-[max(12px,var(--safe-area-bottom,0px))] md:px-6">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDraft(createRandomDisplayNameStyle())}
            >
              <Icon name="sparkle" size="sm" />
              Surprise me
            </Button>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {initialStyle ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    onApply(null);
                    onClose();
                  }}
                >
                  Clear style
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onApply(draft);
                  onClose();
                }}
              >
                Apply
              </Button>
            </div>
          </footer>
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsAccountTab({
  authUserLoaded = true,
  onClose,
  initialDraft,
  initialError,
}: {
  authUserLoaded?: boolean;
  /**
   * Accepted for the existing callers; the editor only ever renders as the
   * dialog body (ProfileEditorModal is its one frame).
   */
  asModal?: boolean;
  onClose?: () => void;
  /** Fixtures/tests: start with a dirty draft. */
  initialDraft?: ProfileEditorDraft;
  /** Fixtures/tests: start with a failed-save message. */
  initialError?: string;
}) {
  const chatUser = useChatStore((s) => s.user);

  if (!chatUser) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EditorHeader onClose={onClose} />
        <EditorStateBody>
          {authUserLoaded ? (
            <>
              <Icon
                name="account"
                size="3xl"
                className="text-rm-text-muted max-md:hidden"
              />
              <Icon
                name="account"
                size="2xl"
                className="text-rm-text-muted md:hidden"
              />
              <p className="text-ui-lg font-semibold text-rm-text">
                You&apos;re signed out
              </p>
              <p className="max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
                Sign in again to edit your profile.
              </p>
              <Button asChild>
                <a href="/sign-in">Sign in</a>
              </Button>
            </>
          ) : (
            <span role="status" className="text-rm-text-muted">
              <Spinner className="size-6" />
              <span className="sr-only">Loading</span>
            </span>
          )}
        </EditorStateBody>
      </div>
    );
  }

  return (
    <ProfileEditor
      key={chatUser.id}
      chatUser={chatUser}
      onClose={onClose}
      initialDraft={initialDraft}
      initialError={initialError}
    />
  );
}

function ProfileEditor({
  chatUser,
  onClose,
  initialDraft,
  initialError,
}: {
  chatUser: User;
  onClose?: () => void;
  initialDraft?: ProfileEditorDraft;
  initialError?: string;
}) {
  const { user } = useUser();
  const loadCurrentUser = useChatStore((s) => s.actions.loadCurrentUser);
  const updateStatus = useChatStore((s) => s.actions.updateStatus);
  const activeServerId = useChatStore((s) => s.activeServerId);
  const previewMemberRecord = useChatStore(
    (state) =>
      (state.members as JoinedMemberPreview[]).find(
        (member) => member.user.id === state.user?.id,
      ) ?? null,
  );

  const storedColors = {
    profile_accent_color: chatUser.profile_accent_color,
    profile_background_color: chatUser.profile_background_color,
    profile_banner_color: chatUser.profile_banner_color,
  };
  const appliedTheme = applyProfileThemeDefaults(storedColors);
  // The server stores its default pair for people who never picked colours;
  // those read as "Auto" here, so the preview follows the app theme.
  const storedTheme: {
    profile_accent_color: string | null;
    profile_background_color: string | null;
    profile_banner_color: string | null;
  } = hasCustomProfileColors(storedColors)
    ? appliedTheme
    : {
        ...appliedTheme,
        profile_accent_color: null,
        profile_background_color: null,
      };
  const savedDisplayNameStyle = normalizeDisplayNameStyle(
    chatUser.display_name_style,
  );
  const savedCustomStatus = chatUser.custom_status?.trim() ?? "";

  /* Draft ----------------------------------------------------------- */
  const [pronouns, setPronouns] = useState(
    () => initialDraft?.pronouns ?? chatUser.pronouns ?? "",
  );
  const [bio, setBio] = useState(() => initialDraft?.bio ?? chatUser.bio ?? "");
  const [customStatus, setCustomStatus] = useState(
    () => initialDraft?.customStatus ?? chatUser.custom_status ?? "",
  );
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState<string | null>(
    null,
  );
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [avatarDisplay, setAvatarDisplay] = useState<
    AvatarDisplay | string | null
  >(() => chatUser.avatar_display ?? null);
  const [avatarDisplayChanged, setAvatarDisplayChanged] = useState(false);
  const [bannerPreview, setBannerPreview] = useState<AssetPreview | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [removeBanner, setRemoveBanner] = useState(false);
  const [nameplatePreview, setNameplatePreview] = useState<AssetPreview | null>(
    null,
  );
  const [nameplateFile, setNameplateFile] = useState<File | null>(null);
  const [removeNameplate, setRemoveNameplate] = useState(false);
  const [accentColor, setAccentColor] = useState<string | null>(
    () => storedTheme.profile_accent_color,
  );
  const [backgroundColor, setBackgroundColor] = useState<string | null>(
    () => storedTheme.profile_background_color,
  );
  const [bannerColor, setBannerColor] = useState<string | null>(
    () => storedTheme.profile_banner_color,
  );
  const [displayNameStyle, setDisplayNameStyle] =
    useState<DisplayNameStyle | null>(() => savedDisplayNameStyle);

  /* Status ---------------------------------------------------------- */
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  /* Sub-dialogs ----------------------------------------------------- */
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [bannerPickerOpen, setBannerPickerOpen] = useState(false);
  const [styleDialogOpen, setStyleDialogOpen] = useState(false);
  const [avatarEditor, setAvatarEditor] = useState<{
    src: string;
    file?: File;
  } | null>(null);
  const [collectiblesKind, setCollectiblesKind] =
    useState<CollectibleKind | null>(null);
  const nameplateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!avatarDisplayChanged && !avatarFile) {
      setAvatarDisplay(chatUser.avatar_display ?? null);
    }
  }, [avatarDisplayChanged, avatarFile, chatUser.avatar_display]);

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

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2400);
    return () => window.clearTimeout(timer);
  }, [saved]);

  /* Derived --------------------------------------------------------- */
  const hasChanges =
    pronouns !== (chatUser.pronouns || "") ||
    bio !== (chatUser.bio || "") ||
    customStatus.trim() !== savedCustomStatus ||
    avatarFile !== null ||
    selectedAvatarUrl !== null ||
    removeAvatar ||
    avatarDisplayChanged ||
    bannerFile !== null ||
    nameplateFile !== null ||
    removeBanner ||
    removeNameplate ||
    storedTheme.profile_accent_color !== accentColor ||
    storedTheme.profile_background_color !== backgroundColor ||
    storedTheme.profile_banner_color !== bannerColor ||
    !areDisplayNameStylesEqual(displayNameStyle, savedDisplayNameStyle);

  const previewTheme = resolveProfileTheme({
    profile_accent_color: accentColor,
    profile_background_color: backgroundColor,
    profile_banner_color: bannerColor,
  });
  const persistedAvatarSrc = chatUser.avatar_url
    ? getAuthAssetUrl(chatUser.avatar_url)
    : null;
  const fallbackAvatarSrc = user?.imageUrl || undefined;
  const draftAvatarDisplay =
    avatarDisplayChanged || avatarFile
      ? avatarDisplay
      : (chatUser.avatar_display ?? null);
  const currentAvatarSrc = removeAvatar
    ? fallbackAvatarSrc
    : avatarPreview || persistedAvatarSrc || fallbackAvatarSrc;
  const currentAvatarDisplay = removeAvatar
    ? withoutCrop(draftAvatarDisplay)
    : draftAvatarDisplay;
  const displayName =
    chatUser.display_name || chatUser.username || user?.username || "Profile";
  const username = chatUser.username || user?.username || "profile";
  const collectibles = getAvatarCollectibles(currentAvatarDisplay);
  const decoration = collectibles?.avatarDecoration;
  const profileEffect = collectibles?.profileEffect;
  const profileFrame = collectibles?.profileFrame;
  const nameplateSelection = collectibles?.nameplate;
  const hasRemovableAvatar = Boolean(
    avatarFile ||
    avatarPreview ||
    chatUser.avatar_url?.startsWith("/api/avatars/") ||
    normalizeAvatarDisplay(draftAvatarDisplay)?.crop,
  );
  const currentBannerUrl = removeBanner
    ? null
    : bannerPreview?.url || chatUser.banner_url || null;
  const currentBannerContentType = removeBanner
    ? null
    : bannerPreview?.contentType || chatUser.banner_content_type || null;
  const currentNameplateUrl = removeNameplate
    ? null
    : nameplatePreview?.url || chatUser.nameplate_url || null;
  const currentNameplateContentType = removeNameplate
    ? null
    : nameplatePreview?.contentType || chatUser.nameplate_content_type || null;
  const nameplateShownUrl =
    currentNameplateUrl || nameplateSelection?.staticUrl || null;
  const referenceDate = resolveProfileReferenceDate({
    joinedAt:
      activeServerId && activeServerId !== "@me"
        ? previewMemberRecord?.joined_at
        : null,
    createdAt: chatUser.created_at ?? user?.createdAt ?? null,
  });
  const trimmedPronouns = pronouns.trim();
  const trimmedBio = bio.trim();
  const trimmedStatus = customStatus.trim();

  const avatarStatus = removeAvatar
    ? "Removed when you save"
    : avatarFile
      ? "New image, uploads when you save"
      : selectedAvatarUrl
        ? "Recent image, applies when you save"
        : chatUser.avatar_url
          ? "Your current avatar"
          : "Using your sign-in picture";
  const bannerStatus = removeBanner
    ? "Removed when you save"
    : bannerFile
      ? "New image, uploads when you save"
      : currentBannerUrl
        ? "Your current banner"
        : "No banner. Your banner color shows instead.";
  const nameplateStatus = removeNameplate
    ? "Removed when you save"
    : nameplateFile
      ? "New file, uploads when you save"
      : nameplateSelection?.name
        ? nameplateSelection.name
        : currentNameplateUrl
          ? "Custom nameplate"
          : "None";

  /* Handlers -------------------------------------------------------- */
  const resetDraft = () => {
    setPronouns(chatUser.pronouns || "");
    setBio(chatUser.bio || "");
    setCustomStatus(chatUser.custom_status ?? "");
    setAvatarFile(null);
    setAvatarPreview(null);
    setSelectedAvatarUrl(null);
    setAvatarDisplay(chatUser.avatar_display ?? null);
    setAvatarDisplayChanged(false);
    setRemoveAvatar(false);
    setBannerFile(null);
    setBannerPreview(null);
    setRemoveBanner(false);
    setNameplateFile(null);
    setNameplatePreview(null);
    setRemoveNameplate(false);
    setAccentColor(storedTheme.profile_accent_color);
    setBackgroundColor(storedTheme.profile_background_color);
    setBannerColor(storedTheme.profile_banner_color);
    setDisplayNameStyle(savedDisplayNameStyle);
    setError(null);
    setSaved(false);
  };

  const syncCollectibleState = async (
    updatedUser: CollectibleApplyUser,
    appliedKinds: CollectibleKind[],
  ) => {
    const persisted = normalizeAvatarDisplay(updatedUser.avatar_display);
    const draft = normalizeAvatarDisplay(currentAvatarDisplay);
    const merged: AvatarCollectibles = { ...(draft?.collectibles ?? {}) };
    for (const kind of appliedKinds) {
      const key = COLLECTIBLE_DISPLAY_KEYS[kind];
      const next = persisted?.collectibles?.[key];
      if (next) Object.assign(merged, { [key]: next });
      else delete merged[key];
    }
    const mergedDisplay = normalizeAvatarDisplay({
      version: 1,
      ...(draft?.crop ? { crop: draft.crop } : {}),
      ...(Object.keys(merged).length > 0 ? { collectibles: merged } : {}),
    });
    setAvatarDisplay(mergedDisplay ?? persisted);
    if (appliedKinds.includes("nameplate")) {
      setRemoveNameplate(false);
      setNameplateFile(null);
      setNameplatePreview(null);
    }
    if (typeof user?.reload === "function") await user.reload();
    await loadCurrentUser();
    setAvatarDisplayChanged(
      Boolean(avatarFile) ||
        JSON.stringify(mergedDisplay) !== JSON.stringify(persisted),
    );
  };

  const handleAvatarFile = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for your avatar.");
      return;
    }
    setError(null);
    setSelectedAvatarUrl(null);
    setRemoveAvatar(false);
    setAvatarEditor({ src: URL.createObjectURL(file), file });
  };

  const handleRecentAvatarSelect = (item: AvatarUploadItem) => {
    setError(null);
    setAvatarFile(null);
    setRemoveAvatar(false);
    setSelectedAvatarUrl(item.avatar_url);
    setAvatarPreview(getAuthAssetUrl(item.avatar_url));
    setAvatarDisplay(withoutCrop(draftAvatarDisplay));
    setAvatarDisplayChanged(true);
    setAvatarPickerOpen(false);
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
      setSelectedAvatarUrl(null);
    }
    setRemoveAvatar(false);
    setAvatarDisplay(display);
    setAvatarDisplayChanged(true);
    setAvatarEditor(null);
  };

  const handleRemoveAvatar = () => {
    if (!hasRemovableAvatar) return;
    setError(null);
    setAvatarFile(null);
    setAvatarPreview(null);
    setSelectedAvatarUrl(null);
    setRemoveAvatar(true);
    setAvatarDisplayChanged(false);
  };

  const handleBannerFile = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for your banner.");
      return;
    }
    setError(null);
    setRemoveBanner(false);
    setBannerFile(file);
    setBannerPreview(createAssetPreview(file));
  };

  const handleRemoveBanner = () => {
    setRemoveBanner(true);
    setBannerFile(null);
    setBannerPreview(null);
  };

  const handleNameplateSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRemoveNameplate(false);
    setError(null);
    setNameplateFile(file);
    setNameplatePreview(createAssetPreview(file));
  };

  const handleRemoveCollectible = (kind: CollectibleKind) => {
    const present =
      kind === "avatar_decoration"
        ? decoration
        : kind === "profile_effect"
          ? profileEffect
          : kind === "profile_frame"
            ? profileFrame
            : nameplateSelection;
    if (!present) return;
    setError(null);
    setAvatarDisplay(
      removeCollectibleFromAvatarDisplay(currentAvatarDisplay, kind),
    );
    setAvatarDisplayChanged(true);
  };

  const handleRemoveNameplate = () => {
    if (
      !chatUser.nameplate_url &&
      !nameplateSelection &&
      !nameplateFile &&
      !nameplatePreview
    ) {
      return;
    }
    setError(null);
    setRemoveNameplate(true);
    setNameplateFile(null);
    setNameplatePreview(null);
    if (nameplateSelection) {
      setAvatarDisplay(
        removeCollectibleFromAvatarDisplay(currentAvatarDisplay, "nameplate"),
      );
      setAvatarDisplayChanged(true);
    }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    let action = "save your profile";

    try {
      await apiPatch("/api/update-profile", {
        pronouns: trimmedPronouns || null,
        bio: trimmedBio || null,
        profileAccentColor: accentColor,
        profileBackgroundColor: backgroundColor,
        profileBannerColor: bannerColor,
        displayNameStyle,
        ...(removeAvatar ? { removeAvatar: true } : {}),
        ...(!removeAvatar && !avatarFile && selectedAvatarUrl
          ? { avatarUrl: selectedAvatarUrl }
          : {}),
        ...(removeAvatar && currentAvatarDisplay
          ? { avatarDisplay: currentAvatarDisplay }
          : avatarDisplayChanged && !avatarFile
            ? { avatarDisplay }
            : {}),
      });

      if (trimmedStatus !== savedCustomStatus) {
        updateStatus(chatUser.status ?? "online", trimmedStatus || null);
      }

      if (removeAvatar) {
        setAvatarFile(null);
        setAvatarPreview(null);
        setSelectedAvatarUrl(null);
        setRemoveAvatar(false);
        setAvatarDisplay(currentAvatarDisplay);
        setAvatarDisplayChanged(false);
      } else if (avatarFile) {
        action = "upload your avatar";
        const formData = new FormData();
        formData.append("file", avatarFile);
        const serialized = serializeAvatarDisplay(avatarDisplay);
        if (serialized) formData.append("avatar_display", serialized);
        const uploaded = await apiUpload<{
          url: string;
          avatar_display: AvatarDisplay | null;
        }>("/api/avatar-upload", formData);
        setAvatarFile(null);
        setAvatarPreview(null);
        setSelectedAvatarUrl(null);
        setAvatarDisplay(uploaded.avatar_display);
        setAvatarDisplayChanged(false);
      } else if (selectedAvatarUrl || avatarDisplayChanged) {
        setAvatarDisplayChanged(false);
      }

      if (bannerFile) {
        action = "upload your banner";
        const formData = new FormData();
        formData.append("kind", "banner");
        formData.append("file", bannerFile);
        await apiUpload("/api/profile-assets/manage", formData);
        setBannerFile(null);
        setBannerPreview(null);
        setRemoveBanner(false);
      } else if (removeBanner && chatUser.banner_url) {
        action = "remove your banner";
        await apiDelete<{ ok: true }, { kind: "banner" }>(
          "/api/profile-assets/manage",
          { kind: "banner" },
        );
        setRemoveBanner(false);
      }

      if (nameplateFile) {
        action = "upload your nameplate";
        const formData = new FormData();
        formData.append("kind", "nameplate");
        formData.append("file", nameplateFile);
        await apiUpload("/api/profile-assets/manage", formData);
        setNameplateFile(null);
        setNameplatePreview(null);
        setRemoveNameplate(false);
      } else if (removeNameplate) {
        action = "remove your nameplate";
        const savedUrl = chatUser.nameplate_url ?? null;
        if (savedUrl && isManagedNameplateUrl(savedUrl)) {
          await apiDelete<{ ok: true }, { kind: "nameplate" }>(
            "/api/profile-assets/manage",
            { kind: "nameplate" },
          );
        }
        if (
          !savedUrl ||
          !isManagedNameplateUrl(savedUrl) ||
          nameplateSelection
        ) {
          const data = await apiPatch<{ ok: true; user: CollectibleApplyUser }>(
            "/api/collectibles/apply",
            {
              kind: "nameplate",
              skuId: null,
              avatarDisplay: currentAvatarDisplay ?? null,
            },
          );
          setAvatarDisplay(data.user.avatar_display);
        }
        setRemoveNameplate(false);
      }

      action = "refresh your profile";
      if (typeof user?.reload === "function") await user.reload();
      await loadCurrentUser();
      if (selectedAvatarUrl) {
        setAvatarPreview(null);
        setSelectedAvatarUrl(null);
      }
      setSaved(true);
    } catch (err) {
      log.error("Failed to save:", err);
      setError(describeApiError(err, action));
    } finally {
      setSaving(false);
    }
  }, [
    accentColor,
    avatarDisplay,
    avatarDisplayChanged,
    avatarFile,
    backgroundColor,
    bannerColor,
    bannerFile,
    chatUser.banner_url,
    chatUser.nameplate_url,
    chatUser.status,
    currentAvatarDisplay,
    displayNameStyle,
    loadCurrentUser,
    nameplateFile,
    nameplateSelection,
    removeAvatar,
    removeBanner,
    removeNameplate,
    savedCustomStatus,
    selectedAvatarUrl,
    trimmedBio,
    trimmedPronouns,
    trimmedStatus,
    updateStatus,
    user,
  ]);

  const showFooter = hasChanges || Boolean(error) || saved;
  const avatarWithoutDecoration = withoutDecoration(currentAvatarDisplay);

  /* Render ---------------------------------------------------------- */
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorHeader onClose={onClose} />

      <input
        ref={nameplateInputRef}
        type="file"
        accept="image/*,video/mp4,video/webm,video/ogg"
        onChange={handleNameplateSelect}
        className="hidden"
        aria-label="Upload a nameplate"
      />

      <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto grid w-full max-w-[1040px] gap-6 px-4 py-4 md:px-6 md:py-6 @min-[840px]:grid-cols-[340px_minmax(0,1fr)] @min-[840px]:items-start @min-[840px]:gap-8">
          {/* Live preview ------------------------------------------- */}
          <section
            aria-label="Profile preview"
            className="mx-auto flex w-full max-w-[340px] flex-col gap-4 @min-[840px]:sticky @min-[840px]:top-0"
            style={previewTheme.variables}
          >
            <ProfileSurfaceShell
              display={currentAvatarDisplay}
              className="w-full"
              surfaceStyle={{
                backgroundImage: "var(--rm-profile-custom-surface)",
              }}
            >
              <div
                className="relative h-28"
                style={{
                  background: "var(--rm-profile-custom-banner-fallback)",
                }}
              >
                <ProfileAssetLayer
                  url={currentBannerUrl}
                  contentType={currentBannerContentType}
                  alt=""
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background: "var(--rm-profile-custom-banner-overlay)",
                  }}
                />
              </div>
              <div className="relative flex flex-col gap-4 px-5 pb-6">
                <div className="flex items-end justify-between gap-3">
                  <span className="relative -mt-12 block size-24 shrink-0 rounded-full border-4 border-[color:var(--rm-profile-custom-background)] bg-[var(--rm-profile-custom-card-bg-strong)]">
                    {currentAvatarSrc ? (
                      <AvatarImage
                        src={currentAvatarSrc}
                        alt=""
                        display={currentAvatarDisplay}
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center text-ui-2xl font-semibold text-[color:var(--rm-profile-custom-text)]">
                        {getDisplayInitial({ name: displayName })}
                      </span>
                    )}
                  </span>
                  {trimmedStatus ? (
                    <span
                      className="min-w-0 truncate rounded-full border border-[color:var(--rm-profile-custom-card-border)] px-3 py-1.5 text-ui-sm text-[color:var(--rm-profile-custom-text)]"
                      style={PROFILE_BANNER_CHIP_STYLE}
                    >
                      {trimmedStatus}
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <ProfileDisplayName
                    text={displayName}
                    displayNameStyle={displayNameStyle}
                    className="block truncate text-ui-xl font-semibold text-[color:var(--rm-profile-custom-text)]"
                    backgroundColor={previewTheme.backgroundColor}
                    readableFallbackColor={previewTheme.textColor}
                  />
                  <p className="mt-1 truncate text-ui-sm text-[color:var(--rm-profile-custom-muted)]">
                    @{username}
                    {trimmedPronouns ? ` · ${trimmedPronouns}` : ""}
                  </p>
                </div>
                {trimmedBio ? (
                  <div className="rounded-lg border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-4 py-3">
                    <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-[color:var(--rm-profile-custom-muted)]">
                      About me
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-ui-sm text-[color:var(--rm-profile-custom-text)]">
                      {trimmedBio}
                    </p>
                  </div>
                ) : null}
                <div>
                  <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-[color:var(--rm-profile-custom-muted)]">
                    {referenceDate.label}
                  </p>
                  <p className="mt-1 text-ui-sm text-[color:var(--rm-profile-custom-text)]">
                    {referenceDate.value}
                  </p>
                </div>
              </div>
            </ProfileSurfaceShell>

            {nameplateShownUrl ? (
              <div className="relative flex min-h-12 items-center gap-3 overflow-hidden rounded-lg border border-rm-border bg-rm-bg-surface px-3 py-2">
                <UserNameplateLayer
                  nameplateUrl={nameplateShownUrl}
                  nameplateContentType={
                    currentNameplateUrl ? currentNameplateContentType : null
                  }
                  avatarDisplay={currentAvatarDisplay}
                  seedId={username}
                  alt=""
                  className="pointer-events-none absolute inset-0"
                />
                <span className="relative block size-8 shrink-0 overflow-hidden rounded-full bg-rm-tint-2">
                  {currentAvatarSrc ? (
                    <AvatarImage
                      src={currentAvatarSrc}
                      alt=""
                      display={avatarWithoutDecoration}
                    />
                  ) : null}
                </span>
                <ProfileDisplayName
                  text={displayName}
                  displayNameStyle={displayNameStyle}
                  className="relative block min-w-0 truncate text-ui-base font-medium text-rm-text"
                  minContrastRatio={2.8}
                />
              </div>
            ) : null}
          </section>

          {/* Form --------------------------------------------------- */}
          <div className="@container flex min-w-0 flex-col gap-4">
            <SettingsCard title="Avatar and banner">
              <SettingsRow
                id="profile-avatar"
                label="Avatar"
                description={avatarStatus}
                leading={
                  <Thumb round>
                    {currentAvatarSrc ? (
                      <AvatarImage
                        src={currentAvatarSrc}
                        alt=""
                        display={avatarWithoutDecoration}
                      />
                    ) : (
                      <span className="text-ui-base font-semibold text-rm-text">
                        {getDisplayInitial({ name: displayName })}
                      </span>
                    )}
                  </Thumb>
                }
              >
                {() => (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label="Change avatar"
                      onClick={() => setAvatarPickerOpen(true)}
                    >
                      Change
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label="Crop avatar"
                      disabled={!currentAvatarSrc}
                      onClick={() =>
                        currentAvatarSrc &&
                        setAvatarEditor({ src: currentAvatarSrc })
                      }
                    >
                      Crop
                    </Button>
                    {hasRemovableAvatar ? (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label="Remove avatar"
                        onClick={handleRemoveAvatar}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </>
                )}
              </SettingsRow>
              <SettingsRow
                id="profile-banner"
                label="Banner"
                description={bannerStatus}
                leading={
                  <Thumb
                    wide
                    style={{
                      ...previewTheme.variables,
                      background: "var(--rm-profile-custom-banner-fallback)",
                    }}
                  >
                    <ProfileAssetLayer
                      url={currentBannerUrl}
                      contentType={currentBannerContentType}
                      alt=""
                      playVideo={false}
                    />
                  </Thumb>
                }
              >
                {() => (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label="Change banner"
                      onClick={() => setBannerPickerOpen(true)}
                    >
                      Change
                    </Button>
                    {currentBannerUrl || bannerFile ? (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label="Remove banner"
                        onClick={handleRemoveBanner}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </>
                )}
              </SettingsRow>
              <SettingsRow
                id="profile-banner-color"
                label="Banner color"
                description="Shows when you have no banner image."
                layout="block"
              >
                {(ids) => (
                  <ColorControl
                    ids={ids}
                    name="banner color"
                    value={bannerColor}
                    fallback={DEFAULT_PROFILE_THEME.accent}
                    presets={PROFILE_COLOR_SWATCHES}
                    onChange={setBannerColor}
                    allowAuto
                  />
                )}
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title="Profile theme"
              description="Colors for your profile card. Leave them on Auto to follow your app theme."
            >
              <SettingsRow
                id="profile-background"
                label="Background"
                layout="block"
              >
                {(ids) => (
                  <ColorControl
                    ids={ids}
                    name="background color"
                    value={backgroundColor}
                    fallback={DEFAULT_PROFILE_THEME.background}
                    presets={PROFILE_COLOR_SWATCHES}
                    onChange={setBackgroundColor}
                    allowAuto
                  />
                )}
              </SettingsRow>
              <SettingsRow
                id="profile-accent"
                label="Accent"
                description="Mixed into the background and used for highlights."
                layout="block"
              >
                {(ids) => (
                  <ColorControl
                    ids={ids}
                    name="accent color"
                    value={accentColor}
                    fallback={DEFAULT_PROFILE_THEME.accent}
                    presets={PROFILE_COLOR_SWATCHES}
                    onChange={setAccentColor}
                    allowAuto
                  />
                )}
              </SettingsRow>
            </SettingsCard>

            <SettingsCard title="About you">
              <SettingsRow
                id="profile-name-style"
                label="Display name style"
                description={
                  <ProfileDisplayName
                    text={displayName}
                    displayNameStyle={displayNameStyle}
                    className="block truncate text-ui-md font-semibold"
                  />
                }
              >
                {() => (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label={
                        displayNameStyle
                          ? "Edit display name style"
                          : "Add display name style"
                      }
                      onClick={() => setStyleDialogOpen(true)}
                    >
                      {displayNameStyle ? "Edit" : "Add"}
                    </Button>
                    {displayNameStyle ? (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label="Clear display name style"
                        onClick={() => setDisplayNameStyle(null)}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </>
                )}
              </SettingsRow>
              <SettingsRow
                id="profile-custom-status"
                label="Custom status"
                description="Shown beside your avatar."
                layout="block"
              >
                {(ids) => (
                  <CountedField
                    ids={ids}
                    value={customStatus}
                    max={CUSTOM_STATUS_MAX}
                    placeholder="Shipping the release"
                    onChange={setCustomStatus}
                  />
                )}
              </SettingsRow>
              <SettingsRow
                id="profile-pronouns"
                label="Pronouns"
                layout="block"
              >
                {(ids) => (
                  <CountedField
                    ids={ids}
                    value={pronouns}
                    max={PRONOUNS_MAX}
                    placeholder="they/them"
                    onChange={setPronouns}
                  />
                )}
              </SettingsRow>
              <SettingsRow id="profile-bio" label="About me" layout="block">
                {(ids) => (
                  <CountedField
                    ids={ids}
                    value={bio}
                    max={BIO_MAX}
                    placeholder="Night owl, synth collector, always up for co-op."
                    multiline
                    onChange={setBio}
                  />
                )}
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title="Collectibles"
              description="Decorations from your collection."
            >
              <SettingsRow
                id="profile-decoration"
                label="Avatar decoration"
                description={decoration?.name ?? "None"}
                leading={
                  <Thumb>
                    {decoration ? (
                      <img
                        src={decoration.imageUrl}
                        alt=""
                        className="size-9 object-contain"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <Icon name="sparkle" size="md" />
                    )}
                  </Thumb>
                }
              >
                {() => (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label="Change avatar decoration"
                      onClick={() => setCollectiblesKind("avatar_decoration")}
                    >
                      Change
                    </Button>
                    {decoration ? (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label="Remove avatar decoration"
                        onClick={() =>
                          handleRemoveCollectible("avatar_decoration")
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </>
                )}
              </SettingsRow>
              <SettingsRow
                id="profile-effect"
                label="Profile effect"
                description={profileEffect?.name ?? "None"}
              >
                {() => (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label="Change profile effect"
                      onClick={() => setCollectiblesKind("profile_effect")}
                    >
                      Change
                    </Button>
                    {profileEffect ? (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label="Remove profile effect"
                        onClick={() =>
                          handleRemoveCollectible("profile_effect")
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </>
                )}
              </SettingsRow>
              <SettingsRow
                id="profile-frame"
                label="Profile frame"
                description={profileFrame?.name ?? "None"}
              >
                {() => (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label="Change profile frame"
                      onClick={() => setCollectiblesKind("profile_frame")}
                    >
                      Change
                    </Button>
                    {profileFrame ? (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label="Remove profile frame"
                        onClick={() => handleRemoveCollectible("profile_frame")}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </>
                )}
              </SettingsRow>
              <SettingsRow
                id="profile-nameplate"
                label="Nameplate"
                description={nameplateStatus}
              >
                {() => (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label="Change nameplate"
                      onClick={() => setCollectiblesKind("nameplate")}
                    >
                      Change
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label="Upload a nameplate"
                      onClick={() => nameplateInputRef.current?.click()}
                    >
                      Upload
                    </Button>
                    {currentNameplateUrl ||
                    nameplateSelection ||
                    nameplateFile ? (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label="Remove nameplate"
                        onClick={handleRemoveNameplate}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </>
                )}
              </SettingsRow>
            </SettingsCard>
          </div>
        </div>
      </div>

      {showFooter ? (
        <footer className="shrink-0 border-t border-rm-border bg-rm-bg-primary px-4 pt-3 pb-[max(12px,var(--safe-area-bottom,0px))] md:px-6">
          {error ? <RowError className="mb-3 mt-0">{error}</RowError> : null}
          <div className="flex items-center gap-2">
            <p
              role="status"
              className="flex min-w-0 flex-1 items-center gap-2 truncate text-ui-sm font-medium text-rm-text"
            >
              {hasChanges ? (
                "Unsaved changes"
              ) : saved ? (
                <>
                  <Icon
                    name="check"
                    size="sm"
                    className="shrink-0 text-rm-success-ink"
                  />
                  Changes saved
                </>
              ) : null}
            </p>
            {hasChanges ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetDraft}
                  disabled={saving}
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSave()}
                  loading={saving}
                >
                  Save changes
                </Button>
              </>
            ) : null}
          </div>
        </footer>
      ) : null}

      {avatarPickerOpen ? (
        <AvatarPickerModal
          open={avatarPickerOpen}
          displayName={displayName}
          currentAvatarUrl={
            removeAvatar ? null : (selectedAvatarUrl ?? chatUser.avatar_url)
          }
          onClose={() => setAvatarPickerOpen(false)}
          onUpload={handleAvatarFile}
          onSelectRecent={handleRecentAvatarSelect}
        />
      ) : null}
      {bannerPickerOpen ? (
        <AvatarPickerModal
          open={bannerPickerOpen}
          displayName={displayName}
          onClose={() => setBannerPickerOpen(false)}
          onUpload={handleBannerFile}
          showRecent={false}
          title="Select a Banner"
          description="Choose a new banner image or GIF for your profile."
          closeLabel="Close banner picker"
        />
      ) : null}
      {avatarEditor ? (
        <AvatarFrameEditor
          image={avatarEditor}
          initialDisplay={currentAvatarDisplay}
          displayName={displayName}
          onCancel={handleAvatarFrameCancel}
          onConfirm={handleAvatarFrameConfirm}
        />
      ) : null}
      {styleDialogOpen ? (
        <DisplayNameStyleDialog
          open
          displayName={displayName}
          username={username}
          initialStyle={displayNameStyle}
          themeStyle={previewTheme.variables}
          themeBackgroundColor={previewTheme.backgroundColor}
          themeTextColor={previewTheme.textColor}
          avatarSrc={currentAvatarSrc}
          avatarDisplay={currentAvatarDisplay}
          onClose={() => setStyleDialogOpen(false)}
          onApply={setDisplayNameStyle}
        />
      ) : null}
      {collectiblesKind ? (
        <CollectiblePicker
          open
          kind={collectiblesKind}
          currentDisplay={currentAvatarDisplay}
          avatarSrc={currentAvatarSrc}
          displayName={displayName}
          username={`@${username}`}
          onClose={() => setCollectiblesKind(null)}
          onApplied={async (updatedUser, appliedKinds) => {
            await syncCollectibleState(updatedUser, appliedKinds);
          }}
        />
      ) : null}
    </div>
  );
}
