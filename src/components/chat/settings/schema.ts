/**
 * The settings map: every panel, card and row the settings dialog can show,
 * with the words a person might search for. Panels render their own controls,
 * but they take each row's label, description and visibility from here, so
 * search, deep links and the page can never disagree about what a row is.
 *
 * Row ids are a public, stable API (see settings-links.ts): rename the label
 * freely, never the id.
 */

import type { IconName } from "@/components/ui/icon";

export type SettingsPanelId =
  | "account"
  | "sessions"
  | "privacy"
  | "voice"
  | "soundboard"
  | "keybinds"
  | "appearance"
  | "notifications"
  | "desktop";

/** What the current device can show. Rows outside it are not rendered. */
export type SettingsEnvironment = {
  desktop: boolean;
  /** Touch-only device (no hover, coarse pointer): no keyboard pages. */
  touch?: boolean;
};

export type SettingsRowDef = {
  id: string;
  label: string;
  desc?: string;
  keywords?: string[];
  desktopOnly?: boolean;
  /** Lives in the panel's preview rail rather than a card. */
  rail?: boolean;
};

type SettingsSectionDef = {
  id: string;
  title: string;
  desc?: string;
  desktopOnly?: boolean;
  rows: SettingsRowDef[];
};

export type SettingsPanelDef = {
  id: SettingsPanelId;
  title: string;
  icon: IconName;
  /** One line under the page title: what the page is for. */
  blurb: string;
  /** The page's poster line (36-44px): the blurb's gist, a few words. */
  headline: string;
  desktopOnly?: boolean;
  /** Hidden on touch-only devices (keyboard shortcuts). */
  keyboardOnly?: boolean;
  /** Rows that render in the preview rail, not in a card. */
  railRows?: SettingsRowDef[];
  sections: SettingsSectionDef[];
};

