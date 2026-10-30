// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppActiveRoot,
  computeAppActive,
  setAppOccluded,
  useAppActive,
} from "@/hooks/useAppActive";
import { useIsSpeaking, useSpeakingAttr } from "@/hooks/useIsSpeaking";
import { selectIsSpeaking, useChatStore } from "@/stores/chat-store";

const base = {
  visible: true,
  focused: true,
  minimized: false,
  occluded: false,
};

describe("computeAppActive", () => {
  it("is inactive when the document is hidden", () => {
    expect(computeAppActive({ ...base, visible: false }, false)).toBe(false);
  });

  it("keeps an unfocused web tab active", () => {
    expect(computeAppActive({ ...base, focused: false }, false)).toBe(true);
  });

  it("desktop: minimised, or unfocused and covered, is inactive", () => {
    expect(computeAppActive({ ...base, minimized: true }, true)).toBe(false);
    expect(
      computeAppActive({ ...base, focused: false, occluded: true }, true),
    ).toBe(false);
    // Unfocused but visible (a stream on a second monitor) stays active.
    expect(computeAppActive({ ...base, focused: false }, true)).toBe(true);
    // Focused wins over a stale occlusion signal.
    expect(computeAppActive({ ...base, occluded: true }, true)).toBe(true);
  });
});

describe("AppActiveRoot", () => {
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  it("mirrors visibility onto <html data-app-inactive>", () => {
    function Probe() {
      return <span data-testid="probe">{String(useAppActive())}</span>;
    }
    render(
      <>
        <AppActiveRoot />
        <Probe />
      </>,
    );
    expect(document.documentElement.hasAttribute("data-app-inactive")).toBe(
      false,
    );

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.documentElement.hasAttribute("data-app-inactive")).toBe(
      true,
    );
    expect(screen.getByTestId("probe").textContent).toBe("false");

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.documentElement.hasAttribute("data-app-inactive")).toBe(
      false,
    );
  });

  it("ignores occlusion on the web", () => {
    render(<AppActiveRoot />);
    act(() => setAppOccluded(true));
    expect(document.documentElement.hasAttribute("data-app-inactive")).toBe(
      false,
    );
    act(() => setAppOccluded(false));
  });
});

describe("useIsSpeaking", () => {
  afterEach(() => {
    act(() => useChatStore.setState({ speakingUsers: {} }));
  });

  it("selects one user's flag", () => {
    const state = { speakingUsers: { ada: true, grace: false } };
    expect(selectIsSpeaking("ada")(state)).toBe(true);
    expect(selectIsSpeaking("grace")(state)).toBe(false);
    expect(selectIsSpeaking(null)(state)).toBe(false);
  });

  it("re-renders only the leaf whose user flipped", () => {
    const onRender = vi.fn();
    const renders = () => ({
      ada: onRender.mock.calls.filter(([id]) => id === "ada").length,
      grace: onRender.mock.calls.filter(([id]) => id === "grace").length,
    });
    function Leaf({ id }: { id: string }) {
      onRender(id);
      const attr = useSpeakingAttr(id);
      return <span data-testid={id} {...attr} />;
    }
    render(
      <>
        <Leaf id="ada" />
        <Leaf id="grace" />
      </>,
    );
    expect(renders()).toEqual({ ada: 1, grace: 1 });

    act(() => useChatStore.setState({ speakingUsers: { ada: true } }));
    expect(screen.getByTestId("ada").hasAttribute("data-speaking")).toBe(true);
    expect(screen.getByTestId("grace").hasAttribute("data-speaking")).toBe(
      false,
    );
    expect(renders()).toEqual({ ada: 2, grace: 1 });

    // Another user's flip leaves both leaves alone if their own flag holds.
    act(() =>
      useChatStore.setState({ speakingUsers: { ada: true, linus: true } }),
    );
    expect(renders()).toEqual({ ada: 2, grace: 1 });
  });

  it("is a plain boolean hook", () => {
    function Probe() {
      return <span data-testid="p">{String(useIsSpeaking("ada"))}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId("p").textContent).toBe("false");
  });
});
