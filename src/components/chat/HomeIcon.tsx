
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { HOME_DARK_SVG, HOME_LIGHT_SVG } from "./home-svgs";

export function HomeIcon({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timeout);
  }, []);

  // Use dark theme as default for SSR to match the general app aesthetic
  const theme = mounted ? resolvedTheme : "dark";
  const svgContent = theme === "light" ? HOME_LIGHT_SVG : HOME_DARK_SVG;

  // Render the SVG content directly to allow fill="currentColor" to work.
  // eslint-disable-next-line react/no-danger
  return (
    <div
      className={cn("relative flex items-center justify-center h-7 w-7 [&>svg]:h-full [&>svg]:w-full", className)}
      suppressHydrationWarning
      dangerouslySetInnerHTML={mounted ? { __html: svgContent } : undefined}
    />
  );
}
