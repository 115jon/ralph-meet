"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";
import { useMounted } from "@/hooks/useMounted";

/**
 * Theme personality lives in explicit slots, never in CSS that sniffs class
 * names (talk-tree-spec §1g). Each theme registers its assets here; a slot
 * renders nothing where its theme has none. Structure is identical across
 * themes: a slot decorates inside space the layout already owns.
 *
 *   ThemeMark    the glyph layered over the rail home mark (Miku's wig,
 *                Spider-Man's mask)
 *   ThemeBanner  a decorative inset for the standard 48px server header:
 *                a 2px brand rule (brand, then brand-2 as a hard stop, not a
 *                gradient) plus an optional 16px glyph at the end
 */

export type ThemeId =
  | "dark"
  | "light"
  | "miku-dark"
  | "miku-light"
  | "spiderman-dark"
  | "spiderman-light";

type ThemeSlotAssets = {
  /** Overlay for the rail home mark, positioned over a 28px glyph. */
  mark?: { src: string; className: string };
  /** Header banner: the brand rule, plus an optional glyph. */
  banner?: { glyph?: string };
};

const MIKU: ThemeSlotAssets = {
  mark: {
    src: "/themes/miku/miku-wig.svg",
    className: "-top-[8px] left-1/2 size-11 -translate-x-[47%]",
  },
  banner: { glyph: "/themes/miku/miku-wig.svg" },
};

const SPIDERMAN: ThemeSlotAssets = {
  mark: {
    src: "/themes/spiderman/spiderman-mask.svg",
    className: "-top-[2px] left-1/2 size-8 -translate-x-1/2",
  },
  banner: { glyph: "/themes/spiderman/spiderman-mask.svg" },
};

export const THEME_SLOTS: Record<ThemeId, ThemeSlotAssets> = {
  dark: {},
  light: {},
  "miku-dark": MIKU,
  "miku-light": MIKU,
  "spiderman-dark": SPIDERMAN,
  "spiderman-light": SPIDERMAN,
};

/** The active theme's slot assets (empty before mount, so SSR matches). */
export function useThemeSlots(): ThemeSlotAssets {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  if (!mounted || !resolvedTheme) return {};
  return THEME_SLOTS[resolvedTheme as ThemeId] ?? {};
}

/** Decorative overlay for the rail home mark. Place inside a relative box. */
export function ThemeMark({ className }: { className?: string }) {
  const { mark } = useThemeSlots();
  if (!mark) return null;
  return (
    <img
      src={mark.src}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn(
        "pointer-events-none absolute z-10 max-w-none select-none",
        mark.className,
        className,
      )}
    />
  );
}

/**
 * Decorative inset for a 48px header: a 2px brand rule along the bottom edge
 * and the theme glyph at the inline end. Place inside a `relative` header.
 */
export function ThemeBanner({ className }: { className?: string }) {
  const { banner } = useThemeSlots();
  if (!banner) return null;
  return (
    <span
      aria-hidden="true"
      data-slot="theme-banner"
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[linear-gradient(90deg,var(--brand)_70%,var(--brand-2)_70%)]" />
      {banner.glyph ? (
        <img
          src={banner.glyph}
          alt=""
          draggable={false}
          className="absolute top-1/2 right-3 size-4 -translate-y-1/2 object-contain opacity-80 select-none"
        />
      ) : null}
    </span>
  );
}
