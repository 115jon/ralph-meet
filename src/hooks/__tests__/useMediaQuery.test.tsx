// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "../useMediaQuery";

function MediaQueryProbe({ query }: { query: string }) {
  const matches = useMediaQuery(query);
  return <span>{matches ? "desktop" : "mobile"}</span>;
}

afterEach(() => {
  cleanup();
});

describe("useMediaQuery", () => {
  it("cleans up legacy media-query listeners", () => {
    const query = "(max-width: 767px)";
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const mediaQuery = {
      media: query,
      matches: false,
      addListener,
      removeListener,
    } as unknown as MediaQueryList;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => mediaQuery),
    });

    const rendered = render(<MediaQueryProbe query={query} />);
    const listener = addListener.mock.calls[0]?.[0];

    expect(listener).toEqual(expect.any(Function));
    rendered.unmount();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });

  it("uses a stable server snapshot and updates from the change listener", () => {
    const query = "(min-width: 1024px)";
    const listeners = new Set<() => void>();
    const mediaQueryState = {
      media: query,
      matches: true,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.delete(listener);
      }),
    };
    const mediaQuery = mediaQueryState as unknown as MediaQueryList;
    const matchMedia = vi.fn(() => mediaQuery);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    const serverMarkup = renderToString(<MediaQueryProbe query={query} />);
    expect(serverMarkup).toContain("mobile");

    const rendered = render(<MediaQueryProbe query={query} />);
    expect(rendered.container).toHaveTextContent("desktop");
    expect(matchMedia).toHaveBeenCalled();
    expect(mediaQuery.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );

    mediaQueryState.matches = false;
    act(() => {
      for (const listener of listeners) listener();
    });
    expect(rendered.container).toHaveTextContent("mobile");

    rendered.unmount();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );

    const replacementMediaQuery = {
      ...mediaQueryState,
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    matchMedia.mockReturnValueOnce(replacementMediaQuery);
    const remounted = render(<MediaQueryProbe query={query} />);
    expect(remounted.container).toHaveTextContent("mobile");
    expect(matchMedia.mock.calls.length).toBeGreaterThan(1);
    remounted.unmount();
  });

  it("supports legacy media query listeners", () => {
    const query = "(max-width: 767px)";
    const legacyListener = vi.fn();
    const legacyUnlistener = vi.fn();
    const mediaQuery = {
      media: query,
      matches: true,
      addListener: legacyListener,
      removeListener: legacyUnlistener,
    } as unknown as MediaQueryList;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => mediaQuery),
    });

    const rendered = render(<MediaQueryProbe query={query} />);
    expect(rendered.container).toHaveTextContent("desktop");
    expect(legacyListener).toHaveBeenCalledWith(expect.any(Function));

    rendered.unmount();
    expect(legacyUnlistener).toHaveBeenCalledWith(expect.any(Function));
  });
});
