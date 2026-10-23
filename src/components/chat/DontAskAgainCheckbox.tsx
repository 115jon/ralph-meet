"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

interface DontAskAgainCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

/**
 * The "Don't ask again" row under a confirm dialog's body: a native checkbox
 * with its label, the whole row a 44px target on coarse pointers.
 */
export function DontAskAgainCheckbox({
  checked,
  onCheckedChange,
  className,
}: DontAskAgainCheckboxProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex w-fit cursor-pointer items-center gap-2 text-ui-sm text-rm-text-secondary transition-colors duration-150 select-none pointer-coarse:min-h-11 pointer-fine:hover:text-rm-text",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="size-4 shrink-0 cursor-pointer accent-primary"
      />
      Don&apos;t ask again
    </label>
  );
}
