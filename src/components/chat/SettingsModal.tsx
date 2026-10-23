/**
 * User settings, Studio direction: a grouped nav with row-level search on the
 * leading side, a titled page of calm cards on the trailing side, and a live
 * preview rail on the pages where you judge a feel (profile, voice, theme,
 * alerts). On narrow screens the nav is a list that pushes into pages.
 *
 * The frame (dialog, nav column, page header, scroller, phone push and the
 * Escape ladder) is the shared SettingsWorkbench; this file owns search,
 * landing on a row and the preview rail.
 *
 * Opening:
 *   openSettings({ row: "sign-out" })   // from anywhere, see settings-links
 *
 * The app mounts this once, through SettingsHost, which feeds it the
 * settings store. Fixtures and tests can still drive it with props:
 *   <SettingsModal open initialTab="voice" initialRow="echo-cancellation" />
 *
 * Panels live in ./settings; the row map (labels, search words, ids) is
 * ./settings/schema.ts.
 */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { PRESS } from "@/components/ui/interaction";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { isDesktop } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { useUser } from "@kova/react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";

import ProfileEditorModal from "./ProfileEditorModal";
import ThemePreviewSidebar from "./ThemePreviewSidebar";
import AccountPanel from "./settings/AccountPanel";
import AppearancePanel from "./settings/AppearancePanel";
import DesktopPanel from "./settings/DesktopPanel";
import KeybindsPanel from "./settings/KeybindsPanel";
import NotificationsPanel from "./settings/NotificationsPanel";
import PrivacyPanel from "./settings/PrivacyPanel";
import SessionsPanel from "./settings/SessionsPanel";
import SoundboardPanel from "./settings/SoundboardPanel";
import VoiceVideoPanel from "./settings/VoiceVideoPanel";
import {
  Highlight,
  rovingKeyDown,
  SettingsContext,
  type SettingsContextValue,
} from "./settings/primitives";
import { SettingsRail } from "./settings/rails";
import {
  SettingsWorkbench,
  WorkbenchNavButton,
} from "./settings/SettingsWorkbench";
import {
  isPanelAvailable,
  PANEL_BY_ID,
  PANELS_WITH_RAIL,
  searchSettings,
  SETTINGS_NAV_GROUPS,
  type SettingsEnvironment,
  type SettingsPanelId,
} from "./settings/schema";
import {
  resolveSettingsLocation,
  type SettingsTabInput,
} from "./settings/settings-links";

export type { SettingsTabInput } from "./settings/settings-links";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Panel id, or a pre-Studio tab name ("shares", "camera", …). */
  initialTab?: SettingsTabInput;
  /** Row id to land on and highlight (schema.ts). Implies its panel. */
  initialRow?: string;
  initialProfileEditorOpen?: boolean;
  /**
   * Bumped by the settings store on every open request. A new value while the
   * dialog is already open moves it to `initialTab` / `initialRow`.
   */
  requestId?: number;
  /** Overrides for what this device can show (fixtures and tests). */
  environment?: Partial<SettingsEnvironment>;
}

const PANEL_COMPONENTS: Record<SettingsPanelId, ComponentType> = {
  account: AccountPanel,
  sessions: SessionsPanel,
  privacy: PrivacyPanel,
  voice: VoiceVideoPanel,
  soundboard: SoundboardPanel,
  keybinds: KeybindsPanel,
  appearance: AppearancePanel,
  notifications: NotificationsPanel,
  desktop: DesktopPanel,
};

const RAIL_MIN_WIDTH = 840;
const MAX_ROW_HITS_PER_PANEL = 4;

/** Width of an element, tracked with ResizeObserver. */
function useElementWidth<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!node) return undefined;
    if (typeof ResizeObserver === "undefined") {
      const frame = requestAnimationFrame(() =>
        setWidth(node.getBoundingClientRect().width),
      );
      return () => cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width] as const;
}

/** Touch-first devices: keyboard shortcuts don't apply (ST-36). */
function useTouchOnly() {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || !window.matchMedia) {
        return () => {};
      }
      const query = window.matchMedia("(hover: none) and (pointer: coarse)");
      query.addEventListener?.("change", notify);
      return () => query.removeEventListener?.("change", notify);
    },
    () =>
      typeof window !== "undefined" &&
      Boolean(
        window.matchMedia?.("(hover: none) and (pointer: coarse)").matches,
      ),
    () => false,
  );
}

