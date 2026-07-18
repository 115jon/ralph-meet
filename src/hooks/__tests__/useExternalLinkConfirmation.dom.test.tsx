// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExternalLinkConfirmation } from "@/hooks/useExternalLinkConfirmation";

function TestHarness() {
  const { requestOpen, confirmation } = useExternalLinkConfirmation();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          requestOpen("https://gif.fxtwitter.com/tweet_video/test.webp")
        }
      >
        Open external media
      </button>
      <button type="button" onClick={() => requestOpen("javascript:alert(1)")}>
        Open unsafe media
      </button>
      {confirmation}
    </>
  );
}

describe("useExternalLinkConfirmation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("confirms an untrusted host and persists the trust choice", () => {
    render(<TestHarness />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open external media" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Leaving Ralph Meet" }),
    ).toBeVisible();
    expect(screen.getByText(/gif\.fxtwitter\.com\/tweet_video/)).toBeVisible();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Trust gif.fxtwitter.com links from now on",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Visit Site" }));

    expect(window.open).toHaveBeenCalledWith(
      "https://gif.fxtwitter.com/tweet_video/test.webp",
      "_blank",
      "noopener,noreferrer",
    );
    expect(
      window.localStorage.getItem("ralph-meet:trusted-external-link-domains"),
    ).toContain("gif.fxtwitter.com");
  });

  it("opens trusted hosts without showing the confirmation modal", () => {
    window.localStorage.setItem(
      "ralph-meet:trusted-external-link-domains",
      JSON.stringify(["gif.fxtwitter.com"]),
    );

    render(<TestHarness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open external media" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Leaving Ralph Meet" }),
    ).toBeNull();
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it("does not open unsupported URL schemes", () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open unsafe media" }));

    expect(window.open).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
