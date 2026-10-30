/**
 * Product screenshots that follow the theme. Both variants are in the
 * markup; the inactive one is `display: none`, and because both are lazy
 * the browser never fetches the hidden file. Captured from the dev fixtures
 * with `&copy=landing` (product-neutral content) at 1440x900 (desktop),
 * 390x844 (phone), two 2x detail crops (the tree, the soundboard) and the
 * share stage cropped from the desktop capture for small screens.
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

/** A desktop capture in a window frame: radius 12, a seam, the modal shadow. */
export function WindowShot({
  className,
  ...shot
}: ShotProps & { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-line-strong bg-ply-0 shadow-modal",
        className,
      )}
    >
      <Shot {...shot} />
    </div>
  );
}

/** A phone capture in a phone-shaped frame. */
export function PhoneShot({
  className,
  ...shot
}: ShotProps & { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[28px] border border-line-strong bg-ply-0 shadow-modal",
        className,
      )}
    >
      <Shot {...shot} />
    </div>
  );
}

export interface ResponsiveShotProps {
  desktop: Omit<ShotProps, "sizes" | "className">;
  /** Shown below `md` instead of the desktop capture. */
  phone: Omit<ShotProps, "sizes" | "className">;
  className?: string;
  /** Classes for the phone frame (width, alignment). */
  phoneClassName?: string;
  /**
   * `phone` (default) frames the small-screen capture as a phone; `window`
   * for a wide crop that reads better than the phone layout.
   */
  phoneFrame?: "phone" | "window";
  sizes?: string;
}

/**
 * The desktop capture from `md` up, the phone capture below it. Only the
 * visible pair is fetched (hidden lazy images are never requested).
 */
export function ResponsiveShot({
  desktop,
  phone,
  className,
  phoneClassName,
  phoneFrame = "phone",
  sizes,
}: ResponsiveShotProps) {
  return (
    <>
      <WindowShot
        {...desktop}
        sizes={sizes}
        className={cn("hidden md:block", className)}
      />
      {phoneFrame === "window" ? (
        <WindowShot
          {...phone}
          sizes="100vw"
          className={cn("md:hidden", phoneClassName)}
        />
      ) : (
        <PhoneShot
          {...phone}
          sizes="300px"
          className={cn(
            "mx-auto w-full max-w-[300px] md:hidden",
            phoneClassName,
          )}
        />
      )}
    </>
  );
}
