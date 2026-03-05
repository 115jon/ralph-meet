
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

  // Use dark theme as default for SSR to match the general app aesthetic
  const theme = mounted ? resolvedTheme : "dark";
  const SvgComponent = theme === "light" ? HomeLightSvg : HomeDarkSvg;

  // Render the SVG component directly to allow fill="currentColor" to work.
  return (
    <div
      className={cn("relative flex items-center justify-center h-7 w-7 [&>svg]:h-full [&>svg]:w-full", className)}
      suppressHydrationWarning
    >
      {mounted ? <SvgComponent /> : null}
    </div>
  );
}
