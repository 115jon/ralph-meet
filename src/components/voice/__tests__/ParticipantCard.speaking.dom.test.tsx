// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ParticipantCard,
  type ParticipantCardProps,
} from "@/components/voice/ParticipantCard";
import { cardPropsEqual } from "@/components/voice/tile-utils";
import type { GridItem } from "@/components/voice/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useChatStore } from "@/stores/chat-store";

function item(overrides: Partial<GridItem> = {}): GridItem {
  return {
    id: "g-ada",
    userId: "u-ada",
    name: "Ada Lovelace",
    avatar: null,
    stream: null,
    isLocal: false,
    type: "avatar",
    isStreaming: false,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
    ...overrides,
  };
}

function props(overrides: Partial<ParticipantCardProps> = {}) {
  return {
    item: item(),
    isFocused: false,
    isTray: false,
    globalDeafened: false,
    onClick: () => {},
    watchedStreams: {},
    streamThumbnails: {},
    ...overrides,
  } satisfies ParticipantCardProps;
}

describe("ParticipantCard speaking", () => {
  afterEach(() => {
    useChatStore.setState({ speakingUsers: {} });
  });

  it("ignores item.isSpeaking and onClick identity when memoising", () => {
    const a = props();
    expect(
      cardPropsEqual(a, {
        ...a,
        item: { ...a.item, isSpeaking: true },
        onClick: () => {},
      }),
    ).toBe(true);
    expect(
      cardPropsEqual(a, { ...a, item: { ...a.item, isMuted: true } }),
    ).toBe(false);
    expect(cardPropsEqual(a, { ...a, isFocused: true })).toBe(false);
  });

  it("lights the ring and the nameplate LED from the speaking store", () => {
    const { container } = render(
      <TooltipProvider>
        <ParticipantCard {...props()} />
      </TooltipProvider>,
    );
    const tile = container.querySelector("[data-tile]")!;
    expect(tile.className).toContain("rm-speak");
    expect(tile.hasAttribute("data-speaking")).toBe(false);

    act(() => {
      useChatStore.setState({ speakingUsers: { "u-ada": true } });
    });
    expect(tile.hasAttribute("data-speaking")).toBe(true);
    expect(
      tile.querySelector('[data-slot="led"][data-follow="speaking"]'),
    ).not.toBeNull();
  });

  it("names your own tile 'Jon (you)'", () => {
    const { getByText } = render(
      <TooltipProvider>
        <ParticipantCard
          {...props({ item: item({ name: "Jon", isLocal: true }) })}
        />
      </TooltipProvider>,
    );
    expect(getByText("Jon (you)")).toBeTruthy();
  });
});
