// @vitest-environment jsdom

/**
 * Desktop loads the emoji set lazily. Text that renders before it lands must
 * re-render once it does, without any prop change. Reproduces the desktop
 * setup: the static "@emoji-mart/data" import is empty, and the lazy set
 * reads as empty until the test releases it.
 */

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const lazySet = vi.hoisted(() => ({ released: false }));

vi.mock("@emoji-mart/data", () => ({
  default: { categories: [], emojis: {}, aliases: {} },
}));
vi.mock("@emoji-mart/data/sets/15/native.json", async () => {
  const real = (
    (await vi.importActual("@emoji-mart/data/sets/15/native.json")) as {
      default: Record<string, unknown>;
    }
  ).default;
  return {
    default: {
      get categories() {
        return lazySet.released ? real.categories : [];
      },
      get emojis() {
        return lazySet.released ? real.emojis : {};
      },
      get aliases() {
        return lazySet.released ? real.aliases : {};
      },
    },
  };
});
vi.mock("@/hooks/useCustomEmojiLookup", () => ({
  useCustomEmojiLookup: () => ({}),
}));

import { isEmojiDataReady, loadEmojiData } from "@/lib/emoji";
import { useEmojiDataReady } from "../useEmojiDataReady";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import EmojiToken from "@/components/chat/EmojiToken";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";

function ReadyProbe() {
  return <span data-testid="probe">{String(useEmojiDataReady())}</span>;
}

describe("useEmojiDataReady and inline emoji on lazily loaded data", () => {
  it("renders plain text first, then emoji once the set lands", async () => {
    // The module's own eager load found nothing yet.
    await loadEmojiData();
    expect(isEmojiDataReady()).toBe(false);

    render(
      <>
        <ReadyProbe />
        <InlineEmojiText text="ship it 😂" />
        <EmojiToken value=":tada:" />
        <MarkdownRenderer content="nice :fire: work" />
      </>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("false");
    expect(screen.queryByAltText(":joy:")).not.toBeInTheDocument();
    expect(screen.getByText("ship it 😂")).toBeInTheDocument();
    expect(screen.getByText(":tada:")).toBeInTheDocument();
    expect(screen.getByText("nice :fire: work")).toBeInTheDocument();

    lazySet.released = true;
    await act(async () => {
      await loadEmojiData();
    });

    expect(isEmojiDataReady()).toBe(true);
    expect(screen.getByTestId("probe")).toHaveTextContent("true");
    expect(screen.getByAltText(":joy:")).toBeInTheDocument();
    expect(screen.getByAltText(":tada:")).toBeInTheDocument();
    expect(screen.getByLabelText(":fire:")).toBeInTheDocument();
  });
});