const SETTINGS_PANELS: SettingsPanelDef[] = [
  {
    id: "account",
    title: "Account",
    icon: "account",
    headline: "Who you are, and how you sign in.",
    blurb: "Who you are on Ralph Meet and how you sign in.",
    sections: [
      {
        id: "profile",
        title: "Profile",
        rows: [
          {
            id: "profile",
            label: "Avatar, banner and bio",
            desc: "What people see when they open your profile.",
            keywords: [
              "edit profile",
              "customize",
              "decoration",
              "nameplate",
              "effect",
              "pronouns",
              "about me",
            ],
          },
          {
            id: "display-name",
            label: "Display name",
            desc: "Shown in chat and voice. It doesn't need to be unique.",
            keywords: ["name", "nickname"],
          },
          {
            id: "username",
            label: "Username",
            desc: "Unique to you. Friends use it to find you.",
            keywords: ["handle", "tag", "@"],
          },
          {
            id: "server-profiles",
            label: "Server profiles",
            desc: "A different name and avatar for each server.",
            keywords: ["per server", "identity"],
          },
        ],
      },
      {
        id: "sign-in",
        title: "Sign-in",
        rows: [
          {
            id: "email",
            label: "Email",
            desc: "The address on your Ralph Auth account.",
            keywords: ["mail", "address"],
          },
          {
            id: "sign-in-method",
            label: "Sign-in method",
            desc: "Your password and security are managed by Ralph Auth.",
            keywords: ["password", "security", "ralph auth", "login"],
          },
          {
            id: "sign-out",
            label: "Sign out",
            desc: "Sign out of Ralph Meet on this device.",
            keywords: ["log out", "logout", "leave"],
          },
        ],
      },
    ],
  },
  {
    id: "sessions",
    title: "Sessions",
    icon: "sessions",
    headline: "Where you're signed in.",
    blurb:
      "Devices signed in to your account. Sign out of any you don't recognize.",
    sections: [
      {
        id: "this-device",
        title: "This device",
        rows: [
          {
            id: "current-session",
            label: "This device",
            desc: "The session you're using now.",
            keywords: ["devices", "current", "session"],
          },
        ],
      },
      {
        id: "other-devices",
        title: "Other devices",
        desc: "If you don't recognize one, sign it out and change your password.",
        rows: [
          {
            id: "other-sessions",
            label: "Other devices",
            desc: "Every other place your account is signed in.",
            keywords: [
              "devices",
              "sessions",
              "revoke",
              "log out",
              "sign out",
              "logged in",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "privacy",
    title: "Privacy & safety",
    icon: "privacy",
    headline: "What you see and what you share.",
    blurb: "The media you see, and the messages you've shared publicly.",
    sections: [
      {
        id: "media-filter",
        title: "Media filter",
        desc: "Applies to GIF, sticker, clip and meme search and trending. Where a provider supports it, Ralph Meet sends your account ID so results match your choice.",
        rows: [
          {
            id: "media-filter",
            label: "Filter level",
            desc: "How broad media results can be.",
            keywords: [
              "media",
              "content",
              "safe search",
              "nsfw",
              "gif",
              "sticker",
              "meme",
              "clip",
              "rating",
            ],
          },
        ],
      },
      {
        id: "shared-messages",
        title: "Shared messages",
        desc: "Public links to message snapshots. A revoked link stops working.",
        rows: [
          {
            id: "shared-messages",
            label: "Shared message links",
            desc: "Copy, open or revoke links you've shared.",
            keywords: [
              "share",
              "shares",
              "public",
              "link",
              "revoke",
              "snapshot",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "voice",
    title: "Voice & video",
    icon: "mic",
    headline: "Your mic, speakers and camera.",
    blurb: "Your mic, speakers and camera, and how you sound to others.",
    railRows: [
      {
        id: "mic-test",
        label: "Mic test",
        desc: "Hear yourself and watch your input level.",
        keywords: ["test", "microphone", "level", "meter", "hear myself"],
        rail: true,
      },
    ],
    sections: [
      {
        id: "input",
        title: "Input",
        rows: [
          {
            id: "microphone",
            label: "Microphone",
            keywords: ["mic", "input device", "audio input"],
          },
          {
            id: "input-volume",
            label: "Input volume",
            keywords: ["mic volume", "gain", "loudness"],
          },
          {
            id: "input-profile",
            label: "Input profile",
            desc: "Pick a preset, or Custom to set each option yourself.",
            keywords: ["voice isolation", "studio", "custom", "preset"],
          },
        ],
      },
      {
        id: "processing",
        title: "Processing",
        rows: [
          {
            id: "auto-sensitivity",
            label: "Adjust sensitivity automatically",
            desc: "The voice detector adapts to your mic level.",
            keywords: ["voice activity", "gate", "threshold", "vad"],
          },
          {
            id: "sensitivity",
            label: "Input sensitivity",
            desc: "Sound above the marker is sent.",
            keywords: ["threshold", "voice activity", "gate", "vad"],
          },
          {
            id: "noise-suppression",
            label: "Noise suppression",
            desc: "Reduces background noise with RNNoise.",
            keywords: ["rnnoise", "background noise", "denoise", "fan"],
          },
          {
            id: "browser-noise-suppression",
            label: "Browser noise suppression",
            desc: "Uses your browser's built-in noise suppression.",
            keywords: ["noise", "background"],
          },
          {
            id: "echo-cancellation",
            label: "Echo cancellation",
            desc: "Stops your mic picking up your speakers.",
            keywords: ["echo", "feedback"],
          },
          {
            id: "high-fidelity",
            label: "High fidelity audio",
            desc: "Keeps stereo mic input with browser processing off.",
            keywords: ["stereo", "quality", "music", "hifi"],
          },
          {
            id: "spatial-audio",
            label: "Spatial audio",
            desc: "Hear where people sit in the room with stereo panning.",
            keywords: ["3d", "panning", "stereo", "positional"],
          },
        ],
      },
      {
        id: "output",
        title: "Output",
        rows: [
          {
            id: "speaker",
            label: "Speaker",
            keywords: ["output device", "headphones", "audio output"],
          },
          {
            id: "output-volume",
            label: "Output volume",
            keywords: ["speaker volume", "loudness"],
          },
        ],
      },
      {
        id: "camera",
        title: "Camera",
        rows: [
          {
            id: "camera-preview",
            label: "Camera preview",
            desc: "Check your framing and background before you go live.",
            keywords: ["video", "webcam", "test camera"],
          },
          {
            id: "camera",
            label: "Camera",
            keywords: ["video device", "webcam"],
          },
          {
            id: "camera-quality",
            label: "Capture quality",
            desc: "Higher quality uses more bandwidth.",
            keywords: ["resolution", "fps", "1080p", "720p", "frame rate"],
          },
          {
            id: "camera-background",
            label: "Background",
            desc: "Blur your surroundings or use your own image.",
            keywords: ["blur", "virtual background", "upload", "image"],
          },
          {
            id: "always-preview-video",
            label: "Preview before turning on camera",
            desc: "Shows a preview before your camera goes live.",
            keywords: ["video", "camera", "confirm"],
          },
        ],
      },
      {
        id: "screen-share",
        title: "Screen share",
        rows: [
          {
            id: "stream-preview",
            label: "Always show stream preview",
            desc: "Keeps your stream preview visible while Ralph Meet isn't focused.",
            keywords: ["stream", "go live", "screen share", "preview"],
          },
        ],
      },
    ],
  },
  {
    id: "soundboard",
    title: "Soundboard",
    icon: "soundboard",
    headline: "Sounds for joining and leaving.",
    blurb: "Sounds that play when you join or leave a voice channel.",
    sections: [
      {
        id: "soundboard-playback",
        title: "Playback",
        rows: [
          {
            id: "soundboard-volume",
            label: "Soundboard volume",
            desc: "How loud automatic sounds play for you.",
            keywords: ["volume", "sounds"],
          },
        ],
      },
      {
        id: "join-leave-sounds",
        title: "Join and leave sounds",
        desc: "These play on top of the usual connect tones.",
        rows: [
          {
            id: "sound-scope",
            label: "Server",
            desc: "Set sounds for every server, or override them for one.",
            keywords: ["scope", "all servers", "override"],
          },
          {
            id: "join-sound",
            label: "Join sound",
            keywords: ["entrance", "join", "intro", "trigger"],
          },
          {
            id: "leave-sound",
            label: "Leave sound",
            keywords: ["exit", "leave", "outro", "trigger"],
          },
        ],
      },
    ],
  },
  {
    id: "keybinds",
    title: "Keybinds",
    icon: "keyboard",
    keyboardOnly: true,
    headline: "Keys you can use today.",
    blurb: "Keyboard shortcuts you can use today, and call keys on the way.",
    sections: [
      {
        id: "call-keys",
        title: "Call keys",
        desc: "You can't set call keys yet. Until then, mute and deafen are in the command menu.",
        rows: [
          {
            id: "push-to-talk",
            label: "Push to talk",
            desc: "Hold a key to send your voice.",
            keywords: ["ptt", "hotkey", "keybind", "shortcut"],
          },
          {
            id: "toggle-mute",
            label: "Toggle mute",
            keywords: ["mute", "hotkey", "keybind", "shortcut"],
          },
          {
            id: "toggle-deafen",
            label: "Toggle deafen",
            keywords: ["deafen", "hotkey", "keybind", "shortcut"],
          },
        ],
      },
      {
        id: "built-in-shortcuts",
        title: "Built-in shortcuts",
        desc: "These work everywhere in Ralph Meet and can't be changed.",
        rows: [
          {
            id: "kb-command-menu",
            label: "Open the command menu",
            desc: "Jump to a server, channel or DM, or mute and deafen.",
            keywords: ["search", "quick switcher", "ctrl k", "cmd k"],
          },
          {
            id: "kb-send",
            label: "Send a message",
            keywords: ["enter", "composer"],
          },
          {
            id: "kb-new-line",
            label: "Start a new line",
            keywords: ["shift enter", "composer", "multiline"],
          },
          {
            id: "kb-edit-last",
            label: "Edit your last message",
            desc: "When the message box is empty.",
            keywords: ["arrow up", "edit"],
          },
          {
            id: "kb-cancel-reply",
            label: "Cancel a reply",
            keywords: ["escape", "esc", "reply"],
          },
        ],
      },
    ],
  },
  {
    id: "appearance",
    title: "Appearance",
    icon: "appearance",
    headline: "Theme and motion.",
    blurb: "Theme and motion. Changes apply as you pick them.",
    sections: [
      {
        id: "theme",
        title: "Theme",
        rows: [
          {
            id: "theme",
            label: "Theme",
            keywords: [
              "dark",
              "light",
              "midnight",
              "miku",
              "spider-man",
              "system",
              "colors",
            ],
          },
          {
            id: "theme-sync",
            label: "Use this theme on all my devices",
            desc: "Saves your theme to your account and applies it wherever you sign in.",
            keywords: ["sync", "theme", "account"],
          },
          {
            id: "theme-preview",
            label: "Preview on your chat",
            desc: "Hide settings and try themes against the screen behind.",
            keywords: ["preview", "try", "theme"],
          },
        ],
      },
      {
        id: "motion",
        title: "Motion & readability",
        rows: [
          {
            id: "reduced-motion",
            label: "Reduced motion",
            desc: "When your device asks for less motion, slides and zooms become fades.",
            keywords: ["accessibility", "animation", "motion", "a11y"],
          },
        ],
      },
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    icon: "bell",
    headline: "Alerts and sounds.",
    blurb: "Desktop alerts and the sounds Ralph Meet plays.",
    sections: [
      {
        id: "desktop-alerts",
        title: "Desktop alerts",
        desktopOnly: true,
        rows: [
          {
            id: "desktop-notifications",
            label: "Desktop notifications",
            desc: "Native notifications for mentions, replies, DMs and unread activity.",
            keywords: ["alerts", "native", "popup", "toast"],
            desktopOnly: true,
          },
        ],
      },
      {
        id: "sounds",
        title: "Sounds",
        rows: [
          {
            id: "sounds-enabled",
            label: "Sound effects",
            desc: "Turns every in-app sound on or off.",
            keywords: ["master", "sounds", "audio", "mute all"],
          },
          {
            id: "sound-volume",
            label: "Sound volume",
            keywords: ["volume", "sounds"],
          },
          {
            id: "sound-notifications",
            label: "Notification sounds",
            desc: "A chime for mentions, replies and DMs.",
            keywords: ["chime", "mention", "dm", "ping"],
          },
          {
            id: "sound-voice-join-leave",
            label: "Voice join and leave",
            desc: "A tone when someone joins or leaves your voice channel.",
            keywords: ["voice", "join", "leave"],
          },
          {
            id: "sound-connect",
            label: "Connect and disconnect",
            desc: "A chime when you join or leave a voice channel.",
            keywords: ["connect", "disconnect", "voice"],
          },
          {
            id: "sound-mute",
            label: "Mute and deafen",
            desc: "A click when you mute or deafen.",
            keywords: ["mute", "deafen", "click"],
          },
          {
            id: "sound-screen-share",
            label: "Screen share",
            desc: "A tone when a screen share starts or stops.",
            keywords: ["stream", "screen share"],
          },
          {
            id: "sound-stream-viewers",
            label: "Stream viewers",
            desc: "A sound when someone starts or stops watching your stream.",
            keywords: ["viewer", "watching", "stream"],
          },
          {
            id: "test-sound",
            label: "Test notification sound",
            keywords: ["test", "play", "chime"],
          },
        ],
      },
    ],
  },
  {
    id: "desktop",
    title: "Desktop app",
    icon: "monitor",
    headline: "How the app starts and updates.",
    blurb:
      "How the Ralph Meet app starts, closes and updates on this computer.",
    desktopOnly: true,
    sections: [
      {
        id: "startup",
        title: "Startup and closing",
        rows: [
          {
            id: "open-on-startup",
            label: "Open on startup",
            desc: "Ralph Meet opens when your computer starts.",
            keywords: ["autostart", "login", "boot", "launch"],
          },
          {
            id: "start-minimized",
            label: "Start minimized",
            desc: "When it opens on startup, Ralph Meet waits in the tray.",
            keywords: ["background", "hidden", "tray"],
          },
          {
            id: "close-to-tray",
            label: "Close to tray",
            desc: "The close button hides Ralph Meet in the tray instead of quitting.",
            keywords: ["minimize", "quit", "system tray"],
          },
        ],
      },
      {
        id: "performance",
        title: "Performance",
        rows: [
          {
            id: "hardware-acceleration",
            label: "Hardware acceleration",
            desc: "Uses your GPU for smoother rendering. Turn it off if you see visual glitches.",
            keywords: ["gpu", "graphics", "glitch", "performance", "restart"],
          },
        ],
      },
      {
        id: "updates",
        title: "Updates",
        rows: [
          {
            id: "app-version",
            label: "Version",
            keywords: ["update", "upgrade", "release", "check for updates"],
          },
        ],
      },
    ],
  },
];

export const SETTINGS_NAV_GROUPS: Array<{
  title: string;
  ids: SettingsPanelId[];
}> = [
  { title: "You", ids: ["account", "sessions", "privacy"] },
  { title: "Calls", ids: ["voice", "soundboard", "keybinds"] },
  { title: "App", ids: ["appearance", "notifications", "desktop"] },
];

/** Panels with a live preview rail beside the cards. */
export const PANELS_WITH_RAIL = new Set<SettingsPanelId>([
  "account",
  "voice",
  "appearance",
  "notifications",
]);

export const PANEL_BY_ID = Object.fromEntries(
  SETTINGS_PANELS.map((panel) => [panel.id, panel]),
) as Record<SettingsPanelId, SettingsPanelDef>;

type RowLocation = {
  panel: SettingsPanelDef;
  section: SettingsSectionDef | null;
  row: SettingsRowDef;
};

const ROW_INDEX = new Map<string, RowLocation>();
const SECTION_INDEX = new Map<
  string,
  { panel: SettingsPanelDef; section: SettingsSectionDef }
>();
for (const panel of SETTINGS_PANELS) {
  for (const row of panel.railRows ?? []) {
    ROW_INDEX.set(row.id, { panel, section: null, row });
  }
  for (const section of panel.sections) {
    SECTION_INDEX.set(section.id, { panel, section });
    for (const row of section.rows) {
      ROW_INDEX.set(row.id, { panel, section, row });
    }
  }
}

export function isSettingsPanelId(value: unknown): value is SettingsPanelId {
  return typeof value === "string" && value in PANEL_BY_ID;
}

export function getRowLocation(rowId: string): RowLocation | undefined {
  return ROW_INDEX.get(rowId);
}

export function getSectionDef(sectionId: string) {
  return SECTION_INDEX.get(sectionId);
}

export function isPanelAvailable(
  panel: SettingsPanelDef,
  env: SettingsEnvironment,
): boolean {
  if (panel.keyboardOnly && env.touch) return false;
  return !panel.desktopOnly || env.desktop;
}

export function isRowAvailable(
  rowId: string,
  env: SettingsEnvironment,
): boolean {
  const location = ROW_INDEX.get(rowId);
  if (!location) return false;
  if (!isPanelAvailable(location.panel, env)) return false;
  if (location.section?.desktopOnly && !env.desktop) return false;
  return !location.row.desktopOnly || env.desktop;
}

/* ------------------------------------------------------------------ */
/* Search                                                               */
/* ------------------------------------------------------------------ */

export function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function rowHaystack(location: RowLocation): string {
  return [
    location.row.label,
    location.row.desc ?? "",
    ...(location.row.keywords ?? []),
    location.section?.title ?? "",
    location.panel.title,
  ]
    .join(" ")
    .toLowerCase();
}

export function rowMatches(rowId: string, query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const location = ROW_INDEX.get(rowId);
  if (!location) return false;
  const haystack = rowHaystack(location);
  return tokens.every((token) => haystack.includes(token));
}

export type SettingsSearchHit = {
  panel: SettingsPanelDef;
  section: SettingsSectionDef | null;
  row: SettingsRowDef;
};

/** Every row the query matches, in page order, on this device. */
export function searchSettings(
  query: string,
  env: SettingsEnvironment,
): SettingsSearchHit[] {
  if (searchTokens(query).length === 0) return [];
  const hits: SettingsSearchHit[] = [];
  for (const panel of SETTINGS_PANELS) {
    if (!isPanelAvailable(panel, env)) continue;
    const rows: Array<[SettingsSectionDef | null, SettingsRowDef]> = [
      ...(panel.railRows ?? []).map(
        (row) => [null, row] as [SettingsSectionDef | null, SettingsRowDef],
      ),
      ...panel.sections.flatMap((section) =>
        section.rows.map(
          (row) =>
            [section, row] as [SettingsSectionDef | null, SettingsRowDef],
        ),
      ),
    ];
    for (const [section, row] of rows) {
      if (!isRowAvailable(row.id, env)) continue;
      if (rowMatches(row.id, query)) hits.push({ panel, section, row });
    }
  }
  return hits;
}

/**
 * A section's place on its page ("2 of 4"), among the sections this device
 * can show, for the rule card's "02 / 04" index. Search doesn't change it.
 */
export function getSectionPosition(
  sectionId: string,
  env: SettingsEnvironment,
  /** Sections the host leaves out (rooms drop the camera card). */
  exclude: readonly string[] = [],
): { index: number; total: number } | null {
  const entry = SECTION_INDEX.get(sectionId);
  if (!entry) return null;
  const sections = entry.panel.sections.filter(
    (section) =>
      (!section.desktopOnly || env.desktop) && !exclude.includes(section.id),
  );
  const at = sections.findIndex((section) => section.id === sectionId);
  return at < 0 ? null : { index: at + 1, total: sections.length };
}

/** Visible rows of a section after environment and search filtering. */
export function visibleSectionRows(
  sectionId: string,
  env: SettingsEnvironment,
  query: string,
): SettingsRowDef[] {
  const entry = SECTION_INDEX.get(sectionId);
  if (!entry) return [];
  if (entry.section.desktopOnly && !env.desktop) return [];
  return entry.section.rows.filter(
    (row) => isRowAvailable(row.id, env) && rowMatches(row.id, query),
  );
}
