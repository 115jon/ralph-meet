import { cn } from "@/lib/utils";
import { type AppTheme } from "@/lib/theme-preferences";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { PRESS } from "@/components/ui/interaction";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useAppearanceTheme } from "./useAppearanceTheme";

const THEME_OPTIONS: Array<{
  id: AppTheme;
  label: string;
  previewClass: string;
}> = [
  { id: "light", label: "Light", previewClass: "bg-[#f2f3f5]" },
  { id: "dark", label: "Midnight", previewClass: "bg-[#0f0f11]" },
  {
    id: "system",
    label: "System",
    previewClass: "bg-gradient-to-br from-[#0f0f11] to-[#f2f3f5]",
  },
  {
    id: "miku-light",
    label: "Miku Light",
    previewClass: "bg-gradient-to-br from-[#ffffff] via-[#e8f4fd] to-[#f872a5]",
  },
  {
    id: "miku-dark",
    label: "Miku Dark",
    previewClass: "bg-gradient-to-br from-[#13111f] via-[#0f0d19] to-[#f872a5]",
  },
  {
    id: "spiderman-light",
    label: "Spider-Man Light",
    previewClass: "bg-gradient-to-br from-[#ffffff] via-[#eef0f6] to-[#E50914]",
  },
  {
    id: "spiderman-dark",
    label: "Spider-Man Dark",
    previewClass: "bg-gradient-to-br from-[#06050a] via-[#0b0a10] to-[#E50914]",
  },
];

const TITLE = "Preview theme";
const DESCRIPTION = "Switch themes and see the current screen update live.";

interface ThemePreviewSidebarProps {
  open: boolean;
  /** Escape, back, the close button and "Back to settings" all land here. */
  onBackToSettings: () => void;
  /** Force one form (fixtures, tests). */
  forceMode?: "sheet" | "drawer";
}

/**
 * Live theme preview (design-system 12.10): a right side sheet on desktop, a
 * bottom drawer on phones so the app stays visible above it. Neither dims the
 * page; seeing the app in the new theme is the point.
 */
export default function ThemePreviewSidebar({
  open,
  onBackToSettings,
  forceMode,
}: ThemePreviewSidebarProps) {
  const isMobile = useIsMobile();
  const drawer = forceMode ? forceMode === "drawer" : isMobile;
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) onBackToSettings();
  };

  const closeButton = (
    <IconButton
      icon="close"
      size="sm"
      variant="muted"
      aria-label="Close preview"
      onClick={onBackToSettings}
    />
  );
  const backButton = (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      onClick={onBackToSettings}
    >
      <Icon name="chevronLeft" size="sm" />
      Back to settings
    </Button>
  );

  if (drawer) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent hideOverlay aria-label={TITLE}>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
            <DrawerTitle className="min-w-0 flex-1 truncate text-ui-md font-semibold">
              {TITLE}
            </DrawerTitle>
          </div>
          <DrawerDescription className="sr-only">
            {DESCRIPTION}
          </DrawerDescription>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 custom-scrollbar">
            <ThemeGrid compact />
          </div>
          <div className="shrink-0 px-4 pt-2">{backButton}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" hideOverlay aria-label={TITLE}>
        <SheetHeader>
          <SheetTitle>{TITLE}</SheetTitle>
          {closeButton}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 custom-scrollbar">
          <SheetDescription className="mb-4">{DESCRIPTION}</SheetDescription>
          <ThemeGrid />
        </div>
        <SheetFooter className="border-t border-line">{backButton}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ThemeGrid({ compact = false }: { compact?: boolean }) {
  const { theme, setAppearanceTheme } = useAppearanceTheme();

  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-3" : "grid-cols-2")}>
      {THEME_OPTIONS.map((option) => {
        const active = theme === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => void setAppearanceTheme(option.id)}
            className={cn(
              "rounded-lg border p-2 text-left",
              PRESS,
              active
                ? "border-accent-ink bg-accent-tint ring-1 ring-accent-ink"
                : "border-line bg-tint-1",
            )}
          >
            <div
              className={cn(
                "mb-2 rounded-md",
                compact ? "h-12" : "h-20",
                option.previewClass,
              )}
            />
            <span
              className={cn(
                "block truncate text-ui-xs font-semibold",
                active ? "text-accent-ink" : "text-ink-1",
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
