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

export function SettingsToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
  rawIcon = false,
  className,
}: SettingsToggleRowProps) {
  return (
    <div
      className={cn(
        "group flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-transparent hover:bg-rm-bg-elevated/40 transition-all gap-4 sm:gap-6",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        {rawIcon ? (
          icon
        ) : (
          <div className="w-10 h-10 shrink-0 rounded-xl bg-rm-bg-elevated border border-rm-border flex items-center justify-center text-rm-text-secondary group-hover:text-rm-text transition-colors">
            {icon}
          </div>
        )}
        <div>
          <h4 className="text-[14px] font-bold text-rm-text">{label}</h4>
          <p className="text-[12px] text-rm-text-muted leading-snug pr-2">
            {description}
          </p>
        </div>
      </div>
      <div className="flex justify-end w-full sm:w-auto mt-2 sm:mt-0">
        <SettingsSwitch checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}
