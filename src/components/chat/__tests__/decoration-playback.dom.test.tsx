// @vitest-environment jsdom

import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DECORATION_PLAY_ATTR, ProfileAssetLayer } from "../ProfileAssetLayer";
import { ProfileDisplayName } from "../ProfileDisplayName";

vi.mock("@/hooks/useCustomEmojiLookup", () => ({
  useCustomEmojiLookup: () => ({}),
}));

const gradient = {
  font: "gg-sans",
  effect: "gradient",
  primaryColor: "#FF5577",
  secondaryColor: "#5577FF",
} as const;

function nameSpan(container: HTMLElement) {
  return container.querySelector("button span") as HTMLSpanElement;
}

/** The playing layer of a gradient name, or "" while it rests. */
function playingAnimation(container: HTMLElement) {
  const overlay = container.querySelector<HTMLSpanElement>(
    "[data-display-name-overlay]",
  );
  return overlay?.style.animation ?? "";
}

describe("decoration playback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a name effect static in its row until the row is hovered or focused", () => {
    const { container } = render(
      <ul>
        <li>
          <button type="button">
            <ProfileDisplayName text="Ralph" displayNameStyle={gradient} />
          </button>
        </li>
      </ul>,
    );
    const span = nameSpan(container);
    const row = container.querySelector("button")!;
    expect(span.style.animation).toBe("");
    expect(span.style.willChange).toBe("");
    expect(playingAnimation(container)).toBe("");

    fireEvent.pointerEnter(row);
    expect(playingAnimation(container)).toContain("rm-display-name-gradient");
    // The resting name itself never animates.
    expect(span.style.animation).toBe("");
    // The playing copy is decorative: the name is announced once.
    expect(
      container.querySelector("[data-display-name-overlay]"),
    ).toHaveAttribute("aria-hidden", "true");
    fireEvent.pointerLeave(row);
    expect(playingAnimation(container)).toBe("");

    act(() => row.focus());
    expect(playingAnimation(container)).toContain("rm-display-name-gradient");
    act(() => row.blur());
    expect(playingAnimation(container)).toBe("");
  });

  it("plays continuously inside an open profile surface", () => {
    const { container } = render(
      <div {...{ [DECORATION_PLAY_ATTR]: "" }}>
        <button type="button">
          <ProfileDisplayName text="Ralph" displayNameStyle={gradient} />
        </button>
      </div>,
    );
    expect(playingAnimation(container)).toContain("rm-display-name-gradient");
  });

  it("never plays under reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { container } = render(
      <button type="button">
        <ProfileDisplayName text="Ralph" displayNameStyle={gradient} animate />
      </button>,
    );
    expect(playingAnimation(container)).toBe("");
    expect(nameSpan(container).style.animation).toBe("");
    vi.unstubAllGlobals();
  });

  it("holds a hover nameplate video on its first frame until its row is hovered", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    const { container } = render(
      <div data-testid="row">
        <ProfileAssetLayer
          url="/nameplates/wave.webm"
          contentType="video/webm"
          alt="nameplate"
          playVideo="hover"
        />
      </div>,
    );
    const video = container.querySelector("video")!;
    expect(video.autoplay).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();

    fireEvent.pointerEnter(container.querySelector('[data-testid="row"]')!);
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.pointerLeave(container.querySelector('[data-testid="row"]')!);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("plays a profile video by default (open profile surfaces)", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    render(
      <div>
        <ProfileAssetLayer
          url="/banners/loop.mp4"
          contentType="video/mp4"
          alt="banner"
        />
      </div>,
    );
    expect(play).toHaveBeenCalledTimes(1);
  });
});
