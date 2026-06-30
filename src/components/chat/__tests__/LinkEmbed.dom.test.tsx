// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LinkEmbed } from "../LinkEmbed";
import type { EmbedInfo } from "@/lib/types";

function makeQuotedEmbed(rawDescription: string): EmbedInfo {
  return {
    id: "embed_quote_long_text_dom",
    url: "https://x.com/example/status/quote-long-text-dom",
    type: "rich",
    provider: { name: "X", url: "https://x.com" },
    footer: { text: "X" },
    rawDescription: "main post",
    referencedTweet: {
      type: "quoted",
      url: "https://x.com/original/status/quote-long-dom",
      rawDescription,
      author: {
        name: "Original Author (@original)",
        url: "https://twitter.com/original",
      },
    },
    fields: [],
  };
}

function makeStandaloneEmbed(rawDescription: string): EmbedInfo {
  return {
    id: "embed_standalone_long_text_dom",
    url: "https://x.com/example/status/standalone-long-text-dom",
    type: "rich",
    provider: { name: "X", url: "https://x.com" },
    footer: { text: "X" },
    author: {
      name: "Example Author (@example)",
      url: "https://twitter.com/example",
    },
    rawDescription,
    fields: [],
  };
}

describe("LinkEmbed DOM rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("expands oversized standalone tweet text with a show more button", () => {
    render(
      <LinkEmbed
        embed={makeStandaloneEmbed([
          "PVE // JUNGLE // MISSION",
          "",
          "VOSHIL SEES THE F/BAR",
          "PVE JUNGLE MISSION",
          "TOMORROW THE WALLS",
          "AND THE SIGNAL KEEPS GOING",
        ].join("\n"))}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Expand post text" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Show more");

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Collapse post text" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Show less")).toBeInTheDocument();
  });

  it("does not render the standalone show more button for shorter tweet text", () => {
    render(
      <LinkEmbed
        embed={makeStandaloneEmbed("short standalone post")}
      />,
    );

    expect(screen.queryByRole("button", { name: "Expand post text" })).not.toBeInTheDocument();
  });

  it("expands oversized referenced tweet text on demand", () => {
    render(
      <LinkEmbed
        embed={makeQuotedEmbed([
          "giving away a FREE MiniMax API key worth BILLIONS (330M+ tokens daily, No Rate Limits) 😳",
          "",
          "All MiniMax models included-",
          "text to video",
          "image generation",
          "music generation",
        ].join("\n"))}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Expand quoted post text" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Collapse quoted post text" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Show less")).toBeInTheDocument();
  });

  it("does not render the expand affordance for shorter referenced tweet text", () => {
    render(
      <LinkEmbed
        embed={makeQuotedEmbed("short quoted post")}
      />,
    );

    expect(screen.queryByRole("button", { name: "Expand quoted post text" })).not.toBeInTheDocument();
  });

  it("hides the quoted tweet ellipsis affordance when the measured text does not actually overflow", async () => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function(this: HTMLElement) {
      return this.dataset.xExpandableText === "true" ? 96 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function(this: HTMLElement) {
      return this.dataset.xExpandableText === "true" ? 96 : 0;
    });

    render(
      <LinkEmbed
        embed={makeQuotedEmbed("A".repeat(260))}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Expand quoted post text" })).not.toBeInTheDocument();
    });
  });
});
