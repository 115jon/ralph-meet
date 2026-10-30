// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialState } from "@/lib/chat-reducer";
import type { VoiceChannelMember } from "@/stores/chat-store";
import { useChatStore } from "@/stores/chat-store";
import { useActivityStore } from "@/stores/useActivityStore";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

import ChannelSidebar, {
  OCCUPANT_LEAVE_CLOSE_MS,
  OCCUPANT_LEAVE_FADE_MS,
} from "../ChannelSidebar";

function member(id: string, name: string): VoiceChannelMember {
  return {
    clerk_user_id: id,
    name,
    username: name,
    display_name: null,
    avatar_url: null,
    self_mute: false,
    self_deaf: false,
    self_video: false,
    self_stream: false,
  } as VoiceChannelMember;
}

const ADA = member("u-ada", "Ada");
const GRACE = member("u-grace", "Grace");
const LINUS = member("u-linus", "Linus");

function sidebar(members: VoiceChannelMember[]) {
  return React.createElement(ChannelSidebar, {
    channels: [
      {
        id: "vc-1",
        server_id: "srv-1",
        name: "Lounge",
        channel_type: "voice",
        position: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    categories: [],
    activeChannelId: null,
    serverId: "srv-1",
    serverName: "Ralph HQ",
    onSelect: () => {},
    voiceChannelStates: { "vc-1": members },
  });
}

function leaves(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-slot=tree-leaf]"),
  );
}

/** Two animation frames: TreeBranch's first-paint gate. */
async function paint() {
  await act(async () => {
    vi.advanceTimersByTime(40);
  });
}

describe("ChannelSidebar occupant leave (spec §5c)", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    useChatStore.setState(initialState);
    useChatStore.setState({ user: { id: "me", username: "me" } as never });
    useActivityStore.setState({ activeByUser: {} });
    useVoiceSettingsStore.setState({
      currentUser: null,
      userSettings: {},
      _cache: {},
    });
    useListenTogetherStore.setState({ rooms: {} });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("holds the departing row: LED out, fade, then close up, then gone", async () => {
    const { container, rerender } = render(sidebar([ADA, GRACE, LINUS]));
    await paint();

    rerender(sidebar([ADA, LINUS]));
    const rows = leaves(container);
    // Grace keeps her place while she leaves.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Ada"),
      expect.stringContaining("Grace"),
      expect.stringContaining("Linus"),
    ]);
    const grace = rows[1]!;
    expect(grace).toHaveAttribute("data-leaving");
    expect(grace).toHaveAttribute("aria-hidden", "true");
    expect(grace).not.toHaveAttribute("data-speaking");
    expect(grace.querySelector("[data-slot=led]")).toHaveAttribute(
      "data-state",
      "off",
    );
    expect(grace.style.opacity).toBe("0");
    // Fade first, then the close-up, which waits for the fade.
    expect(grace.style.transition).toContain(
      `opacity ${OCCUPANT_LEAVE_FADE_MS}ms`,
    );
    expect(grace.style.transition).toContain(
      `margin-bottom ${OCCUPANT_LEAVE_CLOSE_MS}ms var(--ease-in-out) ${OCCUPANT_LEAVE_FADE_MS}ms`,
    );
    expect(rows[0]).not.toHaveAttribute("data-leaving");
    expect(rows[2]).not.toHaveAttribute("data-leaving");

    await act(async () => {
      vi.advanceTimersByTime(OCCUPANT_LEAVE_FADE_MS + OCCUPANT_LEAVE_CLOSE_MS);
    });
    expect(leaves(container).map((row) => row.textContent)).toEqual([
      expect.stringContaining("Ada"),
      expect.stringContaining("Linus"),
    ]);
  });

  it("never animates before the first paint", () => {
    const { container, rerender } = render(sidebar([ADA, GRACE]));
    rerender(sidebar([ADA]));
    expect(leaves(container)).toHaveLength(1);
    expect(container.querySelector("[data-leaving]")).toBeNull();
  });

  it("brings back someone who rejoins mid-exit as a normal row", async () => {
    const { container, rerender } = render(sidebar([ADA, GRACE]));
    await paint();
    rerender(sidebar([ADA]));
    expect(container.querySelector("[data-leaving]")).not.toBeNull();
    rerender(sidebar([ADA, GRACE]));
    expect(container.querySelector("[data-leaving]")).toBeNull();
    expect(leaves(container)).toHaveLength(2);
  });
});
