// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { FloatingSurface } from "../FloatingSurface";

const viewport = vi.hoisted(() => ({ phone: false }));

vi.mock("@/hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMediaQuery")>()),
  useIsMobile: () => viewport.phone,
}));

const SIZE = { width: 300, height: 56 };

beforeAll(() => {
  // Report a fixed size for every observed player.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: SIZE.width, height: SIZE.height },
              borderBoxSize: [
                { inlineSize: SIZE.width, blockSize: SIZE.height },
              ],
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
  });
}

let clock = 0;
beforeEach(() => {
  window.localStorage.clear();
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document
    .querySelectorAll("[data-floating-avoid]")
    .forEach((el) => el.remove());
});

function renderPlayer(onPlay = vi.fn()) {
  render(
    <FloatingSurface
      id="test-player"
      label="Now playing"
      testId="player"
      width={{ min: 280, max: 440, default: 300 }}
      portal={false}
      bubble={<span>art</span>}
      compact={
        <div>
          <p>Night Drive</p>
          <button type="button" onClick={onPlay}>
            Pause
          </button>
        </div>
      }
      sheet={<p>Full controls</p>}
    >
      <p>Desktop body</p>
    </FloatingSurface>,
  );
  return screen.getByTestId("player");
}

async function placedAt(root: HTMLElement, x: number, y: number) {
  await waitFor(() =>
    expect(root.style.transform).toBe(`translate3d(${x}px, ${y}px, 0)`),
  );
}

function drag(
  el: Element,
  root: HTMLElement,
  points: Array<[number, number, number]>,
) {
  const [first, ...rest] = points;
  clock = first![2];
  fireEvent.pointerDown(el, {
    pointerId: 1,
    button: 0,
    pointerType: "touch",
    clientX: first![0],
    clientY: first![1],
  });
  for (const [x, y, t] of rest) {
    clock = t;
    fireEvent.pointerMove(root, { pointerId: 1, clientX: x, clientY: y });
  }
  fireEvent.pointerUp(root, { pointerId: 1 });
}

describe("FloatingSurface on desktop", () => {
  beforeEach(() => {
    viewport.phone = false;
    setViewport(1280, 800);
  });

  it("parks in the bottom-right corner with a header and minimise", async () => {
    const root = renderPlayer();
    await placedAt(root, 1280 - 16 - 300, 800 - 16 - 56);
    // Transparent only for the frame it takes to measure.
    expect(screen.getByRole("region", { name: "Now playing" })).toBeVisible();
    expect(screen.getByText("Desktop body")).toBeInTheDocument();
    expect(root).toHaveAttribute("data-corner", "bottom-right");
  });

  it("drags from the header and snaps to the corner it was dropped near", async () => {
    const root = renderPlayer();
    await placedAt(root, 964, 728);
    drag(screen.getByText("Now playing"), root, [
      [1000, 740, 0],
      [800, 600, 100],
      [200, 120, 400],
      [190, 110, 600],
    ]);
    expect(root).toHaveAttribute("data-corner", "top-left");
    await placedAt(root, 16, 64);
    expect(
      JSON.parse(window.localStorage.getItem("rm:floating:v1:test-player")!),
    ).toMatchObject({ corner: "top-left" });
  });

  it("moves by keyboard and by clicking the move handle", async () => {
    const user = userEvent.setup();
    const root = renderPlayer();
    const handle = screen.getByRole("button", { name: "Move now playing" });
    handle.focus();
    await user.keyboard("{ArrowUp}");
    expect(root).toHaveAttribute("data-corner", "top-right");
    await user.keyboard("{ArrowLeft}");
    expect(root).toHaveAttribute("data-corner", "top-left");
    await user.click(handle);
    expect(root).toHaveAttribute("data-corner", "top-right");
  });

  it("resizes with the edge slider and keeps the width", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const slider = screen.getByRole("slider", { name: "Now playing width" });
    expect(slider).toHaveAttribute("aria-valuenow", "300");
    slider.focus();
    // Anchored right, so the free edge is on the left: ArrowLeft grows it.
    await user.keyboard("{ArrowLeft}");
    expect(slider).toHaveAttribute("aria-valuenow", "320");
    await user.keyboard("{End}");
    expect(slider).toHaveAttribute("aria-valuenow", "440");
    expect(
      JSON.parse(window.localStorage.getItem("rm:floating:v1:test-player")!),
    ).toMatchObject({ width: 440 });
  });

  it("minimises to a bubble and restores, keeping focus on the player", async () => {
    const user = userEvent.setup();
    const root = renderPlayer();
    await user.click(
      screen.getByRole("button", { name: "Minimise now playing" }),
    );
    const bubble = screen.getByRole("button", { name: "Open now playing" });
    expect(root).toHaveAttribute("data-mode", "bubble");
    expect(bubble).toHaveFocus();
    expect(screen.queryByText("Desktop body")).toBeNull();
    await user.click(bubble);
    expect(root).toHaveAttribute("data-mode", "full");
    expect(
      screen.getByRole("button", { name: "Minimise now playing" }),
    ).toHaveFocus();
  });

  it("restores its saved corner and minimised state", () => {
    window.localStorage.setItem(
      "rm:floating:v1:test-player",
      JSON.stringify({ corner: "top-left", minimized: true }),
    );
    const root = renderPlayer();
    expect(root).toHaveAttribute("data-corner", "top-left");
    expect(root).toHaveAttribute("data-mode", "bubble");
  });
});

