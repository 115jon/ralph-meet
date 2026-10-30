import { ThemeMark } from "@/components/ui/theme-slots";
import { cn } from "@/lib/utils";

const HOME_ICON_ASSETS = {
  light: "/icons/home-light.svg",
  dark: "/icons/home-dark.svg",
} as const;

type HomeIconProps = {
  className?: string;
  /** Force one asset; by default the dark/light pair swaps in CSS. */
  variant?: keyof typeof HOME_ICON_ASSETS;
  /** Layer the theme's mark (Miku's wig, Spider-Man's mask) over it. */
  showThemeOverlay?: boolean;
};

/**
 * The home mark. Both assets render and the `dark:` variant picks one, so
 * nothing branches on the resolved theme and SSR matches the first paint.
 * Theme personality comes from the ThemeMark slot (talk-tree-spec §1g).
 */
export function HomeIcon({
  className,
  variant,
  showThemeOverlay = true,
}: HomeIconProps) {
  return (
    <div
      className={cn(
        "relative flex size-7 items-center justify-center",
        className,
      )}
    >
      {variant ? (
        <img
          aria-hidden="true"
          alt=""
          className="block size-full object-contain"
          src={HOME_ICON_ASSETS[variant]}
        />
      ) : (
        <>
          <img
            aria-hidden="true"
            alt=""
            className="block size-full object-contain dark:hidden"
            src={HOME_ICON_ASSETS.light}
          />
          <img
            aria-hidden="true"
            alt=""
            className="hidden size-full object-contain dark:block"
            src={HOME_ICON_ASSETS.dark}
          />
        </>
      )}
      {showThemeOverlay && <ThemeMark />}
    </div>
  );
}
