import { Switch } from "@/components/ui/switch";

/**
 * On/off switch for settings rows: the foundation `Switch` (30x18 track,
 * 14px thumb, primary-fill track when on; transform and opacity only).
 * `role="switch"` with `aria-checked`, named by the setting it controls:
 * pass `labelledBy` (the row's visible title id) or `ariaLabel`.
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
    <Switch
      checked={checked}
      onCheckedChange={() => onChange()}
      aria-label={labelledBy ? undefined : (ariaLabel ?? "Toggle setting")}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
    />
  );
}
