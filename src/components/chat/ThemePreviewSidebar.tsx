import { cn } from "@/lib/utils";
import { type AppTheme } from "@/lib/theme-preferences";
import { ChevronLeft, Eye, X } from "lucide-react";
import { useAppearanceTheme } from "./useAppearanceTheme";

const THEME_OPTIONS: Array<{
  id: AppTheme;
  label: string;
  previewClass: string;
}> = [
  { id: "light", label: "Light", previewClass: "bg-[#f2f3f5]" },
  { id: "dark", label: "Midnight", previewClass: "bg-[#0f0f11]" },
  { id: "system", label: "System", previewClass: "bg-gradient-to-br from-[#0f0f11] to-[#f2f3f5]" },
  { id: "miku-light", label: "Miku Light", previewClass: "bg-gradient-to-br from-[#ffffff] via-[#e8f4fd] to-[#f872a5]" },
  { id: "miku-dark", label: "Miku Dark", previewClass: "bg-gradient-to-br from-[#13111f] via-[#0f0d19] to-[#f872a5]" },
  { id: "spiderman-light", label: "Spider-Man Light", previewClass: "bg-gradient-to-br from-[#ffffff] via-[#eef0f6] to-[#E50914]" },
  { id: "spiderman-dark", label: "Spider-Man Dark", previewClass: "bg-gradient-to-br from-[#06050a] via-[#0b0a10] to-[#E50914]" },
];

interface ThemePreviewSidebarProps {
  isClosing?: boolean;
  onClose: () => void;
  onBackToSettings: () => void;
  className?: string;
}

export default function ThemePreviewSidebar({
  isClosing,
  onClose,
  onBackToSettings,
  className,
}: ThemePreviewSidebarProps) {
  const { theme, setAppearanceTheme } = useAppearanceTheme();

  return (
    <aside
      className={cn(
        "pointer-events-auto flex h-full w-full max-w-[320px] flex-col border-l border-rm-border bg-rm-bg-surface shadow-2xl animate-in slide-in-from-right-8 duration-200",
        isClosing && "animate-out slide-out-to-right-8 duration-200",
        className,
      )}
      aria-label="Theme preview sidebar"
    >
      <header className="flex items-center gap-3 border-b border-rm-border px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rm-bg-elevated text-rm-text-muted">
          <Eye size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-rm-text">Preview Theme</h2>
          <p className="text-xs text-rm-text-muted">Switch themes and see the current screen update live.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-rm-bg-elevated text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 custom-scrollbar">
        <div className="grid grid-cols-2 gap-3">
          {THEME_OPTIONS.map((option) => {
            const active = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => void setAppearanceTheme(option.id)}
                className={cn(
                  "rounded-2xl border p-2 text-left transition-all",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-rm-border bg-rm-bg-elevated/40 hover:bg-rm-bg-hover",
                )}
              >
                <div className={cn("mb-2 h-20 rounded-xl", option.previewClass)} />
                <span className={cn("text-xs font-bold", active ? "text-primary" : "text-rm-text")}>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-rm-border p-4">
        <button
          type="button"
          onClick={onBackToSettings}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rm-border bg-rm-bg-elevated px-4 py-2.5 text-sm font-bold text-rm-text transition-colors hover:bg-rm-bg-hover"
        >
          <ChevronLeft size={16} />
          Back to Settings
        </button>
      </div>
    </aside>
  );
}
