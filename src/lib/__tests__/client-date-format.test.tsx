// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatClientDate,
  useClientDateFormatter,
} from "../client-date-format";

const TEST_TIMESTAMP = "2024-03-05T14:06:07.000Z";
const TEST_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function DateProbe() {
  const formatDate = useClientDateFormatter();
  return <time>{formatDate(TEST_TIMESTAMP, TEST_OPTIONS)}</time>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("client date formatting", () => {
  it("keeps SSR markup stable before switching to the browser locale", async () => {
    const OriginalDateTimeFormat = Intl.DateTimeFormat;
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      function MockDateTimeFormat(
        this: Intl.DateTimeFormat,
        locales?: string | string[],
        options?: Intl.DateTimeFormatOptions,
      ) {
        return new OriginalDateTimeFormat(
          locales === undefined ? "de-DE" : locales,
          options,
        );
      } as unknown as typeof Intl.DateTimeFormat,
    );

    const serverMarkup = renderToString(<DateProbe />);
    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.appendChild(container);

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let root: Root | undefined;

    try {
      await act(async () => {
        root = hydrateRoot(container, <DateProbe />);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const hydrationWarnings = consoleError.mock.calls.filter(
        ([message]: unknown[]) =>
          typeof message === "string" &&
          message.includes("A tree hydrated but some attributes"),
      );
      expect(hydrationWarnings).toHaveLength(0);
      expect(serverMarkup).toContain(
        new OriginalDateTimeFormat("en-US", {
          ...TEST_OPTIONS,
          timeZone: "UTC",
        }).format(new Date(TEST_TIMESTAMP)),
      );
      expect(container.textContent).toBe(
        new OriginalDateTimeFormat("de-DE", TEST_OPTIONS).format(
          new Date(TEST_TIMESTAMP),
        ),
      );
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });

  it("uses explicit UTC formatting for the server snapshot", () => {
    expect(formatClientDate(TEST_TIMESTAMP, TEST_OPTIONS, false)).toBe(
      new Intl.DateTimeFormat("en-US", {
        ...TEST_OPTIONS,
        timeZone: "UTC",
      }).format(new Date(TEST_TIMESTAMP)),
    );
  });

  it("returns a stable fallback for invalid dates", () => {
    expect(formatClientDate("not-a-date", TEST_OPTIONS, false)).toBe(
      "Unknown time",
    );
    expect(formatClientDate(new Date(Number.NaN), TEST_OPTIONS, true)).toBe(
      "Unknown time",
    );
    expect(
      formatClientDate(TEST_TIMESTAMP, { timeZone: "Invalid/Zone" }, true),
    ).toBe("Unknown time");
  });
});
