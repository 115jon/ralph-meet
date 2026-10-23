import { Icon, type IconName } from "@/components/ui/icon";
import type { IconSize } from "@/components/ui/icon";
import { AnimatePresence, motion } from "framer-motion";
import { EASE_OUT } from "./device-login-styles";

/**
 * Icon that morphs to a check mark after copying: a quick scale + opacity
 * swap (transform and opacity only), so it reads as one motion instead of
 * two icons.
 */
export function CopyMorphIcon({
  copied,
  icon,
  size = "sm",
}: {
  copied: boolean;
  icon: IconName;
  size?: IconSize;
}) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-grid place-items-center [&>*]:[grid-area:1/1]"
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={copied ? "check" : "copy"}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{
            opacity: 1,
            scale: 1,
            transition: { duration: 0.2, ease: EASE_OUT },
          }}
          exit={{
            opacity: 0,
            scale: 0.7,
            transition: { duration: 0.12, ease: EASE_OUT },
          }}
          className="inline-flex"
        >
          {copied ? (
            <Icon name="check" size={size} className="text-rm-accent-ink" />
          ) : (
            <Icon name={icon} size={size} />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
