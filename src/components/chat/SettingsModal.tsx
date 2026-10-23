/**
 * User settings, Studio direction: a grouped nav with row-level search on the
 * leading side, a titled page of calm cards on the trailing side, and a live
 * preview rail on the pages where you judge a feel (profile, voice, theme,
 * alerts). On narrow screens the nav is a list that pushes into pages.
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
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
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

import SettingsAccountTab from "./SettingsAccountTab";
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
  const pageTitleId = useId();
  const env = useMemo<SettingsEnvironment>(
    () => ({ desktop: environment?.desktop ?? isDesktop() }),
    [environment?.desktop],
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
  const pageTitleRef = useRef<HTMLHeadingElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [setMainNode, mainWidth] = useElementWidth<HTMLDivElement>();
  const railBeside = mainWidth >= RAIL_MIN_WIDTH;
  const escapeStack = useRef<Array<() => boolean>>([]);

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
  const shownPanel: SettingsPanelId =
    q && !hitsByPanel.has(panel) ? (hits[0]?.panel.id ?? panel) : panel;

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
  /* Landing, focus and scroll                                         */
  /* ---------------------------------------------------------------- */

  const pageVisible = !narrow || !showList;
  const listVisible = !narrow || showList;

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

  const previousShowList = useRef(showList);
  useEffect(() => {
    if (narrow && previousShowList.current && !showList && !target) {
      pageTitleRef.current?.focus({ preventScroll: true });
    }
    if (narrow && !previousShowList.current && showList) {
      navRef.current
        ?.querySelector<HTMLElement>(`[data-panel="${panel}"]`)
        ?.focus({ preventScroll: true });
    }
    previousShowList.current = showList;
  }, [narrow, panel, showList, target]);

  /* ---------------------------------------------------------------- */
  /* Escape and back                                                    */
  /* ---------------------------------------------------------------- */

  const registerEscape = useCallback((handler: () => boolean) => {
    escapeStack.current.push(handler);
    return () => {
      escapeStack.current = escapeStack.current.filter((h) => h !== handler);
    };
  }, []);

  /** One step back. Returns false when the dialog itself should close. */
  const stepBack = useCallback(() => {
    const handler = escapeStack.current[escapeStack.current.length - 1];
    if (handler?.()) return true;
    if (query) {
      setQuery("");
      return true;
    }
    if (narrow && !showList) {
      setShowList(true);
      return true;
    }
    return false;
  }, [narrow, query, showList]);

  const handleModalCloseOrBack = useCallback(() => {
    if (profileEditorOpen) {
      setProfileEditorOpen(false);
    } else if (previewOpen) {
      setPreviewOpen(false);
    } else if (narrow && !showList) {
      setShowList(true);
    } else {
      close();
    }
  }, [close, narrow, previewOpen, profileEditorOpen, showList]);

  const contextValue = useMemo<SettingsContextValue>(
    () => ({
      env,
      query: q,
      target,
      registerEscape,
      openProfileEditor: (trigger) => {
        profileEditorTrigger.current = trigger ?? null;
        setProfileEditorOpen(true);
      },
      openThemePreview: () => setPreviewOpen(true),
    }),
    [env, q, registerEscape, target],
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

  const nav = (
    <>
      <div className="flex flex-col gap-3 px-3 pb-3 pt-3.5">
        <div className="flex h-8 items-center justify-between pl-1">
          <p
            aria-hidden="true"
            className="text-ui-lg font-semibold text-rm-text"
          >
            Settings
          </p>
          {narrow ? (
            <IconButton
              aria-label="Close settings"
              icon="close"
              size="sm"
              onClick={close}
            />
          ) : null}
        </div>
        <div className="relative flex h-9 items-center">
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
      </div>
      <div
        onKeyDown={(event) => rovingKeyDown(event)}
        className="rm-settings-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-[max(16px,var(--safe-area-bottom,0px))]"
      >
        {noHits ? (
          <div className="px-2.5 py-3" role="status">
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
              <h3 className="px-2.5 pb-1 text-ui-xs font-semibold text-rm-text-secondary">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-px">
                {group.ids.map((id) => {
                  const def = PANEL_BY_ID[id];
                  const panelHits = hitsByPanel.get(id) ?? [];
                  const count = panelHits.length;
                  const current = !narrow && shownPanel === id;
                  const empty = Boolean(q) && count === 0;
                  const tabbable = narrow
                    ? group === navGroups[0] && id === group.ids[0]
                    : shownPanel === id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        data-roving
                        data-panel={id}
                        tabIndex={tabbable ? 0 : -1}
                        disabled={empty}
                        aria-current={current ? "page" : undefined}
                        aria-label={
                          q
                            ? `${def.title}, ${count === 1 ? "1 match" : `${count} matches`}`
                            : undefined
                        }
                        onClick={() => go(id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2.5 text-left text-ui-sm outline-offset-[-2px] transition-[background-color,color,transform] duration-150 ease-(--rm-ease-out) enabled:active:scale-[0.98] motion-reduce:enabled:active:scale-100 disabled:cursor-default disabled:opacity-45",
                          narrow ? "h-11" : "h-8",
                          current
                            ? "bg-rm-bg-active font-medium text-rm-text"
                            : "text-rm-text-secondary pointer-fine:enabled:pointer-fine:hover:bg-rm-bg-hover pointer-fine:enabled:pointer-fine:hover:text-rm-text",
                        )}
                      >
                        <Icon name={def.icon} size="sm" className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {def.title}
                        </span>
                        {q ? (
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
                        ) : narrow ? (
                          <Icon
                            name="chevronRight"
                            size="xs"
                            className="shrink-0"
                          />
                        ) : null}
                      </button>
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
                                  className="flex w-full flex-col items-start rounded-md py-1.5 pl-9 pr-2.5 text-left transition-colors duration-150 pointer-fine:hover:bg-rm-bg-hover"
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
                            <li className="py-1 pl-9 text-ui-xs text-rm-text-secondary">
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
    </>
  );

  /* ---------------------------------------------------------------- */
  /* Page                                                               */
  /* ---------------------------------------------------------------- */

  const page = (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-rm-border px-3 md:px-6">
        {narrow ? (
          <IconButton
            aria-label="Back to all settings"
            icon="chevronLeft"
            size="sm"
            onClick={() => setShowList(true)}
          />
        ) : null}
        <h2
          id={pageTitleId}
          ref={pageTitleRef}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-ui-xl font-semibold text-rm-text outline-none"
        >
          {noHits ? "No matches" : pageDef.title}
        </h2>
        <IconButton
          aria-label="Close settings"
          icon="close"
          size="sm"
          onClick={close}
        />
      </header>
      <div
        ref={setBodyNode}
        onPointerDown={() => target && setTarget(null)}
        className="rm-settings-scroll min-h-0 flex-1 overflow-y-auto"
      >
        {pageVisible ? (
          <div
            key={`${shownPanel}-${narrow ? "n" : "w"}`}
            className={cn(
              "flex gap-8 px-4 pb-[calc(64px+var(--safe-area-bottom,0px))] pt-5 md:px-6",
              narrow ? "rm-settings-push-in" : "rm-settings-panel-in",
            )}
          >
            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-5",
                !(showRail && railBeside) && "mx-auto max-w-[720px]",
              )}
            >
              {noHits ? (
                <div className="rounded-lg border border-dashed border-rm-border-strong px-5 py-8 text-center">
                  <p className="text-ui-base font-medium text-rm-text">
                    No settings match “{q}”
                  </p>
                  <p className="mt-1 text-ui-sm text-rm-text-secondary">
                    Check the spelling, or search for what a setting does, like
                    “echo” or “startup”.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-4"
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
        ) : null}
      </div>
    </>
  );

  return (
    <SettingsContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={300}>
        <Dialog
          open={isOpen}
          onOpenChange={(nextOpen) => !nextOpen && handleModalCloseOrBack()}
        >
          <DialogPortal>
            {!previewOpen && <DialogOverlay className="bg-rm-scrim" />}
            <DialogSurface
              showCloseButton={false}
              aria-labelledby={titleId}
              onOpenAutoFocus={(event) => {
                if (narrow) {
                  event.preventDefault();
                  (showList ? navRef.current : pageTitleRef.current)?.focus?.();
                }
              }}
              onEscapeKeyDown={(event) => {
                if (previewOpen || profileEditorOpen) return;
                if (stepBack()) event.preventDefault();
              }}
              className={cn(
                "fixed inset-0 z-50 m-0 flex min-h-0 items-stretch overflow-hidden p-0 outline-none",
                previewOpen
                  ? "h-full max-w-none flex-row border-0 bg-transparent shadow-none"
                  : "h-full w-full flex-row bg-rm-bg-primary md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(820px,calc(100dvh-32px))] md:w-[min(1120px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border md:border-rm-border-strong md:shadow-[var(--rm-shadow-3)]",
                "animate-in fade-in duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out",
                !previewOpen &&
                  "md:zoom-in-[0.98] md:data-[state=closed]:zoom-out-[0.98]",
              )}
            >
              <DialogTitle id={titleId} className="sr-only">
                Settings
              </DialogTitle>
              {previewOpen ? (
                <div className="pointer-events-none flex h-full w-full justify-end bg-transparent">
                  <div className="flex-1 bg-transparent" />
                  <ThemePreviewSidebar
                    className="max-w-[320px]"
                    onClose={() => setPreviewOpen(false)}
                    onBackToSettings={() => setPreviewOpen(false)}
                  />
                </div>
              ) : (
                <>
                  <nav
                    ref={navRef}
                    tabIndex={-1}
                    aria-label="Settings navigation"
                    aria-hidden={!listVisible ? "true" : undefined}
                    inert={!listVisible ? true : undefined}
                    className={cn(
                      "flex min-h-0 flex-col bg-rm-bg-sidebar outline-none",
                      narrow
                        ? "w-full"
                        : "w-[240px] shrink-0 border-r border-rm-border",
                      !listVisible && "hidden",
                    )}
                    style={
                      narrow
                        ? { paddingTop: "var(--safe-area-top, 0px)" }
                        : undefined
                    }
                  >
                    {nav}
                  </nav>
                  <div
                    ref={setMainNode}
                    role="region"
                    aria-label="Settings content"
                    aria-hidden={!pageVisible ? "true" : undefined}
                    inert={!pageVisible ? true : undefined}
                    className={cn(
                      "@container relative flex min-h-0 min-w-0 flex-1 flex-col bg-rm-bg-primary",
                      !pageVisible && "hidden",
                    )}
                    style={
                      narrow
                        ? { paddingTop: "var(--safe-area-top, 0px)" }
                        : undefined
                    }
                  >
                    {page}
                  </div>
                </>
              )}
            </DialogSurface>
          </DialogPortal>
        </Dialog>

        <Dialog
          open={isOpen && profileEditorOpen && !previewOpen}
          onOpenChange={(nextOpen) => {
            setProfileEditorOpen(nextOpen);
            if (!nextOpen) {
              const trigger = profileEditorTrigger.current;
              requestAnimationFrame(() => trigger?.focus());
            }
          }}
        >
          <DialogPortal>
            <DialogSurface
              showCloseButton={false}
              aria-label="Edit profile"
              className="fixed inset-0 z-60 flex items-center justify-center overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary p-0 shadow-2xl animate-in fade-in zoom-in-95 duration-200 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 max-md:rounded-none max-md:border-0 max-md:pt-[var(--safe-area-top,0px)] max-md:pb-[var(--safe-area-bottom,0px)] md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(860px,calc(100dvh-32px))] md:w-[min(1240px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
              // Full screen on phones; the framed editor from md up.
              style={
                narrow
                  ? undefined
                  : {
                      width: "min(1240px, calc(100vw - 32px))",
                      height: "min(860px, calc(100dvh - 32px))",
                    }
              }
            >
              <SettingsAccountTab
                authUserLoaded={isUserLoaded}
                asModal
                onClose={() => setProfileEditorOpen(false)}
              />
            </DialogSurface>
          </DialogPortal>
        </Dialog>
      </TooltipProvider>
    </SettingsContext.Provider>
  );
}
