// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import sample from "@/lib/__fixtures__/yapper-catalog.sample.json";
import { displayWithCollectible } from "@/lib/collectible-selection";
import {
  primeCollectiblesCatalogCache,
  resetCollectiblesCatalogClient,
} from "@/lib/collectibles-catalog-client";
import {
  normalizeYapperCatalog,
  type CollectibleKind,
} from "@/lib/collectibles-catalog";

const mocks = vi.hoisted(() => ({
  apiPatch: vi.fn(),
  apiGet: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiPatch: mocks.apiPatch,
  apiGet: mocks.apiGet,
}));

import { CollectiblePicker } from "@/components/chat/collectibles/CollectiblePicker";

const catalog = normalizeYapperCatalog(sample, new Date().toISOString());
const escapeRe = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function renderPicker(
  kind: CollectibleKind,
  overrides: Partial<React.ComponentProps<typeof CollectiblePicker>> = {},
) {
  const onClose = vi.fn();
  const onApplied = vi.fn();
  render(
    <CollectiblePicker
      open
      kind={kind}
      displayName="Jon"
      username="@jon"
      currentDisplay={null}
      onClose={onClose}
      onApplied={onApplied}
      {...overrides}
    />,
  );
  return { onClose, onApplied };
}

beforeEach(() => {
  class IO {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("IntersectionObserver", IO);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView ??= () => {};
  resetCollectiblesCatalogClient();
  primeCollectiblesCatalogCache(catalog);
  mocks.apiGet.mockResolvedValue({ catalog });
  mocks.apiPatch.mockResolvedValue({
    ok: true,
    user: {
      avatar_display: null,
      nameplate_url: null,
      nameplate_content_type: null,
      updated_at: null,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("CollectiblePicker", () => {
  it("lists only its own kind, grouped by collection, with a none option", () => {
    renderPicker("nameplate");
    expect(
      screen.getByRole("dialog", { name: "Nameplate" }),
    ).toBeInTheDocument();
    const listbox = screen.getByRole("listbox", { name: "Nameplates" });
    const options = listbox.querySelectorAll('[role="option"]');
    // none + every nameplate in the sample
    expect(options).toHaveLength(catalog.counts.nameplate + 1);
    expect(
      screen.getByRole("option", { name: /No nameplate, equipped/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("group", { name: /The Nightmare Before Christmas/ }),
    ).toBeInTheDocument();
  });

  it("previews a choice and applies it with its kind and sku", async () => {
    const { onApplied, onClose } = renderPicker("profile_effect");
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();

    const effect = catalog.items.find(
      (item) => item.kind === "profile_effect",
    )!;
    fireEvent.click(
      screen.getAllByRole("option", {
        name: new RegExp(`^${escapeRe(effect.name)}`),
      })[0]!,
    );
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(mocks.apiPatch).toHaveBeenCalledWith(
      "/api/collectibles/apply",
      expect.objectContaining({
        kind: "profile_effect",
        skuId: effect.skuId,
      }),
    );
    expect(onApplied.mock.calls[0]![1]).toEqual(["profile_effect"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("removes the equipped item through the none option", async () => {
    const decoration = catalog.items.find(
      (item) => item.kind === "avatar_decoration",
    )!;
    renderPicker("avatar_decoration", {
      currentDisplay: displayWithCollectible(
        null,
        "avatar_decoration",
        decoration,
      ),
    });
    expect(
      screen.getAllByRole("option", {
        name: new RegExp(`^${escapeRe(decoration.name)}.*, equipped$`),
      })[0],
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("option", { name: "No decoration" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mocks.apiPatch).toHaveBeenCalledWith(
        "/api/collectibles/apply",
        expect.objectContaining({ kind: "avatar_decoration", skuId: null }),
      ),
    );
  });

  it("filters with search and announces the result count", () => {
    renderPicker("avatar_decoration");
    fireEvent.change(screen.getByLabelText("Search decorations"), {
      target: { value: "skellington" },
    });
    const options = screen
      .getByRole("listbox")
      .querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.getAttribute("aria-label")?.toLowerCase()).toContain(
        "skellington",
      );
    }
    expect(screen.getByRole("status")).toHaveTextContent(/results?/);
  });

  it("has one tab stop and moves with the arrow keys", () => {
    renderPicker("profile_frame");
    const listbox = screen.getByRole("listbox");
    const options = [
      ...listbox.querySelectorAll<HTMLElement>('[role="option"]'),
    ];
    expect(options.filter((option) => option.tabIndex === 0)).toHaveLength(1);
    options[0]!.focus();
    fireEvent.keyDown(options[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1]!, { key: "End" });
    expect(document.activeElement).toBe(options[options.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(options[options.length - 1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("closes on Escape", () => {
    const { onClose } = renderPicker("nameplate");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
