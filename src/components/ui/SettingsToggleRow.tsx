import { useId } from "react";
import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { cn } from "@/lib/utils";

interface SettingsToggleRowProps {
  /** Icon element — wrapped in the default icon container */
  icon: React.ReactNode;
  /** Toggle label */
  label: string;
  /** Description text below the label */
  description: string;
  /** Whether the toggle is on */
  checked: boolean;
  /** Toggle callback */
  onChange: () => void;
  /** If true, the icon prop is rendered as-is without wrapping in the default container */
  rawIcon?: boolean;
  /** Additional className for the row container */
  className?: string;
}

/**
 * A settings row whose switch is named by the row's visible title and
 * described by its supporting copy.
 */
export function SettingsToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
  rawIcon = false,
  className,
}: SettingsToggleRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  return (
    <div
      className={cn(
        "group flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {rawIcon ? (
          icon
        ) : (
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-rm-tint-1 text-rm-text-muted">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h4 id={labelId} className="text-ui-sm font-semibold text-rm-text">
            {label}
          </h4>
          <p
            id={descriptionId}
            className="text-ui-xs text-rm-text-muted text-pretty pr-2"
          >
            {description}
          </p>
        </div>
      </div>
      <div className="flex justify-end w-full sm:w-auto">
        <SettingsSwitch
          checked={checked}
          onChange={onChange}
          labelledBy={labelId}
          describedBy={descriptionId}
        />
      </div>
    </div>
  );
}
