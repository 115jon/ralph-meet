import { AnimatePresence, motion } from "framer-motion";
import { Check, type LucideIcon } from "lucide-react";
import { EASE_OUT } from "./device-login-styles";

/**
 * Icon that morphs to a check mark after copying: quick scale + opacity with a
 * slight blur so the swap reads as one motion instead of two icons.
 */
export function CopyMorphIcon({
  copied,
  icon: Icon,
  className = "h-4 w-4",
}: {
  copied: boolean;
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-grid place-items-center [&>*]:[grid-area:1/1]"
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={copied ? "check" : "copy"}
          initial={{ opacity: 0, scale: 0.7, filter: "blur(2px)" }}
          animate={{
            opacity: 1,
            scale: 1,
            filter: "blur(0px)",
            transition: { duration: 0.2, ease: EASE_OUT },
          }}
          exit={{
            opacity: 0,
            scale: 0.7,
            filter: "blur(2px)",
            transition: { duration: 0.12, ease: EASE_OUT },
          }}
          className="inline-flex"
        >
          {copied ? (
            <Check className={`${className} text-rm-accent`} />
          ) : (
            <Icon className={className} />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
