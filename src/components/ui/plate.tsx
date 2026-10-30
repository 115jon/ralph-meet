import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Cards (DESIGN.md, Card · Row).
 *
 *   RuleCard     C2, settings sections: no box and no fill. One 2px ink-1
 *                rule per section, a silkscreen legend and index on the rule
 *                line, an optional Bricolage title.
 *   LegendPlate  C1, floats and side panels: a ply-2 plate with a
 *                line-strong edge and its legend printed across the top edge
 *                (like FieldPlate). Pass the ground it sits on.
 */
function RuleCard({
  legend,
  index,
  title,
  titleId,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  legend?: React.ReactNode;
  /** Trailing silkscreen on the rule line ("02 / 04"). */
  index?: React.ReactNode;
  title?: React.ReactNode;
  titleId?: string;
}) {
  return (
    <section
      data-slot="rule-card"
      className={cn("border-t-2 border-ink-1 pt-3", className)}
      aria-labelledby={props["aria-labelledby"] ?? titleId}
      {...props}
    >
      {legend || index ? (
        <div className="flex min-h-[14px] items-baseline justify-between gap-4">
          {legend ? (
            <p className="silkscreen text-ink-3">{legend}</p>
          ) : (
            <span />
          )}
          {index ? <p className="silkscreen text-ink-3">{index}</p> : null}
        </div>
      ) : null}
      {title ? (
        <h3
          id={titleId}
          className="mt-2 font-display text-[20px] leading-6 font-bold tracking-[-0.01em] text-balance text-ink-1"
        >
          {title}
        </h3>
      ) : null}
      <div className={legend || index || title ? "mt-3" : undefined}>
        {children}
      </div>
    </section>
  );
}

const GROUND = {
  "ply-0": "[--plate-ground:var(--ply-0)]",
  "ply-1": "[--plate-ground:var(--ply-1)]",
  "ply-2": "[--plate-ground:var(--ply-2)]",
  "ply-3": "[--plate-ground:var(--ply-3)]",
} as const;

function LegendPlate({
  legend,
  title,
  ground = "ply-0",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  legend: React.ReactNode;
  title?: React.ReactNode;
  ground?: keyof typeof GROUND;
}) {
  return (
    <section
      data-slot="legend-plate"
      className={cn(
        "relative mt-2 rounded-[2px] border border-line-strong bg-ply-2 p-4 pt-5",
        GROUND[ground],
        className,
      )}
      {...props}
    >
      <p className="silkscreen absolute -top-[7px] left-3 bg-(--plate-ground) px-1 text-ink-2">
        {legend}
      </p>
      {title ? (
        <h3 className="font-display text-[18px] leading-6 font-bold text-ink-1">
          {title}
        </h3>
      ) : null}
      <div className={title ? "mt-3" : undefined}>{children}</div>
    </section>
  );
}

export { LegendPlate, RuleCard };
