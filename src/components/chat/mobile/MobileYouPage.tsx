import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { openSettings } from "@/components/chat/settings/settings-links";
import type { SettingsPanelId } from "@/components/chat/settings/schema";
import {
  normalizeUserStatus,
  UserStatusDot,
  type UserStatus,
} from "@/components/chat/UserStatusDot";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { DISABLED, PRESS } from "@/components/ui/interaction";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { dispatchOpenProfileEditorEvent } from "@/lib/profile-editor-events";
import { resolveProfileTheme } from "@/lib/profile-customization";
import { useDeviceAvailability } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useId } from "react";
import { useShallow } from "zustand/shallow";

const STATUS_OPTIONS: ReadonlyArray<{
  value: UserStatus;
  label: string;
  hint?: string;
}> = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  {
    value: "dnd",
    label: "Do not disturb",
    hint: "You won't get notification alerts",
  },
  {
    value: "offline",
    label: "Invisible",
    hint: "You'll appear offline but keep full access",
  },
];

const SHORTCUTS: ReadonlyArray<{
  panel: SettingsPanelId;
  label: string;
  icon: IconName;
}> = [
  { panel: "voice", label: "Voice & video", icon: "mic" },
  { panel: "notifications", label: "Notifications", icon: "bell" },
  { panel: "appearance", label: "Appearance", icon: "appearance" },
  { panel: "privacy", label: "Privacy & safety", icon: "privacy" },
];

const ROW =
  "flex min-h-12 w-full items-center gap-3 px-4 text-start text-ui-base text-rm-text outline-offset-[-2px]";
/** Tinted list group; rows are split by hairlines, not borders per row. */
const GROUP =
  "mx-4 overflow-hidden rounded-lg bg-rm-tint-1 divide-y divide-rm-border";
/** Fixed leading slot, so status dots and icons share one label edge. */
const LEADING = "flex size-5 shrink-0 items-center justify-center";
const TILE =
  "flex min-h-14 items-center gap-3 rounded-lg px-4 text-start text-ui-base font-medium";

/** Mic and deafen for yourself, routed through the call when one is live. */
function useSelfVoiceToggles(userId: string | undefined) {
  const settings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(userId)),
  );
  const setIsMuted = useVoiceSettingsStore((s) => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore((s) => s.setIsDeafened);
  const callActive = useCallStore((s) => s.status) === "active";
  const { hasMicrophone } = useDeviceAvailability();

  return {
    muted: settings.isMuted || !hasMicrophone,
    deafened: settings.isDeafened,
    hasMicrophone,
    toggleMute: () => {
      if (!hasMicrophone) return;
      const callToggle = useCallVoiceStore.getState().toggleMic;
      if (callActive && callToggle) callToggle();
      else setIsMuted(!settings.isMuted);
    },
    toggleDeafen: () => {
      const callToggle = useCallVoiceStore.getState().toggleDeafen;
      if (callActive && callToggle) callToggle();
      else setIsDeafened(!settings.isDeafened);
    },
  };
}

/**
 * The phone "You" tab: who you are, how you show up, your own mic, and the way
 * into settings. Settings opens the shared dialog in its narrow push mode.
 */
