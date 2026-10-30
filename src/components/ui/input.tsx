import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Field edge (DESIGN.md, Fields): ply-2 fill, a line-field edge (>= 3:1 on
 * ply-2), 2px corners. Hover turns the edge ink-2; focus turns it ink-1 and
 * a 1px offset-0 outline joins it into one 2px ink ring. No glow.
 */
export const FIELD =
  "w-full min-w-0 rounded-[2px] border border-line-field bg-ply-2 text-ellipsis text-ink-1 outline-none placeholder:text-ink-3 transition-[border-color] duration-(--dur-1) ease-out pointer-fine:hover:border-ink-2 focus:border-ink-1 focus:outline-1 focus:outline-offset-0 focus:outline-ink-1 focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-ink-1 disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-danger-ink aria-invalid:focus:outline-danger-ink";

/**
 * C1 underline field (header search): no box, a 2px rule that turns ink-2 on
 * hover and accent on focus. Put it on the wrapper around the input.
 */
export const FIELD_UNDERLINE =
  "relative border-b-2 border-line-field transition-colors duration-(--dur-1) ease-out has-[:hover]:border-ink-2 has-[:focus-visible]:border-accent-ink has-[:focus]:border-accent-ink";

type InputProps = React.ComponentProps<"input"> & {
  /** 40 (default), 48 (lg, settings and dialogs) or 32 (sm, dense rows). */
  inputSize?: "sm" | "md" | "lg";
};

const INPUT_SIZE = {
  sm: "h-8 px-2.5",
  md: "h-10 px-3",
  lg: "h-12 px-4",
} as const;

/** Text is 15px on desktop and 16px (iOS zoom floor) below md. */
function Input({ className, type, inputSize = "md", ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        FIELD,
        INPUT_SIZE[inputSize],
        "py-1 text-ui-md md:text-ui-base file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-ui-sm file:font-medium file:text-ink-1",
        className,
      )}
      {...props}
    />
  );
}

/**
 * C2 legend plate: the field's label printed across its top edge in
 * silkscreen, like a panel legend. Wrap an `Input`, `Textarea` or
 * `SelectTrigger`; the label points at `htmlFor` (the control's id). The
 * legend's backing is the ground the plate sits on: pass `ground` when it is
 * not ply-0 (ply-1 in a nav, ply-3 in a dialog).
 */
function FieldPlate({
  label,
  htmlFor,
  ground = "ply-0",
  className,
  children,
  hint,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  ground?: "ply-0" | "ply-1" | "ply-2" | "ply-3";
  className?: string;
  children: React.ReactNode;
  /** Trailing silkscreen on the legend line (a count, "optional"). */
  hint?: React.ReactNode;
}) {
  return (
    <div
      data-slot="field-plate"
      className={cn(
        "group/plate relative pt-2",
        GROUND[ground],
        // The plate's control drops its own top-edge margin and fills width.
        "[&_[data-slot=input]]:w-full [&_[data-slot=select-trigger]]:w-full",
        className,
      )}
    >
      <label
        htmlFor={htmlFor}
        className="silkscreen absolute top-0 left-3 z-10 bg-(--plate-ground) px-1 text-ink-2 transition-colors duration-(--dur-1) group-focus-within/plate:text-ink-1"
      >
        {label}
      </label>
      {hint ? (
        <span className="silkscreen absolute top-0 right-3 z-10 bg-(--plate-ground) px-1 text-ink-3">
          {hint}
        </span>
      ) : null}
      {children}
    </div>
  );
}

const GROUND = {
  "ply-0": "[--plate-ground:var(--ply-0)]",
  "ply-1": "[--plate-ground:var(--ply-1)]",
  "ply-2": "[--plate-ground:var(--ply-2)]",
  "ply-3": "[--plate-ground:var(--ply-3)]",
} as const;

export { FieldPlate, Input };
