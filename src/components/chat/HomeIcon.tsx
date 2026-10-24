import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const HOME_ICON_ASSETS = {
  light: "/icons/home-light.svg",
  dark: "/icons/home-dark.svg",
} as const;

type HomeIconProps = {
  className?: string;
  variant?: keyof typeof HOME_ICON_ASSETS;
  showThemeOverlay?: boolean;
};

export function HomeIcon({
  className,
  variant,
  showThemeOverlay = true,
}: HomeIconProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timeout);
  }, []);

  const isMiku =
    showThemeOverlay &&
    mounted &&
    (resolvedTheme === "miku-light" || resolvedTheme === "miku-dark");
  const isSpiderman =
    showThemeOverlay &&
    mounted &&
    (resolvedTheme === "spiderman-light" || resolvedTheme === "spiderman-dark");
  const isLightMode =
    resolvedTheme === "light" ||
    resolvedTheme === "miku-light" ||
    resolvedTheme === "spiderman-light";
  const iconVariant = variant ?? (isLightMode ? "light" : "dark");
  const iconAsset = HOME_ICON_ASSETS[iconVariant];
  const shouldRenderAsset = mounted || variant !== undefined;

  return (
    <div
      className={cn(
        "relative flex h-7 w-7 items-center justify-center",
        className,
      )}
      suppressHydrationWarning
    >
      {shouldRenderAsset ? (
        <img
          aria-hidden="true"
          alt=""
          className="block h-full w-full object-contain"
          src={iconAsset}
        />
      ) : null}
      {isMiku && (
        <img
          src="/themes/miku/miku-wig.svg"
          alt=""
          className="absolute -top-[8px] left-1/2 -translate-x-[47%] size-11 max-w-none pointer-events-none select-none z-10"
        />
      )}
      {isSpiderman && (
        <img
          src="/themes/spiderman/spiderman-mask.svg"
          alt=""
          className="absolute -top-[2px] left-1/2 -translate-x-[50%] w-[32px] h-[32px] max-w-none pointer-events-none select-none z-10 filter drop-shadow-md"
        />
      )}
    </div>
  );
}
