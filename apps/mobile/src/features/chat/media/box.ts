import { useCallback, useState } from "react";

const MAX_HEIGHT = 300;
/** Before a picture reports its size it holds a 4:3 box. */
const FALLBACK_RATIO = 4 / 3;

export interface Size {
  readonly width: number;
  readonly height: number;
}

// Sizes seen this session, so a row that scrolls back in keeps its box.
const knownSizes = new Map<string, Size>();

function fit(size: Size | undefined, maxWidth: number): Size {
  if (!size) {
    const width = Math.min(maxWidth, MAX_HEIGHT * FALLBACK_RATIO);
    return { width, height: Math.round(width / FALLBACK_RATIO) };
  }
  const scale = Math.min(1, maxWidth / size.width, MAX_HEIGHT / size.height);
  return {
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  };
}

export interface MediaBox {
  readonly box: Size;
  /** Feed the loaded picture's size, for previews that sent none. */
  readonly onSize: (width: number, height: number) => void;
}

/**
 * The box a tile draws at: the size the preview declared, else whatever its
 * picture reports once loaded (remembered under `key`), fitted to the column.
 */
export function useMediaBox(
  key: string,
  declared: { width?: number; height?: number },
  maxWidth: number,
): MediaBox {
  const [size, setSize] = useState<Size | undefined>(() =>
    declared.width && declared.height
      ? { width: declared.width, height: declared.height }
      : knownSizes.get(key),
  );
  const onSize = useCallback(
    (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      knownSizes.set(key, { width, height });
      setSize((current) =>
        current?.width === width && current.height === height
          ? current
          : { width, height },
      );
    },
    [key],
  );
  return { box: fit(size, maxWidth), onSize };
}

/** 31.9 -> "0:32", 6627 -> "1:50:27". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
