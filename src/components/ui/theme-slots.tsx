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
 *   ThemeMark    the theme's own Yappy (Miku's twin-tails, Spider-Man's
 *                web mask), drawn on the same 24-cell grid and laid over
 *                the home mark, which steps aside (THEME_MARK_BASE)
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
  /** A themed home mark, laid exactly over the 24-cell rail mark. */
  mark?: { src: string };
  /** Header banner: the brand rule, plus an optional glyph. */
  banner?: { glyph?: string };
};

const MIKU_BANNER = { glyph: "/themes/miku/miku-wig.svg" };
const SPIDERMAN_BANNER = { glyph: "/themes/spiderman/spiderman-mask.svg" };

export const THEME_SLOTS: Record<ThemeId, ThemeSlotAssets> = {
  dark: {},
  light: {},
  "miku-dark": {
    mark: { src: "/icons/home-miku-dark.svg" },
    banner: MIKU_BANNER,
  },
  "miku-light": {
    mark: { src: "/icons/home-miku-light.svg" },
    banner: MIKU_BANNER,
  },
  "spiderman-dark": {
    mark: { src: "/icons/home-spiderman-dark.svg" },
    banner: SPIDERMAN_BANNER,
  },
  "spiderman-light": {
    mark: { src: "/icons/home-spiderman-light.svg" },
    banner: SPIDERMAN_BANNER,
  },
};

/**
 * Put on the plain home mark that a ThemeMark sits after: it steps aside
 * while a themed mark is present. Under forced colours the themed mark is
 * hidden and the plain one stays.
 */
export const THEME_MARK_BASE =
  "not-forced-colors:[&:has(~[data-slot=theme-mark])]:invisible";

/** The active theme's slot assets (empty before mount, so SSR matches). */
function useThemeSlots(): ThemeSlotAssets {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  if (!mounted || !resolvedTheme) return {};
  return THEME_SLOTS[resolvedTheme as ThemeId] ?? {};
}

/**
 * The theme's home mark, covering the plain one. Place it after the plain
 * mark (which takes THEME_MARK_BASE) inside a relative box of the same size.
 */
export function ThemeMark({ className }: { className?: string }) {
  const { mark } = useThemeSlots();
  if (!mark) return null;
  return (
    <img
      src={mark.src}
      alt=""
      aria-hidden="true"
      data-slot="theme-mark"
      draggable={false}
      className={cn(
        "pointer-events-none absolute inset-0 z-10 size-full max-w-none object-contain select-none forced-colors:hidden",
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
