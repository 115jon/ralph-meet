/**
 * A product screenshot that follows the theme. Both variants are in the
 * markup; the inactive one is `display: none`, and because both are lazy
 * the browser never fetches the hidden file. Captured from the dev fixtures
 * (`/ui-fixtures`) at 1440x900 (desktop) and 390x844 (phone).
 */

import { cn } from "@/lib/utils";

export interface ShotProps {
  /** File stem under /screenshots/home, without the -light/-dark suffix. */
  name: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  sizes?: string;
}

export function Shot({
  name,
  alt,
  width,
  height,
  className,
  sizes,
}: ShotProps) {
  const shared = {
    alt,
    width,
    height,
    loading: "lazy" as const,
    decoding: "async" as const,
    sizes,
  };
  return (
    <>
      <img
        {...shared}
        src={`/screenshots/home/${name}-light.webp`}
        className={cn("block h-auto w-full dark:hidden", className)}
      />
      <img
        {...shared}
        src={`/screenshots/home/${name}-dark.webp`}
        className={cn("hidden h-auto w-full dark:block", className)}
      />
    </>
  );
}
