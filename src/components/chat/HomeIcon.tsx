
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { HomeDarkSvg, HomeLightSvg } from "./home-svgs";

export function HomeIcon({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timeout);
  }, []);

  const isMiku = mounted && (resolvedTheme === "miku-light" || resolvedTheme === "miku-dark");
  const isLightMode = resolvedTheme === "light" || resolvedTheme === "miku-light";
  const SvgComponent = isLightMode ? HomeLightSvg : HomeDarkSvg;

  // Render the SVG component directly to allow fill="currentColor" to work.
  return (
    <div
      className={cn("relative flex items-center justify-center h-7 w-7 [&>svg]:h-full [&>svg]:w-full", className)}
      suppressHydrationWarning
    >
      {mounted ? <SvgComponent /> : null}
      {isMiku && (
        <img 
          src="/themes/miku/miku-wig.svg" 
          alt="" 
          className="absolute -top-[8px] left-1/2 -translate-x-[47%] w-[43px] h-[43px] max-w-none pointer-events-none select-none z-10"
        />
      )}
    </div>
  );
}

