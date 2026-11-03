// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ThemeAwareSplashLogo } from "../ThemeAwareSplashLogo";

const splashStyles = readFileSync(
  resolve(process.cwd(), "src/styles.css"),
  "utf8",
);

describe("ThemeAwareSplashLogo", () => {
  it("does not render different image attributes during hydration", async () => {
    const originalClassName = document.documentElement.className;
    const originalTheme = window.localStorage.getItem("theme");
    let container: HTMLDivElement | undefined;
    let consoleError: ReturnType<typeof vi.spyOn> | undefined;
    let root: Root | undefined;

    try {
      document.documentElement.className = "";
      window.localStorage.removeItem("theme");
      const serverMarkup = renderToString(<ThemeAwareSplashLogo alt="Yap" />);
      container = document.createElement("div");
      container.innerHTML = serverMarkup;
      document.body.appendChild(container);

      document.documentElement.className = "light";
      consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      await act(async () => {
        root = hydrateRoot(
          container as HTMLDivElement,
          <ThemeAwareSplashLogo alt="Yap" />,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const hydrationWarnings = consoleError.mock.calls.filter(
        ([message]: unknown[]) =>
          typeof message === "string" &&
          message.includes(
            "A tree hydrated but some attributes of the server rendered HTML didn't match",
          ),
      );
      expect(hydrationWarnings).toHaveLength(0);
    } finally {
      try {
        if (root) {
          act(() => root?.unmount());
        }
      } finally {
        consoleError?.mockRestore();
        container?.remove();
        document.documentElement.className = originalClassName;
        if (originalTheme === null) {
          window.localStorage.removeItem("theme");
        } else {
          window.localStorage.setItem("theme", originalTheme);
        }
      }
    }
  });

  it("keeps the mark in its own colours in every theme", () => {
    // Yappy is pink with black features on light and dark grounds alike, so
    // no theme recolours it (the old white mark was filtered black on light).
    expect(splashStyles).not.toContain(".theme-aware-splash-logo");
  });
});