export function MobileYouPage({ onNavigate }: { onNavigate: () => void }) {
  const user = useChatStore((s) => s.user);
  const { updateStatus, dispatch } = useChatActions();
  const voice = useSelfVoiceToggles(user?.id);
  const titleId = useId();
  const statusId = useId();
  const voiceId = useId();
  const moreId = useId();

  if (!user) return null;

  const displayName = getDisplayName(user);
  const theme = resolveProfileTheme(user);
  const status = normalizeUserStatus(user.status ?? "online");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain bg-rm-bg-primary pb-6">
      <section aria-labelledby={titleId} style={theme.variables}>
        <div
          className="relative h-28 overflow-hidden"
          style={{ background: "var(--rm-profile-custom-banner-fallback)" }}
        >
          <ProfileAssetLayer
            url={user.banner_url}
            contentType={user.banner_content_type}
            alt=""
          />
          <div
            className="absolute inset-0"
            style={{ background: "var(--rm-profile-custom-banner-overlay)" }}
          />
        </div>
        <div className="px-4">
          <div className="relative -mt-10 inline-block">
            <div className="relative flex size-20 items-center justify-center overflow-visible rounded-full bg-rm-bg-elevated text-ui-2xl font-semibold text-rm-text ring-4 ring-rm-bg-primary">
              {user.avatar_url ? (
                <AvatarImage
                  src={getAuthAssetUrl(user.avatar_url)}
                  alt=""
                  display={user.avatar_display}
                />
              ) : (
                getDisplayInitial(user)
              )}
            </div>
            <span className="absolute right-0 bottom-0 rounded-full bg-rm-bg-primary p-1">
              <UserStatusDot
                status={status}
                cutoutClassName="bg-rm-bg-primary"
                className="size-4"
              />
            </span>
          </div>
          <h1 id={titleId} className="mt-2 text-ui-xl font-semibold">
            <ProfileDisplayName
              text={displayName}
              displayNameStyle={user.display_name_style}
              className="text-rm-text"
              backgroundColor={theme.backgroundColor}
              readableFallbackColor={theme.textColor}
            />
          </h1>
          <p className="text-ui-sm text-rm-text-secondary">@{user.username}</p>
          {user.custom_status ? (
            <p className="mt-1 text-ui-sm text-rm-text-secondary">
              {user.custom_status}
            </p>
          ) : null}
          <div className="mt-4 flex gap-3">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="min-w-0 flex-1"
              onClick={(event) =>
                dispatchOpenProfileEditorEvent(event.currentTarget)
              }
            >
              <Icon name="edit" size="md" />
              Edit profile
            </Button>
            <Button
              type="button"
              size="lg"
              className="min-w-0 flex-1"
              onClick={() => openSettings()}
            >
              <Icon name="settings" size="md" />
              Settings
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby={statusId} className="mt-6">
        <h2
          id={statusId}
          className="px-4 pb-2 text-ui-xs font-semibold text-rm-text-secondary"
        >
          Status
        </h2>
        <div role="radiogroup" aria-labelledby={statusId} className={GROUP}>
          {STATUS_OPTIONS.map((option) => {
            const checked = option.value === status;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => updateStatus(option.value)}
                className={cn(
                  ROW,
                  "py-2.5",
                  PRESS,
                  // Full-width rows in a group don't shrink on press.
                  "enabled:active:scale-100",
                  checked && "bg-rm-tint-2",
                )}
              >
                <span className={LEADING}>
                  <UserStatusDot
                    status={option.value}
                    cutoutClassName="bg-rm-bg-primary"
                    className="size-3"
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={checked ? "font-semibold" : "font-medium"}>
                    {option.label}
                  </span>
                  {option.hint ? (
                    <span className="text-ui-xs text-rm-text-secondary">
                      {option.hint}
                    </span>
                  ) : null}
                </span>
                {checked ? (
                  <Icon
                    name="check"
                    size="md"
                    className="shrink-0 text-rm-accent-ink"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby={voiceId} className="mt-6 px-4">
        <h2
          id={voiceId}
          className="pb-2 text-ui-xs font-semibold text-rm-text-secondary"
        >
          Voice
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            aria-pressed={voice.muted}
            disabled={!voice.hasMicrophone}
            onClick={voice.toggleMute}
            className={cn(
              TILE,
              PRESS,
              DISABLED,
              voice.muted
                ? "bg-rm-danger-tint text-rm-danger-ink"
                : "bg-rm-tint-1 text-rm-text",
            )}
          >
            <Icon
              name="mic"
              state={voice.muted ? "off" : "idle"}
              size="xl"
              className="shrink-0"
            />
            <span className="min-w-0 truncate">
              {!voice.hasMicrophone
                ? "No mic"
                : voice.muted
                  ? "Muted"
                  : "Mic on"}
            </span>
          </button>
          <button
            type="button"
            aria-pressed={voice.deafened}
            onClick={voice.toggleDeafen}
            className={cn(
              TILE,
              PRESS,
              voice.deafened
                ? "bg-rm-danger-tint text-rm-danger-ink"
                : "bg-rm-tint-1 text-rm-text",
            )}
          >
            <Icon
              name="deafen"
              state={voice.deafened ? "off" : "idle"}
              size="xl"
              className="shrink-0"
            />
            <span className="min-w-0 truncate">
              {voice.deafened ? "Deafened" : "Sound on"}
            </span>
          </button>
        </div>
      </section>

      <section aria-labelledby={moreId} className="mt-6">
        <h2
          id={moreId}
          className="px-4 pb-2 text-ui-xs font-semibold text-rm-text-secondary"
        >
          Shortcuts
        </h2>
        <ul className={GROUP}>
          <li>
            <button
              type="button"
              className={cn(ROW, PRESS)}
              onClick={() => {
                dispatch({ type: "SET_DM_HOME_VIEW", view: "friends" });
                dispatch({ type: "SET_ACTIVE_SERVER", serverId: "@me" });
                dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: null });
                onNavigate();
              }}
            >
              <span className={LEADING}>
                <Icon
                  name="members"
                  size="md"
                  className="text-rm-text-secondary"
                />
              </span>
              <span className="flex-1">Friends</span>
              <Icon
                name="chevronRight"
                size="xs"
                className="text-rm-text-muted"
              />
            </button>
          </li>
          {SHORTCUTS.map((item) => (
            <li key={item.panel}>
              <button
                type="button"
                className={cn(ROW, PRESS)}
                onClick={() => openSettings({ panel: item.panel })}
              >
                <span className={LEADING}>
                  <Icon
                    name={item.icon}
                    size="md"
                    className="text-rm-text-secondary"
                  />
                </span>
                <span className="flex-1">{item.label}</span>
                <Icon
                  name="chevronRight"
                  size="xs"
                  className="text-rm-text-muted"
                />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
