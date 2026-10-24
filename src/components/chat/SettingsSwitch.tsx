import { HIT } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";

/**
 * On/off switch. `role="switch"` with `aria-checked`, named by the setting it
 * controls: pass `labelledBy` (the row's visible title id) or `ariaLabel`.
 * Motion is transform and opacity only: the accent fill fades in over the
 * neutral track and the thumb slides.
 */
export function SettingsSwitch({
  checked,
  onChange,
  ariaLabel,
  labelledBy,
  describedBy,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel?: string;
  /** id of the visible label; preferred over ariaLabel when present */
  labelledBy?: string;
  /** id of the supporting description */
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      aria-label={labelledBy ? undefined : (ariaLabel ?? "Toggle setting")}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-rm-field-edge [-webkit-tap-highlight-color:transparent] disabled:cursor-not-allowed disabled:opacity-45",
        HIT,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full bg-primary transition-opacity duration-150 ease-(--rm-ease-out)",
          checked ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-(--rm-ease-out) motion-reduce:transition-none",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}
