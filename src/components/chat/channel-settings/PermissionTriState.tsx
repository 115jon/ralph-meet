/**
 * Deny / Inherit / Allow for one permission (design-audit ST-03).
 *
 * Native radios in a radiogroup named by the permission's label, so every
 * option has a name, arrow keys move and select, and the browser owns focus.
 * The selected option is a tint fill, 600 weight and its visible text, never
 * colour alone (14.5).
 */

import { Icon, type IconName } from "@/components/ui/icon";
import { HIT } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";
import type { TriState } from "./permission-model";

const OPTIONS: {
  value: TriState;
  label: string;
  icon: IconName;
  selected: string;
}[] = [
  {
    value: "deny",
    label: "Deny",
    icon: "close",
    selected: "bg-rm-danger-tint text-rm-danger-ink",
  },
  {
    value: "inherit",
    label: "Inherit",
    icon: "minus",
    selected: "bg-rm-tint-2 text-rm-text",
  },
  {
    value: "allow",
    label: "Allow",
    icon: "check",
    selected:
      "bg-[color-mix(in_oklab,var(--rm-success-ink)_14%,transparent)] text-rm-success-ink",
  },
];

export function PermissionTriState({
  name,
  labelId,
  descId,
  value,
  onChange,
  disabled = false,
}: {
  /** Radio group name; unique per permission and override. */
  name: string;
  labelId: string;
  descId?: string;
  value: TriState;
  onChange: (value: TriState) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={descId}
      className="grid w-full grid-cols-3 gap-0.5 rounded-md border border-rm-border-strong p-0.5 @min-[560px]:w-auto @min-[560px]:grid-cols-[repeat(3,minmax(84px,auto))]"
    >
      {OPTIONS.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-2.5 text-ui-sm transition-colors duration-150 ease-(--rm-ease-out) md:h-8",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-(--rm-focus)",
              HIT,
              checked
                ? cn("font-semibold", option.selected)
                : "font-medium text-rm-text-secondary pointer-fine:hover:bg-rm-tint-1 pointer-fine:hover:text-rm-text",
              disabled && "cursor-not-allowed opacity-45",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <Icon
              name={option.icon}
              size="sm"
              state={checked ? "active" : "idle"}
              className="shrink-0"
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
