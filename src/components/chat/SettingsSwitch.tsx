import { cn } from "@/lib/utils";

export function SettingsSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        "shrink-0 w-[50px] h-[28px] rounded-[16px] relative transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        checked ? "bg-primary" : "bg-[#2b2d31]",
      )}
    >
      <div
        className={cn(
          "absolute top-[2px] left-[2px] h-[24px] w-[24px] bg-white rounded-full transition-transform duration-200 ease-in-out shadow-sm",
          checked ? "translate-x-[22px]" : "translate-x-0"
        )}
      />
    </button>
  );
}
