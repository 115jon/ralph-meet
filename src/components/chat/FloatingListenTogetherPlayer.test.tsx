// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FloatingListenTogetherPlayer } from "./FloatingListenTogetherPlayer";

const mocked = vi.hoisted(() => ({
  playback: {
    currentEntry: {
      entryId: "entry-1",
      track: { title: "Night Drive", artworkUrl: "https://cdn.test/art.webp" },
    },
  } as { currentEntry: unknown },
  phone: false,
}));

vi.mock("./listen-together-playback", () => ({
  useListenTogetherPlaybackState: () => mocked.playback,
}));

vi.mock("@/hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMediaQuery")>()),
  useIsMobile: () => mocked.phone,
}));

vi.mock("./ListenTogetherNowPlayingCard", () => ({
  ListenTogetherNowPlayingCard: ({ variant }: { variant: string }) => (
    <div data-testid={`now-playing-${variant}`}>Night Drive</div>
  ),
}));

describe("FloatingListenTogetherPlayer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocked.playback = {
      currentEntry: {
        entryId: "entry-1",
        track: {
          title: "Night Drive",
          artworkUrl: "https://cdn.test/art.webp",
        },
      },
    };
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not force a layout measurement when it mounts", () => {
    const getBoundingClientRect = vi.spyOn(
      HTMLElement.prototype,
      "getBoundingClientRect",
    );
    render(<FloatingListenTogetherPlayer sfu={null} roomSlug="voice-room-1" />);
    expect(getBoundingClientRect).not.toHaveBeenCalled();
  });

  it("renders nothing when nothing is playing", () => {
    mocked.playback = { currentEntry: null };
    render(<FloatingListenTogetherPlayer sfu={null} roomSlug="voice-room-1" />);
    expect(screen.queryByTestId("floating-listen-together-player")).toBeNull();
  });

  it("shows the mini card on desktop and the pill on a phone", () => {
    mocked.phone = false;
    const { unmount } = render(
      <FloatingListenTogetherPlayer sfu={null} roomSlug="voice-room-1" />,
    );
    expect(screen.getByTestId("now-playing-mini")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Minimise now playing" }),
    ).toBeInTheDocument();
    unmount();

    mocked.phone = true;
    render(<FloatingListenTogetherPlayer sfu={null} roomSlug="voice-room-1" />);
    expect(screen.getByTestId("now-playing-pill")).toBeInTheDocument();
    expect(screen.queryByTestId("now-playing-mini")).toBeNull();
    expect(
      screen.getByTestId("floating-listen-together-player"),
    ).toHaveAttribute("data-mode", "compact");
  });

  it("minimises to the track artwork", () => {
    window.localStorage.setItem(
      "rm:floating:v1:listen-together",
      JSON.stringify({ corner: "bottom-right", minimized: true }),
    );
    render(<FloatingListenTogetherPlayer sfu={null} roomSlug="voice-room-1" />);
    const bubble = screen.getByRole("button", { name: "Open now playing" });
    expect(bubble.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.test/art.webp",
    );
  });
});
