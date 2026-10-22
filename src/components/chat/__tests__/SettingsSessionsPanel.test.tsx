// @vitest-environment jsdom

import { apiGet } from "@/lib/api-client";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionsPanel from "../settings/SessionsPanel";

vi.mock("@/lib/api-client", () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
}));

describe("SessionsPanel", () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("updates relative ages after mount and preserves wording at boundaries", async () => {
    const referenceTime = Date.parse("2026-03-10T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(referenceTime);
    vi.mocked(apiGet).mockResolvedValue({
      sessions: [
        {
          id: "less-than-minute",
          isCurrent: false,
          lastActiveAt: referenceTime - 30_000,
          activity: { browserName: "Browser", deviceType: "Desktop" },
        },
        {
          id: "one-hour",
          isCurrent: false,
          lastActiveAt: referenceTime - 60 * 60 * 1000,
          activity: { browserName: "Browser", deviceType: "Desktop" },
        },
        {
          id: "one-day",
          isCurrent: false,
          lastActiveAt: referenceTime - 24 * 60 * 60 * 1000,
          activity: { browserName: "Browser", deviceType: "Desktop" },
        },
        {
          id: "iso-two-hours",
          isCurrent: false,
          lastActiveAt: new Date(
            referenceTime - 2 * 60 * 60 * 1000,
          ).toISOString(),
          activity: { browserName: "Browser", deviceType: "Desktop" },
        },
        {
          id: "malformed",
          isCurrent: false,
          lastActiveAt: "not-a-timestamp",
          activity: { browserName: "Browser", deviceType: "Desktop" },
        },
      ],
    });

    render(<SessionsPanel />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/less than a minute ago/)).toBeInTheDocument();
    expect(screen.getByText(/1 hour ago/)).toBeInTheDocument();
    expect(screen.getByText(/1 day ago/)).toBeInTheDocument();
    expect(screen.getByText(/2 hours ago/)).toBeInTheDocument();
    expect(screen.getByText(/Unknown time/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
