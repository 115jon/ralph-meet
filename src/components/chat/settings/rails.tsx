/**
 * Live preview rails: the four pages where you judge a feel rather than flip
 * a fact. On wide dialogs they sit beside the cards; on narrow ones the page
 * renders them as the first card.
 */

import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import { UserStatusDot } from "@/components/chat/UserStatusDot";
import { Icon } from "@/components/ui/icon";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { resolveProfileTheme } from "@/lib/profile-customization";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import type { ReactNode } from "react";
import { MicTestWidget } from "../MicTestWidget";
import { THEME_CHOICES, useVisibleTheme } from "./AppearancePanel";
import { describeCameraQuality } from "./CameraCard";
import { useSoundSettingsForSettings } from "./NotificationsPanel";
import { useSettings } from "./primitives";
import { getRowLocation, type SettingsPanelId } from "./schema";
import {
  useDeviceOptions,
  useVoiceSettingsForSettings,
} from "./VoiceVideoPanel";

function RailFrame({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h4 className="text-ui-sm font-semibold text-rm-text">{title}</h4>
      {children}
      {note ? (
        <p className="text-pretty text-ui-xs text-rm-text-secondary">{note}</p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Account: the profile card others open                               */
/* ------------------------------------------------------------------ */

function ProfileRail() {
  const user = useChatStore((s) => s.user);
  if (!user) return null;
  const displayName = getDisplayName({
    display_name: user.display_name ?? null,
    username: user.username,
  });
  const theme = resolveProfileTheme(user);
  const status = user.status ?? "online";
  return (
    <RailFrame
      title="How others see you"
      note="Your profile card, as it looks when someone opens it."
    >
      <ProfileSurfaceShell
        variant="card"
        display={user.avatar_display}
        playAnimation={false}
        style={theme.variables}
        aria-label={`Profile preview for ${displayName}`}
        role="img"
      >
        <div
          className="relative h-[88px] overflow-hidden rounded-t-[inherit]"
          style={{ background: "var(--rm-profile-custom-banner-fallback)" }}
        >
          <ProfileAssetLayer
            url={user.banner_url}
            contentType={user.banner_content_type}
            alt=""
            className="opacity-95"
          />
          <div
            className="absolute inset-0"
            style={{ background: "var(--rm-profile-custom-banner-overlay)" }}
          />
        </div>
        <div className="relative z-30 -mt-10 px-4">
          <div className="relative inline-block rounded-full bg-[var(--rm-profile-custom-card-bg-strong)] p-1">
            <div className="relative flex size-[68px] items-center justify-center rounded-full bg-[var(--rm-profile-custom-button-bg)] text-ui-xl font-semibold text-[color:var(--rm-profile-custom-button-text)]">
              {user.avatar_url ? (
                <AvatarImage
                  src={getAuthAssetUrl(user.avatar_url)}
                  alt=""
                  display={user.avatar_display}
                />
              ) : (
                getDisplayInitial({ name: displayName })
              )}
            </div>
            <div className="absolute bottom-0.5 right-0.5 z-20 rounded-full bg-[var(--rm-profile-custom-card-bg-strong)] p-[3px]">
              <UserStatusDot status={status} className="size-4" />
            </div>
          </div>
        </div>
        <div className="relative z-20 px-4 pb-4 pt-2">
          <ProfileDisplayName
            text={displayName}
            displayNameStyle={user.display_name_style}
            className="text-ui-lg font-semibold leading-tight text-[color:var(--rm-profile-custom-text)]"
            backgroundColor={theme.backgroundColor}
            readableFallbackColor={theme.textColor}
          />
          <p className="mt-0.5 text-ui-sm text-[color:var(--rm-profile-custom-muted)]">
            @{user.username}
            {user.pronouns?.trim() ? ` · ${user.pronouns.trim()}` : ""}
          </p>
          {user.custom_status?.trim() ? (
            <p className="mt-2 text-ui-sm italic text-[color:var(--rm-profile-custom-muted)]">
              {user.custom_status.trim()}
            </p>
          ) : null}
          {user.bio?.trim() ? (
            <p className="mt-3 rounded-lg border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-2 text-ui-sm text-[color:var(--rm-profile-custom-text)]">
              {user.bio.trim()}
            </p>
          ) : null}
        </div>
      </ProfileSurfaceShell>
    </RailFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Voice & video: mic test and what others receive                      */
/* ------------------------------------------------------------------ */

function VoiceRail() {
  const { target } = useSettings();
  const { vSettings, audioProcessing } = useVoiceSettingsForSettings();
  const devices = useDeviceOptions();
  const mic =
    devices.input.find((option) => option.value === vSettings.inputDeviceId)
      ?.label ?? "Default microphone";
  const noise = audioProcessing.noiseReductionEnabled
    ? "RNNoise"
    : vSettings.noiseSuppression
      ? "Browser"
      : "Off";
  const profile =
    vSettings.inputProfile === "standard"
      ? "Voice isolation"
      : vSettings.inputProfile === "studio"
        ? "Studio"
        : "Custom";
  const background =
    vSettings.cameraBackground.type === "blur"
      ? "Blur"
      : vSettings.cameraBackground.type === "image"
        ? "Image"
        : "None";
  const items: Array<[string, string]> = [
    ["Microphone", mic.replace(/^Default - /, "")],
    ["Input profile", profile],
    [
      "Sends",
      vSettings.autoSensitivity
        ? "When you talk (automatic)"
        : `Above ${vSettings.sensitivity} dB`,
    ],
    ["Noise suppression", noise],
    ["Echo cancellation", vSettings.echoCancellation ? "On" : "Off"],
    ["Audio", vSettings.streamHighFidelity ? "High fidelity" : "Standard"],
    ["Camera", describeCameraQuality(vSettings.cameraQuality)],
    ["Background", background],
  ];
  const micTest = getRowLocation("mic-test")?.row;
  return (
    <RailFrame title="What others get">
      <div
        data-row="mic-test"
        data-target={target === "mic-test" || undefined}
        tabIndex={target === "mic-test" ? -1 : undefined}
        className="rm-settings-target flex flex-col gap-2 rounded-lg border border-rm-border bg-rm-bg-surface p-3 outline-none"
      >
        <p className="text-ui-xs text-rm-text-secondary">{micTest?.desc}</p>
        <MicTestWidget
          sensitivity={vSettings.sensitivity}
          autoSensitivity={vSettings.autoSensitivity}
          inputDeviceId={vSettings.inputDeviceId}
          outputDeviceId={vSettings.outputDeviceId}
          processing={audioProcessing}
        />
      </div>
      <dl className="divide-y divide-rm-border rounded-lg border border-rm-border bg-rm-bg-surface">
        {items.map(([key, value]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <dt className="shrink-0 text-ui-xs text-rm-text-secondary">
              {key}
            </dt>
            <dd className="min-w-0 truncate text-right text-ui-xs font-medium text-rm-text">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </RailFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Appearance: a slice of chat in the current theme                     */
/* ------------------------------------------------------------------ */

const SAMPLE_CHAT = [
  {
    who: "Ada",
    color: "var(--chart-3)",
    text: "Is the voice room still open? I'm joining in five.",
  },
  {
    who: "You",
    color: "var(--rm-accent-ink)",
    text: "Come through. Noise suppression is on, the fan's back.",
  },
  {
    who: "Grace",
    color: "var(--chart-2)",
    text: "Sharing my screen in a sec.",
  },
];

function AppearanceRail() {
  const visibleTheme = useVisibleTheme();
  const name =
    THEME_CHOICES.find((choice) => choice.id === visibleTheme)?.label ??
    "Midnight";
  return (
    <RailFrame title="Preview" note={`${name}. Changes apply as you pick.`}>
      <div
        role="img"
        aria-label={`Sample chat in the ${name} theme`}
        className="flex flex-col gap-3 rounded-lg border border-rm-border bg-rm-bg-primary px-4 py-3"
      >
        {SAMPLE_CHAT.map((message) => (
          <div key={message.who} className="flex gap-3">
            <span
              aria-hidden
              className="mt-0.5 size-8 shrink-0 rounded-full opacity-85"
              style={{ background: message.color }}
            />
            <div className="min-w-0">
              <p
                className="text-ui-sm font-semibold"
                style={{ color: message.color }}
              >
                {message.who}
              </p>
              <p className="text-ui-sm text-rm-text">{message.text}</p>
            </div>
          </div>
        ))}
        <div className="flex h-9 items-center rounded-md border border-rm-border bg-rm-bg-surface px-3 text-ui-sm text-rm-text-secondary">
          Message #general
        </div>
      </div>
    </RailFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications: the next alert                                        */
/* ------------------------------------------------------------------ */

function NotificationsRail() {
  const { env } = useSettings();
  const { soundSettings } = useSoundSettingsForSettings();
  const desktopNotifications = useDesktopSettingsStore(
    (s) => s.desktopNotifications,
  );
  const soundOn = soundSettings.soundsEnabled && soundSettings.notifications;
  const alertsOff = env.desktop && !desktopNotifications;
  return (
    <RailFrame
      title="Next mention"
      note={
        alertsOff
          ? "Desktop notifications are off. Mentions still show unread badges."
          : env.desktop
            ? "Shows as a native notification for mentions, replies and DMs."
            : "Mentions, replies and DMs show as unread badges in Ralph Meet."
      }
    >
      <div
        className={cn(
          "flex gap-3 rounded-lg border border-rm-border-strong bg-rm-bg-surface p-3 shadow-[var(--rm-shadow-2)] transition-opacity duration-200",
          alertsOff && "opacity-50",
        )}
      >
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Icon name="bell" size="sm" />
        </span>
        <div className="min-w-0">
          <p className="text-ui-xs text-rm-text-secondary">Ralph Meet · now</p>
          <p className="text-ui-sm font-semibold text-rm-text">
            Ada in #design
          </p>
          <p className="truncate text-ui-sm text-rm-text-secondary">
            @you is the voice room still open?
          </p>
        </div>
      </div>
      <p className="flex items-center gap-2 text-ui-xs text-rm-text-secondary">
        <Icon name={soundOn ? "voiceChannel" : "speakerOff"} size="sm" />
        {soundOn
          ? `Plays a chime at ${soundSettings.soundVolume}% volume.`
          : soundSettings.soundsEnabled
            ? "No chime: notification sounds are off."
            : "No chime: sound effects are off."}
      </p>
    </RailFrame>
  );
}

export function SettingsRail({ panel }: { panel: SettingsPanelId }) {
  if (panel === "account") return <ProfileRail />;
  if (panel === "voice") return <VoiceRail />;
  if (panel === "appearance") return <AppearanceRail />;
  if (panel === "notifications") return <NotificationsRail />;
  return null;
}
