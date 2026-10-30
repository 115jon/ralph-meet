import { describe, expect, it } from "vitest";

import { renderToStaticMarkup } from "react-dom/server";

import { Button, buttonVariants } from "../button";

describe("Button disabled (rule 9.7)", () => {
  it.each(["default", "primary", "danger"] as const)(
    "%s goes tonal instead of fading",
    (variant) => {
      const classes = buttonVariants({ variant }).split(/\s+/);
      expect(classes).toEqual(
        expect.arrayContaining([
          "disabled:bg-tint-2",
          "disabled:text-ink-3",
          "disabled:opacity-100",
        ]),
      );
    },
  );

  it("drops the 45% fade from a rendered default button", () => {
    const html = renderToStaticMarkup(<Button disabled>Join room</Button>);
    expect(html).toContain("disabled:bg-tint-2");
    expect(html).not.toContain("disabled:opacity-45");
  });

  it.each(["secondary", "ghost", "outline", "destructive"] as const)(
    "%s keeps the DISABLED opacity",
    (variant) => {
      const classes = buttonVariants({ variant }).split(/\s+/);
      expect(classes).toContain("disabled:opacity-45");
      expect(classes).not.toContain("disabled:bg-tint-2");
    },
  );
});
