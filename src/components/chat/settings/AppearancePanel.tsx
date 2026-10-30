import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { APP_THEMES, type AppTheme } from "@/lib/theme-preferences";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { useAppearanceTheme } from "../useAppearanceTheme";
import {
  rovingKeyDown,
  SettingsCard,
  SettingsRow,
  useSettings,
  ValueText,
} from "./primitives";

type ThemeSwatch = {
  bg: string;
  rail: string;
  sidebar: string;
  elevated: string;
  accent: string;
  text: string;
  textDim: string;
  border: string;
};

/** Hand-matched to each theme's tokens in styles.css, for the thumbnails. */
const SWATCHES: Record<Exclude<AppTheme, "system">, ThemeSwatch> = {
  dark: {
    bg: "#070709",
    rail: "#000000",
    sidebar: "#0d0d10",
    elevated: "#18181b",
    accent: "#5865f2",
    text: "#f7f7f7",
    textDim: "rgba(247,247,247,0.35)",
    border: "rgba(255,255,255,0.08)",
  },
  light: {
    bg: "#f2f3f5",
    rail: "#e3e5e8",
    sidebar: "#e3e5e8",
    elevated: "#ffffff",
    accent: "#5865f2",
    text: "#060607",
    textDim: "rgba(6,6,7,0.3)",
    border: "rgba(0,0,0,0.08)",
  },
  "miku-dark": {
    bg: "#0c0b14",
    rail: "#07060d",
    sidebar: "#0f0e1a",
    elevated: "#1b192e",
    accent: "#39c5bb",
    text: "#ffffff",
    textDim: "rgba(178,184,208,0.45)",
    border: "#23213a",
  },
  "miku-light": {
    bg: "#f3faf9",
    rail: "#d3ede8",
    sidebar: "#e1f3f0",
    elevated: "#ffffff",
    accent: "#00a399",
    text: "#1b2240",
    textDim: "rgba(61,71,102,0.35)",
    border: "#c0e7e1",
  },
  "spiderman-dark": {
    bg: "#020208",
    rail: "#000000",
    sidebar: "#03030b",
    elevated: "#0d0d22",
    accent: "#e50914",
    text: "#ffffff",
    textDim: "rgba(205,210,224,0.4)",
    border: "rgba(26,115,232,0.35)",
  },
  "spiderman-light": {
    bg: "#f8f9fc",
    rail: "#e8ebf3",
    sidebar: "#f1f3f9",
    elevated: "#ffffff",
    accent: "#e50914",
    text: "#0f172a",
    textDim: "rgba(71,85,105,0.35)",
    border: "rgba(15,23,42,0.08)",
  },
};

export const THEME_CHOICES: Array<{ id: AppTheme; label: string }> = [
  { id: "dark", label: "Midnight" },
  { id: "light", label: "Light" },
  { id: "miku-dark", label: "Miku Dark" },
  { id: "miku-light", label: "Miku Light" },
  { id: "spiderman-dark", label: "Spider-Man Dark" },
  { id: "spiderman-light", label: "Spider-Man Light" },
  { id: "system", label: "Match system" },
];

function ThemeMock({ t }: { t: ThemeSwatch }) {
  return (
    <span
      aria-hidden
      className="flex h-full w-full overflow-hidden"
      style={{ background: t.bg }}
    >
      <span
        className="flex w-[14%] flex-col items-center gap-[6%] pt-[8%]"
        style={{ background: t.rail }}
      >
        <span
          className="aspect-square w-[60%] rounded-full"
          style={{ background: t.accent }}
        />
        <span
          className="aspect-square w-[60%] rounded-full"
          style={{ background: t.elevated }}
        />
      </span>
      <span
        className="flex w-[28%] flex-col gap-[7%] px-[5%] pt-[10%]"
        style={{ background: t.sidebar }}
      >
        <span
          className="h-[6%] w-[80%] rounded-full"
          style={{ background: t.textDim }}
        />
        <span
          className="h-[6%] w-[60%] rounded-full"
          style={{ background: t.textDim }}
        />
        <span
          className="h-[12%] w-full rounded-[3px]"
          style={{
            background: t.elevated,
            boxShadow: `inset 0 0 0 1px ${t.border}`,
          }}
        />
      </span>
      <span className="flex flex-1 flex-col justify-end gap-[8%] p-[6%]">
        <span className="flex items-center gap-[6%]">
          <span
            className="aspect-square w-[14%] rounded-full"
            style={{ background: t.elevated }}
          />
          <span
            className="h-[10%] min-h-[3px] w-[60%] rounded-full"
            style={{ background: t.textDim }}
          />
        </span>
        <span className="flex items-center gap-[6%]">
          <span
            className="aspect-square w-[14%] rounded-full"
            style={{ background: t.accent }}
          />
          <span
            className="h-[10%] min-h-[3px] w-[45%] rounded-full"
            style={{ background: t.text, opacity: 0.85 }}
          />
        </span>
        <span
          className="h-[18%] min-h-[6px] rounded-[3px]"
          style={{
            background: t.elevated,
            boxShadow: `inset 0 0 0 1px ${t.border}`,
          }}
        />
      </span>
    </span>
  );
}