export default function SettingsModal({
  open,
  onClose,
  initialTab,
  initialRow,
  initialProfileEditorOpen = false,
  requestId = 0,
  environment,
}: SettingsModalProps) {
  const { isLoaded: isUserLoaded } = useUser();
  const titleId = useId();
  const touchOnly = useTouchOnly();
  const env = useMemo<SettingsEnvironment>(
    () => ({
      desktop: environment?.desktop ?? isDesktop(),
      touch: environment?.touch ?? touchOnly,
    }),
    [environment?.desktop, environment?.touch, touchOnly],
  );
  const narrow = useIsMobile();

  const isOpen = open;

  const initial = resolveSettingsLocation({
    tab: initialTab,
    row: initialRow,
  });
  const explicitInitial = Boolean(
    initialRow || (initialTab && initialTab !== "account"),
  );
  const [panel, setPanel] = useState<SettingsPanelId>(initial.panel);
  const [target, setTarget] = useState<string | null>(initial.row);
  const [showList, setShowList] = useState(
    () => !(initialProfileEditorOpen || explicitInitial),
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(
    initialProfileEditorOpen,
  );
  const profileEditorTrigger = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  // State, not a ref: the dialog portal mounts after this component's first
  // layout pass, and landing on a row has to wait for the scroller to exist.
  const [bodyNode, setBodyNode] = useState<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const [setMainNode, mainWidth] = useElementWidth<HTMLDivElement>();
  const railBeside = mainWidth >= RAIL_MIN_WIDTH;

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const desktopSettings = useDesktopSettingsStore();
  useEffect(() => {
    if (isDesktop()) {
      desktopSettings.syncToBackend();
    }
  }, [desktopSettings]);

  /* Reset to the requested location each time the dialog opens. */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      const location = initial;
      const explicit = explicitInitial || initialProfileEditorOpen;
      const available = isPanelAvailable(PANEL_BY_ID[location.panel], env);
      setPanel(available ? location.panel : "account");
      setTarget(available ? location.row : null);
      setShowList(!explicit);
      setQuery("");
    }
    wasOpen.current = isOpen;
    // Only the open transition matters; later prop changes don't move you.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /* A repeat open request while already open moves the dialog there. */
  const [seenRequestId, setSeenRequestId] = useState(requestId);
  if (requestId !== seenRequestId) {
    setSeenRequestId(requestId);
    if (isOpen && explicitInitial) {
      const available = isPanelAvailable(PANEL_BY_ID[initial.panel], env);
      setPanel(available ? initial.panel : "account");
      setTarget(available ? initial.row : null);
      setShowList(false);
      setQuery("");
    }
  }

  const close = useCallback(() => {
    if (open) onClose();
  }, [onClose, open]);

  /* ---------------------------------------------------------------- */
  /* Search                                                             */
  /* ---------------------------------------------------------------- */

  const q = deferredQuery.trim();
  const hits = useMemo(() => searchSettings(q, env), [q, env]);
  const hitsByPanel = useMemo(() => {
    const map = new Map<SettingsPanelId, typeof hits>();
    for (const hit of hits) {
      const list = map.get(hit.panel.id) ?? [];
      list.push(hit);
      map.set(hit.panel.id, list);
    }
    return map;
  }, [hits]);
  // A panel this device can't show (keybinds on a phone) falls back.
  const availablePanel: SettingsPanelId = isPanelAvailable(
    PANEL_BY_ID[panel],
    env,
  )
    ? panel
    : "account";
  const shownPanel: SettingsPanelId =
    q && !hitsByPanel.has(availablePanel)
      ? (hits[0]?.panel.id ?? availablePanel)
      : availablePanel;

  const navGroups = useMemo(
    () =>
      SETTINGS_NAV_GROUPS.map((group) => ({
        ...group,
        ids: group.ids.filter((id) => isPanelAvailable(PANEL_BY_ID[id], env)),
      })).filter((group) => group.ids.length > 0),
    [env],
  );

  const go = useCallback((id: SettingsPanelId, rowId: string | null = null) => {
    setPanel(id);
    setTarget(rowId);
    setShowList(false);
    if (rowId) setQuery("");
  }, []);

  /* ---------------------------------------------------------------- */
  /* Landing and scroll                                                 */
  /* ---------------------------------------------------------------- */

  const pageVisible = !narrow || !showList;

  useLayoutEffect(() => {
    const body = bodyNode;
    if (!body || !pageVisible) return;
    body.scrollTo?.({ top: 0 });
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      const row = body.querySelector<HTMLElement>(`[data-row="${target}"]`);
      row?.scrollIntoView?.({ block: "center" });
      row?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [bodyNode, panel, target, pageVisible, railBeside]);

  /** Escape inside the workbench clears a search before stepping back. */
  const clearQuery = useCallback(() => {
    if (!query) return false;
    setQuery("");
    return true;
  }, [query]);

  const contextValue = useMemo<SettingsContextValue>(
    () => ({
      env,
      query: q,
      target,
      // The workbench supplies the real escape stack.
      registerEscape: () => () => {},
      openProfileEditor: (trigger) => {
        profileEditorTrigger.current = trigger ?? null;
        setProfileEditorOpen(true);
      },
      openThemePreview: () => setPreviewOpen(true),
    }),
    [env, q, target],
  );

  if (!mounted) return null;

  const pageDef = PANEL_BY_ID[shownPanel];
  const PanelComponent = PANEL_COMPONENTS[shownPanel];
  // While searching, the rail stays only if one of its rows is a hit.
  const showRail =
    PANELS_WITH_RAIL.has(shownPanel) &&
    (!q || (hitsByPanel.get(shownPanel) ?? []).some((hit) => hit.row.rail));
  const noHits = Boolean(q) && hits.length === 0;

  /* ---------------------------------------------------------------- */
  /* Nav                                                                */
  /* ---------------------------------------------------------------- */

  const navTop = (
    <>
      <div className="relative flex h-9 items-center pointer-coarse:h-11">
        <Icon
          name="search"
          size="sm"
          className="pointer-events-none absolute left-2.5 text-rm-text-secondary"
        />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && hits[0]) {
              event.preventDefault();
              go(hits[0].panel.id, hits[0].row.id);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              navRef.current
                ?.querySelector<HTMLElement>("[data-roving]:not([disabled])")
                ?.focus();
            }
          }}
          placeholder="Search settings"
          aria-label="Search settings"
          aria-describedby={`${titleId}-count`}
          autoComplete="off"
          spellCheck={false}
          className="h-full w-full min-w-0 rounded-md border border-rm-field-edge bg-transparent pl-8 pr-8 text-ui-md text-rm-text outline-none placeholder:text-rm-text-secondary md:text-ui-sm [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <IconButton
            aria-label="Clear search"
            icon="close"
            size="xs"
            className="absolute right-1.5"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
          />
        ) : null}
      </div>
      <p id={`${titleId}-count`} className="sr-only" aria-live="polite">
        {q
          ? hits.length === 1
            ? "1 setting matches"
            : `${hits.length} settings match`
          : ""}
      </p>
    </>
  );

  const nav = (
    <div ref={navRef} onKeyDown={(event) => rovingKeyDown(event)}>
      {noHits ? (
        <div className="px-2 py-3" role="status">
          <p className="text-ui-sm font-medium text-rm-text">
            No settings match “{q}”
          </p>
          <p className="mt-1 text-ui-sm text-rm-text-secondary">
            Try “mic”, “theme” or “sign out”.
          </p>
        </div>
      ) : (
        navGroups.map((group) => (
          <div key={group.title} className="mt-4 first:mt-0">
            <h3 className="px-2 pb-1 text-ui-xs font-semibold text-rm-text-secondary">
              {group.title}
            </h3>
            <ul className="flex flex-col gap-px">
              {group.ids.map((id) => {
                const def = PANEL_BY_ID[id];
                const panelHits = hitsByPanel.get(id) ?? [];
                const count = panelHits.length;
                return (
                  <li key={id}>
                    <WorkbenchNavButton
                      narrow={narrow}
                      current={!narrow && shownPanel === id}
                      tabbable={
                        narrow
                          ? group === navGroups[0] && id === group.ids[0]
                          : shownPanel === id
                      }
                      onSelect={() => go(id)}
                      item={{
                        id,
                        label: def.title,
                        icon: def.icon,
                        disabled: Boolean(q) && count === 0,
                        ariaLabel: q
                          ? `${def.title}, ${count === 1 ? "1 match" : `${count} matches`}`
                          : undefined,
                        trailing: q ? (
                          <span
                            className={cn(
                              "min-w-5 rounded-full px-1.5 text-center text-ui-2xs font-semibold leading-5 tabular-nums",
                              count > 0
                                ? "bg-rm-accent-tint text-rm-accent-ink"
                                : "text-rm-text-secondary",
                            )}
                          >
                            {count}
                          </span>
                        ) : undefined,
                      }}
                    />
                    {q && count > 0 ? (
                      <ul className="mb-1 mt-px flex flex-col gap-px">
                        {panelHits
                          .slice(0, MAX_ROW_HITS_PER_PANEL)
                          .map((hit) => (
                            <li key={hit.row.id}>
                              <button
                                type="button"
                                data-roving
                                tabIndex={-1}
                                aria-label={
                                  hit.section &&
                                  hit.section.title !== hit.row.label
                                    ? `${hit.row.label}, ${hit.section.title}`
                                    : hit.row.label
                                }
                                onClick={() => go(id, hit.row.id)}
                                className={cn(
                                  "flex w-full flex-col items-start rounded-md py-1.5 pl-10 pr-2 text-left transition-colors duration-150 pointer-fine:hover:bg-rm-tint-1",
                                  PRESS,
                                )}
                              >
                                <span className="text-ui-sm text-rm-text">
                                  <Highlight text={hit.row.label} query={q} />
                                </span>
                                {hit.section &&
                                hit.section.title !== hit.row.label ? (
                                  <span className="text-ui-xs text-rm-text-secondary">
                                    {hit.section.title}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        {count > MAX_ROW_HITS_PER_PANEL ? (
                          <li className="py-1 pl-10 text-ui-xs text-rm-text-secondary">
                            {count - MAX_ROW_HITS_PER_PANEL} more on this page
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Page                                                               */
  /* ---------------------------------------------------------------- */

  const page = (
    <div className="flex gap-8">
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-4",
          !(showRail && railBeside) && "mx-auto max-w-[720px]",
        )}
      >
        {noHits ? (
          <div
            role="status"
            className="flex flex-col items-center gap-3 px-6 py-12 text-center"
          >
            <Icon
              name="search"
              size="3xl"
              className="text-rm-text-muted max-md:size-8"
            />
            <p className="text-ui-md font-semibold text-rm-text">
              No settings match “{q}”
            </p>
            <p className="max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
              Check the spelling, or search for what a setting does, like “echo”
              or “startup”.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              Clear search
            </Button>
          </div>
        ) : (
          <>
            {q ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-ui-sm text-rm-text-secondary">
                  {hitsByPanel.get(shownPanel)?.length === 1
                    ? `1 match for “${q}” on this page`
                    : `${hitsByPanel.get(shownPanel)?.length ?? 0} matches for “${q}” on this page`}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setQuery("")}
                >
                  Show all {pageDef.title} settings
                </Button>
              </div>
            ) : (
              <p className="text-pretty text-ui-sm text-rm-text-secondary">
                {pageDef.blurb}
              </p>
            )}
            {showRail && !railBeside ? (
              <div className="rounded-lg border border-rm-border bg-rm-bg-surface p-4">
                <SettingsRail panel={shownPanel} />
              </div>
            ) : null}
            <PanelComponent />
          </>
        )}
      </div>
      {showRail && railBeside ? (
        <aside
          aria-label="Preview"
          className="sticky top-5 w-[272px] shrink-0 self-start"
        >
          <SettingsRail panel={shownPanel} />
        </aside>
      ) : null}
    </div>
  );

  return (
    <SettingsContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={300}>
        <SettingsWorkbench
          open={isOpen}
          onClose={close}
          title="Settings"
          closeLabel="Close settings"
          navTop={navTop}
          nav={nav}
          activeId={shownPanel}
          showList={showList}
          onShowListChange={setShowList}
          pageTitle={noHits ? "No matches" : pageDef.title}
          pageKey={shownPanel}
          onEscape={clearQuery}
          initialFocus="first"
          width="full"
          // Hidden, not unmounted, while the theme preview sheet is up, so
          // "Back to settings" lands on the same page and row.
          hidden={previewOpen}
          bodyRef={setBodyNode}
          mainRef={setMainNode}
          onBodyPointerDown={() => target && setTarget(null)}
        >
          {page}
        </SettingsWorkbench>

        <ThemePreviewSidebar
          open={isOpen && previewOpen}
          onBackToSettings={() => setPreviewOpen(false)}
        />

        <ProfileEditorModal
          open={isOpen && profileEditorOpen && !previewOpen}
          stacked
          authUserLoaded={isUserLoaded}
          onClose={() => {
            setProfileEditorOpen(false);
            const trigger = profileEditorTrigger.current;
            requestAnimationFrame(() => trigger?.focus());
          }}
        />
      </TooltipProvider>
    </SettingsContext.Provider>
  );
}
