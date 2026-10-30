import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's default theme. Register the app's own
 * scales (see `@theme` in styles.css) so `text-ui-sm` / `text-num-xs` are
 * treated as font sizes rather than colours and survive
 * `cn("text-ui-sm", "text-ink-2")`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "ui-2xs",
        "ui-xs",
        "ui-sm",
        "ui-row",
        "ui-base",
        "ui-md",
        "ui-lg",
        "ui-xl",
        "ui-2xl",
        "display",
        "display-lg",
        // Mono number steps (styles.css @utility): font size + face.
        "num-xs",
        "num-sm",
        // Bricolage control label (styles.css @utility text-control).
        "control",
      ],
      font: ["ui", "display", "silk"],
      ease: ["drawer", "spring"],
      shadow: ["float", "modal"],
    },
    classGroups: {
      transition: ["transition-ui"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
