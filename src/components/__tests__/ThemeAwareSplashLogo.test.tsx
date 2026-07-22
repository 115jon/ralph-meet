// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ThemeAwareSplashLogo } from "../ThemeAwareSplashLogo";

const splashStyles = readFileSync(
  resolve(process.cwd(), "src/styles.css"),
  "utf8",
);

const lightLogoSelector =
  ":is(.light, .miku-light, .spiderman-light) .theme-aware-splash-logo";

function getLightLogoRule(): string {
  const ruleStart = splashStyles.indexOf(lightLogoSelector);
  const ruleEnd = splashStyles.indexOf("}", ruleStart);
  if (ruleStart < 0 || ruleEnd < 0) {
    throw new Error("Light splash logo rule is missing from styles.css");
  }

  return splashStyles.slice(ruleStart, ruleEnd + 1);
}

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
      const serverMarkup = renderToString(
        <ThemeAwareSplashLogo alt="Ralph Meet" />,
      );
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
          <ThemeAwareSplashLogo alt="Ralph Meet" />,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const hydrationWarnings = consoleError.mock.calls.filter(
        ([message]) =>
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

  it.each(["light", "miku-light", "spiderman-light"])(
    "applies the black logo filter for %s",
    (theme) => {
      const originalClassName = document.documentElement.className;
      let styleElement: HTMLStyleElement | undefined;
      let unmount: (() => void) | undefined;

      try {
        styleElement = document.createElement("style");
        styleElement.textContent = getLightLogoRule();
        document.head.appendChild(styleElement);
        document.documentElement.className = theme;
        const rendered = render(<ThemeAwareSplashLogo />);
        unmount = rendered.unmount;
        expect(
          window.getComputedStyle(
            rendered.container.querySelector(
              ".theme-aware-splash-logo",
            ) as HTMLImageElement,
          ).filter,
        ).toBe("brightness(0)");
      } finally {
        try {
          unmount?.();
        } finally {
          styleElement?.remove();
          document.documentElement.className = originalClassName;
        }
      }
    },
  );

  it.each(["dark", "miku-dark", "spiderman-dark"])(
    "does not apply the black logo filter for %s",
    (theme) => {
      const originalClassName = document.documentElement.className;
      let styleElement: HTMLStyleElement | undefined;
      let unmount: (() => void) | undefined;

      try {
        styleElement = document.createElement("style");
        styleElement.textContent = getLightLogoRule();
        document.head.appendChild(styleElement);
        document.documentElement.className = theme;
        const rendered = render(<ThemeAwareSplashLogo />);
        unmount = rendered.unmount;
        expect(
          window.getComputedStyle(
            rendered.container.querySelector(
              ".theme-aware-splash-logo",
            ) as HTMLImageElement,
          ).filter,
        ).not.toBe("brightness(0)");
      } finally {
        try {
          unmount?.();
        } finally {
          styleElement?.remove();
          document.documentElement.className = originalClassName;
        }
      }
    },
  );
});
