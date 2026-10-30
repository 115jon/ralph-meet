// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import type { AvatarDisplay } from "@/lib/avatar-display";

const STATIC_FRAME =
  "https://cdn.discordapp.com/assets/content/static-frame.png";

/** Fresh object every call: a re-render hands the layer a new `display`. */
function display(skuId = "fx-1"): AvatarDisplay {
  return {
    version: 1,
    collectibles: {
      profileEffect: {
        skuId,
        name: "Test Effect",
        staticFrameSrc: STATIC_FRAME,
        effectUrls: ["https://cdn.discordapp.com/assets/content/intro.webm"],
        effects: [
          {
            src: "https://cdn.discordapp.com/assets/content/intro.webm",
            start: 0,
            duration: 3000,
            loop: false,
          },
          {
            src: "https://cdn.discordapp.com/assets/content/loop.webm",
            start: 500,
            duration: 5000,
            loop: true,
            loopDelay: 2400,
          },
        ],
      },
    },
  };
}

function setReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/**
 * Advance the clock in steps, flushing React between them: each timer the
 * layer arms is scheduled by an effect after the previous one fired.
 */
async function advance(ms: number, stepMs = 100) {
  let left = ms;
  do {
    const step = Math.min(stepMs, left);
    await act(async () => {
      vi.advanceTimersByTime(step);
    });
    left -= step;
  } while (left > 0);
}

function playback(container: HTMLElement) {
  return container
    .querySelector("[data-effect-playback]")
    ?.getAttribute("data-effect-playback");
}

function visibleVideos(container: HTMLElement) {
  return Array.from(container.querySelectorAll("video")).filter(
    (video) => video.style.visibility !== "hidden",
  );
}

describe("ProfileCollectiblesLayer playback", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "performance",
      ],
    });
    setReducedMotion(false);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("plays one pass on open, then rests on the still frame for good", async () => {
    const { container } = render(
      <ProfileCollectiblesLayer display={display()} />,
    );
    await advance(0);
    expect(playback(container)).toBe("playing");
    expect(visibleVideos(container).length).toBeGreaterThan(0);

    await advance(5_600);
    expect(playback(container)).toBe("rest");
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      STATIC_FRAME,
    );

    // Where the loop layer used to come back (every 7.4s): it stays at rest.
    await advance(60_000);
    expect(playback(container)).toBe("rest");
    expect(container.querySelector("video")).toBeNull();
  });

  it("does not replay on unrelated re-renders (status menu, field edits)", async () => {
    const { container, rerender } = render(
      <ProfileCollectiblesLayer display={display()} />,
    );
    await advance(5_600);
    expect(playback(container)).toBe("rest");

    // A new `display` object with the same effect, and other prop churn.
    rerender(
      <ProfileCollectiblesLayer display={display()} effectOpacity={0.9} />,
    );
    rerender(<ProfileCollectiblesLayer display={JSON.stringify(display())} />);
    await advance(100);
    expect(playback(container)).toBe("rest");
    expect(container.querySelector("video")).toBeNull();
  });

  it("does not restart mid-pass on re-render", async () => {
    const { container, rerender } = render(
      <ProfileCollectiblesLayer display={display()} />,
    );
    await advance(4_000);
    rerender(<ProfileCollectiblesLayer display={display()} />);
    // 4.0s + 1.6s = 5.6s from the original start: done, not restarted.
    await advance(1_600);
    expect(playback(container)).toBe("rest");
  });

  it("replays once on request, but only after the pass ended", async () => {
    const { container, rerender } = render(
      <ProfileCollectiblesLayer display={display()} replayKey={0} />,
    );
    await advance(1_000);
    // Mid-pass request (a hover while it plays): dropped.
    rerender(<ProfileCollectiblesLayer display={display()} replayKey={1} />);
    await advance(4_600);
    expect(playback(container)).toBe("rest");

    // Finished: the next request plays one more pass.
    rerender(<ProfileCollectiblesLayer display={display()} replayKey={2} />);
    await advance(0);
    expect(playback(container)).toBe("playing");
    expect(visibleVideos(container).length).toBeGreaterThan(0);
    await advance(5_600);
    expect(playback(container)).toBe("rest");
  });

  it("starts a new pass when the equipped effect changes", async () => {
    const { container, rerender } = render(
      <ProfileCollectiblesLayer display={display()} />,
    );
    await advance(5_600);
    rerender(<ProfileCollectiblesLayer display={display("fx-2")} />);
    await advance(0);
    expect(playback(container)).toBe("playing");
  });

  it("keeps the authored loop for shop stages", async () => {
    const { container } = render(
      <ProfileCollectiblesLayer display={display()} playback="loop" />,
    );
    await advance(8_000);
    expect(playback(container)).toBe("playing");
    expect(visibleVideos(container).length).toBe(1);
  });

  it("shows the still frame under reduced motion", async () => {
    setReducedMotion(true);
    const { container } = render(
      <ProfileCollectiblesLayer display={display()} />,
    );
    await advance(0);
    expect(playback(container)).toBe("still");
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      STATIC_FRAME,
    );
  });
});
