import { cn } from "@/lib/utils";

export function SettingsSwitch({
  checked,
  onChange,
  ariaLabel = "Toggle setting",
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={ariaLabel}
      aria-pressed={checked}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full border border-transparent transition-[background-color,border-color] duration-150 ease-out enabled:active:scale-[0.98]",
        checked
          ? "bg-primary"
          : "bg-rm-bg-active border-rm-border hover:bg-rm-text-ghost/40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0.5 top-0.5 h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform duration-150 ease-out",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
