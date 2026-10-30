import type { Attachment } from "@/lib/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IMAGE_VIEWER_EXIT_MS,
  useImageViewerStore,
} from "./useImageViewerStore";

const image = (id: string) => ({ id, filename: `${id}.png` }) as Attachment;

describe("useImageViewerStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useImageViewerStore.getState().actions.close();
    vi.runAllTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps images, index and context through the exit animation", () => {
    const { open, close } = useImageViewerStore.getState().actions;
    const context = { username: "ada" };
    open([image("a"), image("b")], 1, context);
    close();

    let state = useImageViewerStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.images.map((i) => i.id)).toEqual(["a", "b"]);
    expect(state.initialIndex).toBe(1);
    expect(state.context).toBe(context);

    vi.advanceTimersByTime(IMAGE_VIEWER_EXIT_MS - 1);
    expect(useImageViewerStore.getState().images).toHaveLength(2);

    vi.advanceTimersByTime(1);
    state = useImageViewerStore.getState();
    expect(state.images).toEqual([]);
    expect(state.initialIndex).toBe(0);
    expect(state.context).toBeUndefined();
    expect(state.isOpen).toBe(false);
  });

  it("does not lose the new images when reopened during the exit", () => {
    const { open, close } = useImageViewerStore.getState().actions;
    open([image("old")]);
    close();
    vi.advanceTimersByTime(IMAGE_VIEWER_EXIT_MS / 2);

    open([image("new-1"), image("new-2")], 1);
    vi.advanceTimersByTime(IMAGE_VIEWER_EXIT_MS * 2);

    const state = useImageViewerStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.images.map((i) => i.id)).toEqual(["new-1", "new-2"]);
    expect(state.initialIndex).toBe(1);
  });

  it("a second close restarts the clear window", () => {
    const { open, close } = useImageViewerStore.getState().actions;
    open([image("a")]);
    close();
    vi.advanceTimersByTime(IMAGE_VIEWER_EXIT_MS - 10);
    close();
    vi.advanceTimersByTime(IMAGE_VIEWER_EXIT_MS - 10);
    expect(useImageViewerStore.getState().images).toHaveLength(1);
    vi.advanceTimersByTime(10);
    expect(useImageViewerStore.getState().images).toEqual([]);
  });

  it("updateImage still patches the open set", () => {
    const { open, updateImage } = useImageViewerStore.getState().actions;
    open([image("a")]);
    updateImage("a", { ...image("a"), filename: "renamed.png" });
    expect(useImageViewerStore.getState().images[0]?.filename).toBe(
      "renamed.png",
    );
  });
});
