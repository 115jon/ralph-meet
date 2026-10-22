import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's default theme. Register the app's own
 * scales (see `@theme` in styles.css) so `text-ui-sm` is treated as a font
 * size rather than a colour and survives `cn("text-ui-sm", "text-rm-text")`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "ui-2xs",
        "ui-xs",
        "ui-sm",
        "ui-base",
        "ui-md",
        "ui-lg",
        "ui-xl",
        "ui-2xl",
        "display",
        "display-lg",
      ],
      font: ["ui", "display"],
      ease: ["drawer"],
    },
    classGroups: {
      transition: ["transition-ui"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
