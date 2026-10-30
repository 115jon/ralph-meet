import * as React from "react";

import { DitherGlyph, type GlyphMotif } from "@/components/ui/dither-glyph";
import { cn } from "@/lib/utils";

type EmptyStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  /** What is empty, in the product's words ("No one's here yet"). */
  title: React.ReactNode;
  /** What to do next. */
  description?: React.ReactNode;
  /** One action, usually a `secondary` or `primary` Button. */
  action?: React.ReactNode;
  /** Which still glyph sits above the title (`empty` by default). */
  motif?: GlyphMotif;
  /** Replace the glyph; pass `null` for no art. */
  art?: React.ReactNode;
  /** `sm` for panels and popovers, `md` for a column. */
  size?: "sm" | "md";
  /**
   * The empty state of a pending fetch: role=status, and the glyph prints
   * its light half-resolved. Still; the title says what is happening.
   */
  loading?: boolean;
};

/**
 * The empty state: a still DitherGlyph above a title, a
 * description and one action, centred. Title Bricolage 700 (20, 15 sm) ink-1,
 * description text-ui-sm ink-2 at a 40ch measure. No eyebrow, no card.
 */
function EmptyState({
  title,
  description,
  action,
  motif = "empty",
  art,
  size = "md",
  loading = false,
  className,
  ...props
}: EmptyStateProps) {
  const sm = size === "sm";
  return (
    <div
      data-slot="empty-state"
      role={loading ? "status" : undefined}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        sm ? "gap-3 px-4 py-6" : "gap-4 px-6 py-10",
        className,
      )}
      {...props}
    >
      {art === undefined ? (
        <DitherGlyph motif={motif} size={sm ? "sm" : "md"} pending={loading} />
      ) : (
        art
      )}
      <div className="flex max-w-[40ch] flex-col items-center gap-1">
        <p
          className={cn(
            "font-display font-bold text-balance text-ink-1",
            sm
              ? "text-[15px] leading-5"
              : "text-[20px] leading-6 tracking-[-0.01em]",
          )}
        >
          {title}
        </p>
        {description ? (
          <p className="text-ui-sm text-pretty text-ink-2">{description}</p>
        ) : null}
      </div>
      {action ? (
        <div className="mt-1 flex items-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

export { EmptyState };