/** The theme currently on screen, falling back to the saved preference. */
export function useVisibleTheme() {
  const { theme, preferences } = useAppearanceTheme();
  return useMemo<AppTheme>(() => {
    if (theme && APP_THEMES.includes(theme as AppTheme)) {
      return theme as AppTheme;
    }
    return preferences.themePreference ?? "dark";
  }, [preferences.themePreference, theme]);
}

export default function AppearancePanel() {
  const { preferences, setAppearanceTheme, setThemeSyncEnabled } =
    useAppearanceTheme();
  const visibleTheme = useVisibleTheme();
  const { openThemePreview } = useSettings();

  return (
    <>
      <SettingsCard id="theme">
        <SettingsRow id="theme" layout="block" hideLabel>
          {(ids) => (
            <div
              role="radiogroup"
              aria-labelledby={ids.labelId}
              onKeyDown={(event) =>
                rovingKeyDown(event, { grid: true, select: true })
              }
              className="grid grid-cols-2 gap-x-3 gap-y-4 @min-[480px]:grid-cols-3 @min-[640px]:grid-cols-4"
            >
              {THEME_CHOICES.map(({ id, label }) => {
                const on = visibleTheme === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-roving
                    tabIndex={on ? 0 : -1}
                    onClick={() => void setAppearanceTheme(id)}
                    className="group flex min-w-0 flex-col gap-1.5 rounded-[2px] text-left transition-transform duration-150 ease-out enabled:active:scale-[0.97] motion-reduce:enabled:active:scale-100"
                  >
                    <span
                      className={cn(
                        "relative block aspect-[16/10] w-full overflow-hidden rounded-[2px]",
                        on
                          ? "ring-2 ring-ink-1 ring-offset-2 ring-offset-ply-0"
                          : "ring-1 ring-line-strong",
                      )}
                    >
                      {id === "system" ? (
                        <span className="absolute inset-0 flex">
                          <span className="relative w-1/2 overflow-hidden">
                            <span className="absolute inset-y-0 left-0 w-[200%]">
                              <ThemeMock t={SWATCHES.dark} />
                            </span>
                          </span>
                          <span className="relative w-1/2 overflow-hidden">
                            <span className="absolute inset-y-0 right-0 w-[200%]">
                              <ThemeMock t={SWATCHES.light} />
                            </span>
                          </span>
                        </span>
                      ) : (
                        <ThemeMock t={SWATCHES[id]} />
                      )}
                      {on ? (
                        <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-[2px] bg-primary-fill text-on-primary">
                          <Icon name="check" size="xs" />
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "truncate px-0.5 text-ui-sm",
                        on ? "font-semibold text-ink-1" : "text-ink-2",
                      )}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </SettingsRow>
        <SettingsRow id="theme-sync" layout="inline">
          {(ids) => (
            <SettingsSwitch
              checked={preferences.themeSyncEnabled}
              onChange={() =>
                void setThemeSyncEnabled(!preferences.themeSyncEnabled)
              }
              labelledBy={ids.labelId}
              describedBy={ids.descId}
            />
          )}
        </SettingsRow>
        <SettingsRow id="theme-preview" layout="inline">
          {(ids) => (
            <Button
              type="button"
              variant="secondary"
              aria-describedby={ids.descId}
              onClick={openThemePreview}
            >
              <Icon name="eye" size="sm" />
              Preview
            </Button>
          )}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard id="motion">
        <SettingsRow id="reduced-motion" layout="inline">
          {() => <ValueText>Follows your device</ValueText>}
        </SettingsRow>
      </SettingsCard>
    </>
  );
}
