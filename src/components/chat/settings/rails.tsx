/**
 * Live preview rails: the four pages where you judge a feel rather than flip
 * a fact. On wide dialogs they sit beside the cards; on narrow ones the page
 * renders them as the first card. Each is a C1 legend plate: a ply-2 plate
 * with its title printed across the top edge in silkscreen.
 */

import {
  ProfileCard,
  ProfileSections,
  resolveProfileCardTheme,
} from "@/components/chat/ProfileCard";
import { normalizeUserStatus } from "@/components/chat/UserStatusDot";
import { Icon } from "@/components/ui/icon";
import { LegendPlate } from "@/components/ui/plate";
import { getDisplayName } from "@/lib/display-name";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import type { CSSProperties, ReactNode } from "react";
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
    <LegendPlate legend={title} aria-label={title}>
      <div className="flex flex-col gap-3">
        {children}
        {note ? (
          <p className="text-pretty text-ui-xs text-ink-2">{note}</p>
        ) : null}
      </div>
    </LegendPlate>
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
  return (
    <RailFrame
      title="How others see you"
      note="Your profile card, as it looks when someone opens it."
    >
      {/* The popover card others open (avatar 72); decorations stay still
          in settings. */}
      <ProfileCard
        size="popover"
        user={user}
        theme={resolveProfileCardTheme(user)}
        name={displayName}
        status={normalizeUserStatus(user.status ?? "online")}
        playAnimation={false}
        role="img"
        aria-label={`Profile preview for ${displayName}`}
      >
        <ProfileSections bio={user.bio} />
      </ProfileCard>
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
        className="rm-settings-target flex flex-col gap-3 rounded-[2px] outline-none"
      >
        <p className="text-ui-sm text-ink-2">{micTest?.desc}</p>
        <MicTestWidget
          sensitivity={vSettings.sensitivity}
          autoSensitivity={vSettings.autoSensitivity}
          inputDeviceId={vSettings.inputDeviceId}
          outputDeviceId={vSettings.outputDeviceId}
          processing={audioProcessing}
        />
      </div>
      <dl className="divide-y divide-line border-t border-line">
        {items.map(([key, value]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 py-2"
          >
            <dt className="shrink-0 text-ui-xs text-ink-2">{key}</dt>
            <dd className="min-w-0 truncate text-right text-ui-xs font-medium text-ink-1">
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
    color: "var(--accent-ink)",
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
        className="flex flex-col gap-3 rounded-[2px] border border-line bg-ply-0 px-4 py-3"
      >
        {SAMPLE_CHAT.map((message) => (
          <div key={message.who} className="flex gap-3">
            <span
              aria-hidden
              className="mt-0.5 size-8 shrink-0 rounded-[2px] opacity-85"
              style={{ background: message.color }}
            />
            <div className="min-w-0">
              <p
                // rm-role-name darkens the colour on light themes, as role
                // colours are in real messages.
                className="rm-role-name text-ui-sm font-semibold"
                style={
                  {
                    color: message.color,
                    "--rm-role-color": message.color,
                  } as CSSProperties
                }
              >
                {message.who}
              </p>
              <p className="text-ui-sm text-ink-1">{message.text}</p>
            </div>
          </div>
        ))}
        <div className="flex h-8 items-center rounded-[2px] border border-line-field bg-ply-2 px-3 text-ui-sm text-ink-2">
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
          "flex gap-3 rounded-[2px] border border-line-strong bg-ply-0 p-3 shadow-float transition-opacity duration-200",
          alertsOff && "opacity-50",
        )}
      >
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-[2px] bg-primary-fill text-on-primary">
          <Icon name="bell" size="sm" />
        </span>
        <div className="min-w-0">
          <p className="text-ui-xs text-ink-2">Ralph Meet · now</p>
          <p className="text-ui-sm font-semibold text-ink-1">Ada in #design</p>
          <p className="truncate text-ui-sm text-ink-2">
            @you is the voice room still open?
          </p>
        </div>
      </div>
      <p className="flex items-center gap-2 text-ui-xs text-ink-2">
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
