// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AvatarImage } from "@/components/chat/AvatarImage";

describe("AvatarImage", () => {
  it("renders the source image using stored crop instructions without changing the URL", () => {
    render(
      <AvatarImage
        src="/api/avatars/user.png?v=123"
        alt="Ada"
        display={{
          version: 1,
          crop: { x: 25, y: 10, width: 50, height: 50 },
        }}
      />,
    );

    const image = screen.getByAltText("Ada");
    expect(image).toHaveAttribute("src", "/api/avatars/user.png?v=123");
    expect(image).toHaveStyle({
      left: "-50%",
      top: "-20%",
      width: "200%",
      height: "200%",
      objectFit: "fill",
    });
    expect(image.parentElement).toHaveClass("rounded-[inherit]");
    expect(image.parentElement?.parentElement).toHaveClass("rounded-[inherit]");
  });

  it("scales avatar decorations slightly beyond the avatar circle", () => {
    const { container } = render(
      <AvatarImage
        src="/api/avatars/user.png"
        alt="Ada"
        display={{
          version: 1,
          collectibles: {
            avatarDecoration: {
              skuId: "decor-1",
              name: "Halo",
              asset: "halo",
              imageUrl:
                "https://cdn.discordapp.com/avatar-decoration-presets/halo.png",
            },
          },
        }}
      />,
    );

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[1]).toHaveClass(
      "left-1/2",
      "top-1/2",
      "h-[124%]",
      "w-[124%]",
      "-translate-x-1/2",
      "-translate-y-1/2",
    );
  });
});
