// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMessageDate } from "../MessageItem";
import { formatClientDate } from "@/lib/client-date-format";

const REFERENCE_TIME = Date.parse("2024-03-05T14:06:07.000Z");

const formatStableDate = (
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
) => formatClientDate(value, options, false);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MessageItem date helper", () => {
  it("keeps invalid message dates on the stable fallback instead of classifying them as today", () => {
    expect(
      formatMessageDate("not-a-date", formatStableDate, REFERENCE_TIME),
    ).toBe("Unknown time");
  });
});
