/**
 * Unit 4: elevation (design-system.md 6.1, 6.3).
 *
 *  1. Delete every backdrop-blur* utility (styles.css neutralises them).
 *     Plain blur-* is NOT touched: NSFW frames and camera previews rely on
 *     data-rm-preserve-blur, and two other uses are listed in the report.
 *  2. Hand-rolled shadow-[...]: floating surfaces get a token, everything
 *     else (tiles, cards, buttons, inline media, glows, inset highlights)
 *     loses the shadow. Floating surfaces are the FLOATING map below, keyed
 *     by file:line. Spread-only rings (shadow-[0_0_0_Npx...]) are selection
 *     or focus rings, not elevation; they are left alone and listed, as are
 *     drop-shadow-[...] legibility shadows on media overlays.
 */
import { run } from "./_lib.mjs";

/** file:line -> token that replaces the first arbitrary shadow on the line. */
const FLOATING = {
  "src/components/chat/AvatarPickerModal.tsx:176": "shadow-2xl",
  "src/components/chat/EmojiPicker.tsx:784": "shadow-lg",
  "src/components/chat/FloatingSoundboardManager.tsx:196": "shadow-sm",
  "src/components/chat/FloatingSoundboardManager.tsx:204": "shadow-lg",
  "src/components/chat/ListenTogetherNowPlayingCard.tsx:616": "shadow-lg",
  "src/components/chat/ListenTogetherResultActions.tsx:108": "shadow-2xl",
  "src/components/chat/ProfileEditorModal.tsx:30": "shadow-2xl",
  "src/components/chat/ProfileSurfaceShell.tsx:30": "shadow-lg",
  "src/components/chat/SettingsAccountTab.tsx:431": "shadow-lg",
  "src/components/chat/SettingsAccountTab.tsx:808": "shadow-lg",
  "src/components/chat/SettingsAccountTab.tsx:1255": "shadow-2xl",
  "src/components/chat/SettingsAccountTab.tsx:4590": "shadow-lg",
  "src/components/chat/SoundboardPicker.tsx:2761": "shadow-lg",
  "src/components/chat/UserAccountPopover.tsx:48": "shadow-lg",
  "src/components/chat/UserProfileModal.tsx:220": "shadow-2xl",
  "src/components/chat/WarpRushActivityStage.tsx:1213": "shadow-lg",
  "src/components/chat/WarpRushActivityStage.tsx:1308": "shadow-lg",
  "src/components/chat/WarpRushActivityStage.tsx:1388": "shadow-lg",
};

/** Left alone on purpose, with the reason; they stay in the checker count. */
const EXEMPT = {
  "src/components/chat/SettingsSwitch.tsx":
    "switch knob needs its 1px lift on light tracks",
  "src/components/voice/ParticipantCard.tsx:147":
    "vignette over video, a media overlay (6.5)",
  "src/components/chat/VoiceAppsModal.tsx":
    "neon glow is part of the Warp Rush illustration",
};

const BLUR =
  /[ ]?(?<![\w-])(?:[\w-]+:|\[[^\]\s]+\]:)*backdrop-blur(?:-[\w[\]]+)?(?![\w-])/g;
const SHADOW = /(?<![\w-])((?:[\w-]+:|\[[^\]\s]+\]:)*)shadow-\[([^\]]+)\]/g;

run("04-elevation", (line, ctx) => {
  let out = line.replace(BLUR, () => {
    ctx.hit("deleted backdrop-blur");
    return "";
  });

  let first = true;
  const key = `${ctx.file}:${ctx.lineNo}`;
  const floating = FLOATING[key];
  out = out.replace(SHADOW, (m, chain, value) => {
    const why = EXEMPT[ctx.file] ?? EXEMPT[key];
    if (why) {
      ctx.skip("shadow", `${m} left: ${why}`);
      return m;
    }
    if (/^0_0_0_\d/.test(value) && !floating) {
      ctx.skip("shadow", `${m} is a ring, left alone`);
      return m;
    }
    if (
      /var\(--rm-shadow-[123]\)/.test(value) ||
      /^inset_0_-1px_0_var\(--rm-border-strong\)$/.test(value)
    )
      return m;
    if (floating && first && chain === "") {
      first = false;
      ctx.hit(`floating -> ${floating}`);
      return floating;
    }
    ctx.hit("deleted shadow on tile/card/button/media");
    // swallow one adjacent space so no double space is left
    return "@@DEL@@";
  });
  out = out
    .replace(/ @@DEL@@(?=["'`])/g, "")
    .replace(/(["'`])@@DEL@@ /g, "$1")
    .replace(/ @@DEL@@/g, "")
    .replace(/@@DEL@@ ?/g, "");

  return out;
});