describe("FloatingSurface on a phone", () => {
  beforeEach(() => {
    viewport.phone = true;
    setViewport(390, 844);
  });

  it("starts as a compact pill, not the desktop card", async () => {
    const root = renderPlayer();
    expect(root).toHaveAttribute("data-mode", "compact");
    expect(screen.getByText("Night Drive")).toBeInTheDocument();
    expect(screen.queryByText("Desktop body")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
    await placedAt(root, 390 - 12 - 300, 844 - 12 - 56);
  });

  it("sits above the composer or tab bar", async () => {
    const composer = document.createElement("div");
    composer.setAttribute("data-floating-avoid", "");
    composer.getBoundingClientRect = () =>
      ({
        top: 760,
        bottom: 844,
        left: 0,
        right: 390,
        width: 390,
        height: 84,
      }) as DOMRect;
    document.body.appendChild(composer);
    const root = renderPlayer();
    await placedAt(root, 78, 844 - (844 - 760 + 8) - 56);
  });

  it("taps open a sheet; its controls don't", async () => {
    const onPlay = vi.fn();
    const user = userEvent.setup();
    renderPlayer(onPlay);
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPlay).toHaveBeenCalled();
    expect(screen.queryByText("Full controls")).toBeNull();
    await user.click(screen.getByText("Night Drive"));
    expect(await screen.findByText("Full controls")).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "Now playing position" }),
    ).toBeVisible();
  });

  it("a flick carries it to the far corner; a slow drop stays near", async () => {
    const root = renderPlayer();
    await placedAt(root, 78, 776);
    const pill = screen.getByText("Night Drive");
    // Fast flick up-left from the bottom-right: momentum wins.
    drag(pill, root, [
      [300, 800, 0],
      [280, 760, 10],
      [250, 700, 20],
    ]);
    expect(root).toHaveAttribute("data-corner", "top-left");

    // Slow move of the same size from top-left, ending in the top half.
    drag(pill, root, [
      [100, 100, 1000],
      [120, 130, 1400],
      [130, 150, 1800],
    ]);
    expect(root).toHaveAttribute("data-corner", "top-left");
  });

  it("a drag never opens the sheet", async () => {
    const root = renderPlayer();
    await placedAt(root, 78, 776);
    const pill = screen.getByText("Night Drive");
    drag(pill, root, [
      [300, 800, 0],
      [250, 500, 300],
      [240, 480, 600],
    ]);
    fireEvent.click(pill);
    await act(async () => {});
    expect(screen.queryByText("Full controls")).toBeNull();
  });

  it("minimises from the sheet to a bubble", async () => {
    const user = userEvent.setup();
    const root = renderPlayer();
    await user.click(screen.getByText("Night Drive"));
    await user.click(await screen.findByRole("button", { name: "Minimise" }));
    expect(root).toHaveAttribute("data-mode", "bubble");
  });
});
