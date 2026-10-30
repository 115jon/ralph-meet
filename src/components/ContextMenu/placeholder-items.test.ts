import { describe, expect, it, vi } from "vitest";

import type { StreamMenuEntry } from "./ContextMenuItems";
import { buildLocalMenu } from "./LocalMenu";
import { buildRemoteMenu } from "./RemoteMenu";

/** Every key in a menu, submenus included. */
function keys(entries: StreamMenuEntry[]): string[] {
  return entries.flatMap((e) => {
    const own = "key" in e && e.key ? [e.key] : [];
    return e.type === "submenu" ? [...own, ...keys(e.entries)] : own;
  });
}

const REMOVED = [
  "server-mute",
  "server-deafen",
  "move-to",
  // "Apps → No apps" was a dead end with nothing behind it.
  "apps",
  "streaming-apps",
  "no-apps",
];

/** Every label in a menu, submenus included. */
function labels(entries: StreamMenuEntry[]): string[] {
  return entries.flatMap((e) => {
    const own = "label" in e && typeof e.label === "string" ? [e.label] : [];
    return e.type === "submenu" ? [...own, ...labels(e.entries)] : own;
  });
}

const peerSetting = {
  volume: 100,
  streamVolume: 100,
  muted: false,
  alwaysHear: false,
  attenuationEnabled: false,
  attenuationStrength: 50,
};

describe("stream menus drop the 'coming soon' moderator items (blocker 3)", () => {
  it("local menu has no server mute / deafen / move to", () => {
    const entries = buildLocalMenu({
      onClose: vi.fn(),
      availableQualities: [],
      handleProfile: vi.fn(),
      handleCopyId: vi.fn(),
    });
    expect(keys(entries)).toEqual(expect.not.arrayContaining(REMOVED));
    expect(keys(entries)).toContain("copy-id");
  });

  for (const isStreaming of [false, true]) {
    it(`local menu names the leave action plainly (streaming: ${isStreaming})`, () => {
      const onLeave = vi.fn();
      const entries = buildLocalMenu({
        isStreaming,
        onClose: vi.fn(),
        onLeave,
        availableQualities: [],
        handleProfile: vi.fn(),
        handleCopyId: vi.fn(),
      });
      expect(labels(entries)).toContain("Leave call");
      expect(labels(entries)).not.toContain("Disconnect");
      const leave = entries.find(
        (e) => e.type === "item" && e.key === "disconnect",
      );
      if (leave?.type !== "item") throw new Error("no leave item");
      leave.onSelect?.();
      expect(onLeave).toHaveBeenCalledOnce();
    });
  }

  for (const isStreaming of [false, true]) {
    it(`remote menu for a moderator has none of them (streaming: ${isStreaming})`, () => {
      const entries = buildRemoteMenu({
        userId: "u-ada",
        isStreaming,
        watchedStreams: { "u-ada": true },
        stopWatching: vi.fn(),
        peerSetting,
        toggleMutePeer: vi.fn(),
        toggleSoundboardMute: vi.fn(),
        setPeerVolume: vi.fn(),
        setPeerStreamVolume: vi.fn(),
        toggleAlwaysHear: vi.fn(),
        toggleAttenuation: vi.fn(),
        setPeerAttenuationStrength: vi.fn(),
        handleProfile: vi.fn(),
        handleMessage: vi.fn(),
        isModerator: true,
        toggleServerSoundboardMute: vi.fn(),
        onClose: vi.fn(),
        handleCopyId: vi.fn(),
      });
      const all = keys(entries);
      expect(all).toEqual(expect.not.arrayContaining(REMOVED));
      // The working moderator action stays.
      expect(all).toContain("server-soundboard");
    });
  }
});
