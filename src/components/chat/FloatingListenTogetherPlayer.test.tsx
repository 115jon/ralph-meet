// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ListenTogetherPlaybackState } from "./listen-together-playback";
import { FloatingListenTogetherPlayer } from "./FloatingListenTogetherPlayer";

vi.mock("./ListenTogetherNowPlayingCard", () => ({
  ListenTogetherNowPlayingCard: () => (
    <div data-testid="now-playing-content">Track One</div>
  ),
}));

describe("FloatingListenTogetherPlayer", () => {
  it("moves with pointer drag while leaving interactive controls available", () => {
    const playback = {
      currentEntry: { entryId: "entry-1" },
    } as ListenTogetherPlaybackState;
    render(<FloatingListenTogetherPlayer playback={playback} sfu={null} />);

    const player = screen.getByTestId("floating-listen-together-player");
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    player.setPointerCapture = setPointerCapture;
    player.hasPointerCapture = () => true;
    player.releasePointerCapture = releasePointerCapture;
    player.getBoundingClientRect = () =>
      ({ left: 100, top: 100, width: 340, height: 100 }) as DOMRect;

    fireEvent.pointerDown(player, {
      button: 0,
      pointerId: 1,
      clientX: 120,
      clientY: 120,
    });
    fireEvent.pointerMove(player, {
      pointerId: 1,
      clientX: 220,
      clientY: 200,
    });
    fireEvent.pointerUp(player, { pointerId: 1 });

    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(player.style.left).toBe("200px");
    expect(player.style.top).toBe("180px");
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });
});
