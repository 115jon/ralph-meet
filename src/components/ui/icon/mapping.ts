/**
 * App concept -> Phosphor glyph. This is the one table an icon change edits:
 * call sites ask for a concept (`<Icon name="micOff" />`), never for a glyph
 * or a library component.
 *
 * Fields:
 *   glyph   Phosphor asset name (kebab-case, as in @phosphor-icons/core)
 *   fill    also ship the Fill weight, so the concept can take
 *           state="active" | "off". Idle is always Bold.
 *   slash   compose a slash over the glyph (Phosphor has no slashed version)
 *   rotate  degrees, baked into the drawing
 *
 * `scripts/generate-phosphor-icons.mjs` reads this file and writes
 * `glyphs.generated.ts` with only the weights listed here, so keep this file
 * free of imports and runtime code. Run `pnpm icons:generate` after editing.
 */

export type GlyphSpec = {
  readonly glyph: string;
  readonly fill?: true;
  readonly slash?: true;
  readonly rotate?: number;
};

export const ICONS = {
  /* Rail and navigation */
  download: { glyph: "download-simple" },
  upload: { glyph: "upload-simple" },
  menu: { glyph: "list" },
  home: { glyph: "house", fill: true },
  back: { glyph: "arrow-left" },
  arrowRight: { glyph: "arrow-right" },
  externalLink: { glyph: "arrow-square-out" },

  /* Channels: one glyph per channel kind */
  textChannel: { glyph: "hash" },
  voiceChannel: { glyph: "speaker-high" },
  announcement: { glyph: "megaphone-simple" },
  lockedChannel: { glyph: "lock-simple" },
  rules: { glyph: "book-open-text" },

  /* Chevrons (12px) */
  chevronDown: { glyph: "caret-down" },
  chevronUp: { glyph: "caret-up" },
  chevronLeft: { glyph: "caret-left" },
  chevronRight: { glyph: "caret-right" },
  chevronsRight: { glyph: "caret-double-right" },

  /* Generic actions */
  add: { glyph: "plus" },
  minus: { glyph: "minus", fill: true },
  close: { glyph: "x", fill: true },
  check: { glyph: "check", fill: true },
  neutral: { glyph: "line-vertical", rotate: 45 },
  settings: { glyph: "gear-six", fill: true },
  search: { glyph: "magnifying-glass" },
  zoomIn: { glyph: "magnifying-glass-plus" },
  zoomOut: { glyph: "magnifying-glass-minus" },
  more: { glyph: "dots-three" },
  dragHandle: { glyph: "dots-six-vertical" },
  copy: { glyph: "copy" },
  copyId: { glyph: "identification-badge" },
  link: { glyph: "link-simple", fill: true },
  linkBroken: { glyph: "link-simple-break" },
  share: { glyph: "share-network" },
  edit: { glyph: "pencil-simple" },
  trash: { glyph: "trash" },
  refresh: { glyph: "arrows-clockwise" },
  reset: { glyph: "arrow-counter-clockwise" },
  maximize: { glyph: "arrows-out" },
  minimize: { glyph: "arrows-in" },
  move: { glyph: "arrows-out-cardinal" },
  eye: { glyph: "eye" },
  eyeOff: { glyph: "eye-slash" },
  backspace: { glyph: "backspace" },
  crop: { glyph: "crop" },
  eyedropper: { glyph: "eyedropper" },

  /* Header */
  threads: { glyph: "chats-circle" },
  pin: { glyph: "push-pin", fill: true },
  bell: { glyph: "bell", fill: true },
  bellOff: { glyph: "bell-slash", fill: true },
  bellRinging: { glyph: "bell-ringing" },
  members: { glyph: "users", fill: true },
  help: { glyph: "question" },

  /* People */
  account: { glyph: "user", fill: true },
  invite: { glyph: "user-plus", fill: true },
  userRemove: { glyph: "user-minus" },
  userCheck: { glyph: "user-check" },
  profile: { glyph: "identification-card" },
  crown: { glyph: "crown" },
  verified: { glyph: "seal-check" },
  mention: { glyph: "at" },

  /* Messages */
  react: { glyph: "smiley-wink" },
  reply: { glyph: "arrow-bend-up-left" },
  forward: { glyph: "arrow-bend-up-right" },
  thread: { glyph: "chat-circle-text" },
  chat: { glyph: "chat-circle", fill: true },
  markUnread: { glyph: "envelope-simple" },
  markRead: { glyph: "checks" },
  /* Social post metrics (link embeds) */
  like: { glyph: "heart", fill: true },
  repost: { glyph: "repeat" },
  bookmark: { glyph: "bookmark-simple" },

  /* Composer */
  paperclip: { glyph: "paperclip" },
  gif: { glyph: "gif" },
  sticker: { glyph: "sticker", fill: true },
  emoji: { glyph: "smiley" },
  send: { glyph: "paper-plane-right" },
  image: { glyph: "image" },
  imageBroken: { glyph: "image-broken" },

  /* Voice and video */
  mic: { glyph: "microphone", fill: true },
  micOff: { glyph: "microphone-slash", fill: true },
  deafen: { glyph: "headphones", fill: true },
  deafenOff: { glyph: "headphones", fill: true, slash: true },
  camera: { glyph: "video-camera", fill: true },
  cameraOff: { glyph: "video-camera-slash", fill: true },
  photo: { glyph: "camera" },
  screenShare: { glyph: "monitor-arrow-up", fill: true },
  stream: { glyph: "monitor-play" },
  streamOff: { glyph: "monitor", slash: true },
  activities: { glyph: "rocket-launch" },
  soundboard: { glyph: "music-notes-simple", fill: true },
  sliders: { glyph: "sliders-horizontal" },
  call: { glyph: "phone", fill: true },
  disconnect: { glyph: "phone-disconnect" },
  speaking: { glyph: "waveform" },
  signal: { glyph: "cell-signal-high" },
  speaker: { glyph: "speaker-hifi" },
  headphones: { glyph: "headphones" },
  speakerOff: { glyph: "speaker-slash" },
  noiseSuppression: { glyph: "wind" },
  spatial: { glyph: "cube" },

  /* Media and music */
  music: { glyph: "music-notes" },
  playlist: { glyph: "playlist" },
  queueAdd: { glyph: "list-plus" },
  play: { glyph: "play", fill: true },
  pause: { glyph: "pause", fill: true },
  stop: { glyph: "stop" },
  skip: { glyph: "skip-forward" },

  /* Devices and platforms */
  monitor: { glyph: "monitor", fill: true },
  laptop: { glyph: "laptop" },
  mobile: { glyph: "device-mobile" },
  window: { glyph: "app-window" },
  tv: { glyph: "television" },
  globe: { glyph: "globe" },
  cpu: { glyph: "cpu" },
  gauge: { glyph: "gauge" },
  server: { glyph: "hard-drives" },
  offline: { glyph: "wifi-slash" },

  /* Settings */
  sessions: { glyph: "devices", fill: true },
  keyboard: { glyph: "keyboard", fill: true },
  key: { glyph: "key" },
  privacy: { glyph: "shield-check", fill: true },
  shield: { glyph: "shield", fill: true },
  shieldX: { glyph: "shield-slash" },
  lock: { glyph: "lock-simple", fill: true },
  appearance: { glyph: "palette", fill: true },
  paintBrush: { glyph: "paint-brush" },
  magic: { glyph: "magic-wand" },
  sun: { glyph: "sun" },
  moon: { glyph: "moon" },
  logout: { glyph: "sign-out" },
  power: { glyph: "power" },
  auditLog: { glyph: "clipboard-text", fill: true },
  ban: { glyph: "prohibit", fill: true },
  event: { glyph: "calendar-plus" },
  calendar: { glyph: "calendar-blank" },
  clock: { glyph: "clock" },
  timer: { glyph: "timer" },
  timerOff: { glyph: "timer", slash: true },
  folderAdd: { glyph: "folder-plus" },

  /* Shop and activities */
  shop: { glyph: "shopping-bag" },
  sparkle: { glyph: "sparkle" },
  gem: { glyph: "diamond" },
  tag: { glyph: "tag" },
  star: { glyph: "star", fill: true },
  trophy: { glyph: "trophy" },
  trendUp: { glyph: "trend-up" },
  stats: { glyph: "chart-bar" },
  lightbulb: { glyph: "lightbulb" },
  sword: { glyph: "sword" },
  grid: { glyph: "squares-four" },
  zap: { glyph: "lightning" },
  gamepad: { glyph: "game-controller" },

  /* Files (attachments) */
  file: { glyph: "file" },
  fileAdd: { glyph: "file-plus" },
  fileImage: { glyph: "file-image" },
  fileVideo: { glyph: "file-video" },
  fileAudio: { glyph: "file-audio" },
  fileText: { glyph: "file-text" },
  fileSpreadsheet: { glyph: "table" },
  filePresentation: { glyph: "presentation-chart" },
  fileArchive: { glyph: "file-archive" },
  fileCode: { glyph: "file-code" },
  fileData: { glyph: "brackets-curly" },
  fileFont: { glyph: "text-aa" },

  /* Status */
  warning: { glyph: "warning" },
  alert: { glyph: "warning-circle" },
  info: { glyph: "info" },
  success: { glyph: "check-circle" },
  error: { glyph: "x-circle" },
  loader: { glyph: "circle-notch" },
} as const satisfies Record<string, GlyphSpec>;

export type IconName = keyof typeof ICONS;

/** Concepts that ship a Fill weight and so accept a non-idle state. */
export type StatefulIconName = {
  [K in IconName]: (typeof ICONS)[K] extends { fill: true } ? K : never;
}[IconName];

/** `state="off"` on these resolves to the paired concept, drawn in Fill. */
export const OFF_PAIR = {
  mic: "micOff",
  deafen: "deafenOff",
  camera: "cameraOff",
  bell: "bellOff",
} as const satisfies Partial<Record<StatefulIconName, StatefulIconName>>;
