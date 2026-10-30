/**
 * User settings, Studio direction (component kit, direction C): a numbered
 * nav with a legend-plate search on the leading side; on the trailing side a
 * titled page: a kicker, a poster headline over a dithered rule, then rule
 * cards, with a live preview rail on the pages where you judge a feel
 * (profile, voice, theme, alerts). On narrow screens the nav is a list that
 * pushes into pages.
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
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { DitherRule } from "@/components/ui/dither";
import { FieldPlate, Input } from "@/components/ui/input";
import { PRESS } from "@/components/ui/interaction";
import { Kbd } from "@/components/ui/kbd";
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
  focusRovingItem,
  rovingKeyDown,
  SettingsContext,
  type SettingsContextValue,
} from "./settings/primitives";
import { SettingsRail } from "./settings/rails";
import {
  SettingsWorkbench,
  WorkbenchNavBranch,
  WorkbenchNavButton,
  WorkbenchNavLeaf,
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

/** The rail sits beside the cards once the page is this wide (wide dialog). */
const RAIL_MIN_WIDTH = 960;
const RAIL_WIDTH = 272;
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
  const searchId = `${titleId}-search`;
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
  // Landing from a search hit clears the query, but the page only widens to
  // every row once the deferred query catches up: land again then.
  const landedQuery = target ? q : null;

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
  }, [bodyNode, panel, target, pageVisible, railBeside, landedQuery]);

  /*
   * "/" (outside a text field) and Ctrl+F / Cmd+F focus the search, as long
   * as the key comes from inside this workbench (not a dialog over it).
   */
  useEffect(() => {
    if (!isOpen || previewOpen || env.touch) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const search = searchRef.current;
      if (!search || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const workbench = search.closest("[data-settings-workbench]");
      if (!target || !workbench?.contains(target)) return;
      const find =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "f";
      const slash =
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !target.closest("input, textarea, select, [contenteditable='true']");
      if (!find && !slash) return;
      event.preventDefault();
      search.focus();
      search.select();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [env.touch, isOpen, previewOpen]);

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
      <FieldPlate label="Search" htmlFor={searchId} ground="ply-1">
        <div className="relative">
          <Icon
            name="search"
            size="sm"
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-3"
          />
          <Input
            id={searchId}
            ref={searchRef}
            type="search"
            inputSize="lg"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              // A new search ends the landing on a row.
              setTarget(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && hits[0]) {
                event.preventDefault();
                go(hits[0].panel.id, hits[0].row.id);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                const list = navRef.current;
                if (list) {
                  focusRovingItem(
                    list,
                    list.querySelector<HTMLElement>(
                      "[data-roving]:not([disabled])",
                    ),
                  );
                }
              }
            }}
            placeholder="Search settings"
            aria-label="Search settings"
            aria-describedby={`${titleId}-count`}
            aria-keyshortcuts={env.touch ? undefined : "/ Control+F"}
            autoComplete="off"
            spellCheck={false}
            className="pr-12 pl-10 [&::-webkit-search-cancel-button]:hidden"
          />
          {!query && !env.touch ? (
            <Kbd
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
            >
              /
            </Kbd>
          ) : null}
          {query ? (
            <IconButton
              aria-label="Clear search"
              icon="close"
              size={32}
              className="absolute top-1/2 right-2 -translate-y-1/2"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            />
          ) : null}
        </div>
      </FieldPlate>
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
    <div
      ref={navRef}
      className="flex flex-col gap-4"
      onKeyDown={(event) => {
        // Typing a letter on the nav goes to the search field.
        if (
          event.key.length === 1 &&
          event.key !== " " &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          event.key !== "/"
        ) {
          searchRef.current?.focus();
          return;
        }
        rovingKeyDown(event);
      }}
    >
      {noHits ? (
        <div className="px-2 py-3" role="status">
          <p className="text-ui-sm font-medium text-ink-1">
            No settings match “{q}”
          </p>
          <p className="mt-1 text-ui-xs text-ink-3">
            Try “mic”, “theme” or “sign out”.
          </p>
        </div>
      ) : (
        navGroups.map((group) => (
          <WorkbenchNavBranch
            key={group.title}
            title={group.title}
            index={
              SETTINGS_NAV_GROUPS.findIndex(
                (candidate) => candidate.title === group.title,
              ) + 1
            }
          >
            {group.ids.map((id) => {
              const def = PANEL_BY_ID[id];
              const panelHits = hitsByPanel.get(id) ?? [];
              const count = panelHits.length;
              const current = !narrow && shownPanel === id;
              return (
                <WorkbenchNavLeaf
                  key={id}
                  current={current}
                  below={
                    q && count > 0 ? (
                      <ul className="mb-1 flex flex-col">
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
                                  "flex w-full flex-col items-start justify-center rounded-[2px] py-1 pl-10 pr-2 text-left outline-offset-[-2px] pointer-fine:hover:bg-tint-1 pointer-coarse:min-h-11",
                                  PRESS,
                                )}
                              >
                                <span className="text-ui-sm text-ink-1">
                                  <Highlight text={hit.row.label} query={q} />
                                </span>
                                {hit.section &&
                                hit.section.title !== hit.row.label ? (
                                  <span className="text-ui-xs text-ink-3">
                                    {hit.section.title}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        {count > MAX_ROW_HITS_PER_PANEL ? (
                          <li className="py-1 pl-10 text-ui-xs text-ink-3">
                            {count - MAX_ROW_HITS_PER_PANEL} more on this page
                          </li>
                        ) : null}
                      </ul>
                    ) : null
                  }
                >
                  <WorkbenchNavButton
                    narrow={narrow}
                    current={current}
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
                            "inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] px-1.5 text-num-xs",
                            count > 0
                              ? "bg-accent-tint text-accent-ink"
                              : "text-ink-3",
                          )}
                        >
                          {count}
                        </span>
                      ) : undefined,
                    }}
                  />
                </WorkbenchNavLeaf>
              );
            })}
          </WorkbenchNavBranch>
        ))
      )}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Page                                                               */
  /* ---------------------------------------------------------------- */

  const clearSearch = () => {
    setQuery("");
    searchRef.current?.focus();
  };

  const railAside = showRail && railBeside;
  const groupIndex = SETTINGS_NAV_GROUPS.findIndex((group) =>
    group.ids.includes(shownPanel),
  );
  const groupTitle = SETTINGS_NAV_GROUPS[groupIndex]?.title;
  const matchCount = hitsByPanel.get(shownPanel)?.length ?? 0;
  // The blurb is the page's lede under the headline; when the headline is
  // the blurb's own first sentence, only the rest of it is left to say.
  const lede = (() => {
    const blurb = pageDef.blurb;
    const first = blurb.split(/(?<=\.)\s+/)[0] ?? "";
    if (first.replace(/\.$/, "") !== pageDef.headline.replace(/\.$/, "")) {
      return blurb;
    }
    return blurb.slice(first.length).trim();
  })();

  // The top block: kicker, poster headline, a dithered rule, then the page's
  // one-line purpose (or what the search found on it).
  const top = noHits ? null : (
    <div className="max-w-[760px]">
      <p className="silkscreen text-ink-3">
        {groupIndex >= 0
          ? `${String(groupIndex + 1).padStart(2, "0")} ${groupTitle} · `
          : ""}
        {pageDef.title}
      </p>
      <p className="mt-2 font-display text-[36px] leading-[0.95] font-extrabold tracking-[-0.035em] text-balance text-ink-1 [font-optical-sizing:auto] md:text-[44px]">
        {pageDef.headline}
      </p>
      <DitherRule className="mt-5" cell={2} />
      {q ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-ui-sm text-ink-2">
            {matchCount === 1
              ? `1 match for “${q}” on this page`
              : `${matchCount} matches for “${q}” on this page`}
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
      ) : lede ? (
        <p className="mt-4 max-w-[62ch] text-pretty text-ui-sm text-ink-2">
          {lede}
        </p>
      ) : null}
    </div>
  );

  const cards = (
    <>
      {showRail && !railBeside ? <SettingsRail panel={shownPanel} /> : null}
      <PanelComponent />
    </>
  );

  // The column's left edge never moves: it starts 32px from the nav on every
  // page. Without a rail it is min(760px, 100%); with one, the cards take
  // what is left of a fixed-width rail.
  const page = noHits ? (
    <div className="w-full max-w-[760px]">
      <EmptyState
        role="status"
        title={`No settings match “${q}”`}
        description="Check the spelling, or search for what a setting does, like “echo” or “startup”."
        action={
          <Button type="button" variant="ghost" onClick={clearSearch}>
            Clear search
          </Button>
        }
        className="pt-12"
      />
    </div>
  ) : railAside ? (
    <div className="flex w-full flex-col gap-10">
      {top}
      <div
        className="grid items-start gap-8"
        style={{ gridTemplateColumns: `minmax(0,1fr) ${RAIL_WIDTH}px` }}
      >
        <div className="flex min-w-0 flex-col gap-10">
          <PanelComponent />
        </div>
        <aside aria-label="Preview" className="sticky top-8 min-w-0">
          <SettingsRail panel={shownPanel} />
        </aside>
      </div>
    </div>
  ) : (
    <div className="flex w-full max-w-[760px] flex-col gap-10">
      {top}
      {cards}
    </div>
  );

  return (
    <SettingsContext.Provider value={contextValue}>
      <TooltipProvider>
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
          pageIcon={noHits ? undefined : pageDef.icon}
          pageKey={shownPanel}
          onEscape={clearQuery}
          // Land on the nav, not the search: a text field always matches
          // :focus-visible, so focusing it painted a ring on every open.
          // "/" or Ctrl+F (or typing on the nav) goes to the search.
          initialFocus="nav"
          width="full"
          size="wide"
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
