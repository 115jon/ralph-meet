/**
 * The settings field recipe (overlays audit §4, spec §8): a 13/500 label,
 * then a full-width 32 field, then a 12 helper (or the error in its place).
 * One `<li>` inside a SettingsCard, inset 16/12 like a SettingsRow.
 *
 *   <FieldRow label="Server name" htmlFor={id} helper="…" error={error}>
 *     <Input id={id} aria-describedby={helperId} … />
 *   </FieldRow>
 *
 * The field reads its helper through `helperId` (pass it to
 * aria-describedby); the error replaces the helper in the same slot so the
 * description follows it.
 */

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function FieldRow({
  label,
  htmlFor,
  helper,
  helperId,
  error,
  trailing,
  children,
}: {
  label: ReactNode;
  /** The control's id, for the label. */
  htmlFor?: string;
  helper?: ReactNode;
  /** Id for the helper / error line, for the control's aria-describedby. */
  helperId?: string;
  error?: ReactNode;
  /** Right side of the helper line (a character count). */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const line = error ?? helper;
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <label htmlFor={htmlFor} className="text-ui-sm font-medium text-ink-1">
        {label}
      </label>
      {children}
      {line || trailing ? (
        <div className="flex items-start gap-3">
          <p
            id={helperId}
            className={cn(
              "min-w-0 flex-1 text-pretty text-ui-xs",
              error ? "text-danger-ink" : "text-ink-3",
            )}
          >
            {line}
          </p>
          {trailing ? (
            <span className="shrink-0 text-ink-3">{trailing}</span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
