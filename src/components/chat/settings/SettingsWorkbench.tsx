/**
 * The settings workbench shell (design-system 12.6, 12.8, 13.1), extracted
 * from Studio so every settings-like surface shares one frame:
 *
 *   desktop  a 1120 x 820 dialog: a 240px nav column on the leading side, a
 *            titled page (48px+ header, one scroller) on the trailing side
 *   phone    a full-screen page. The nav is a list that pushes into pages;
 *            the page header has a back button. Safe areas on both edges.
 *
 *   <SettingsWorkbench
 *     open={open}
 *     onClose={onClose}
 *     title="Server settings"
 *     activeId={tab}
 *     showList={showList}
 *     onShowListChange={setShowList}
 *     nav={<WorkbenchNav groups={groups} activeId={tab} onSelect={go} />}
 *     pageTitle="Roles"
 *   >
 *     <SettingsCard title="…">…</SettingsCard>
 *   </SettingsWorkbench>
 *
 * Escape (and the Android back button) steps back one level at a time:
 * an open inline confirm, then `onEscape` (a search query), then `back`
 * (a nested page such as the role editor), then the phone list, then close.
 *
 * Inline confirms (`useConfirm`) register with the workbench through
 * SettingsContext, so they work inside any workbench, not only Studio.
 */

import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { HIT, PRESS } from "@/components/ui/interaction";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  rovingKeyDown,
  SettingsContext,
  type SettingsContextValue,
} from "./primitives";

/* ------------------------------------------------------------------ */
/* Nav                                                                  */
/* ------------------------------------------------------------------ */

export type WorkbenchNavItem = {
  id: string;
  label: string;
  icon: IconName;
  disabled?: boolean;
  /** Trailing content on desktop (a count). Phones show a chevron. */
  trailing?: ReactNode;
  /** Accessible name when it differs from the label (search counts). */
  ariaLabel?: string;
};

export type WorkbenchNavGroup = {
  /** Group heading; omit for a single untitled group. */
  title?: string;
  items: WorkbenchNavItem[];
};

/**
 * One nav row (12.3 on desktop, 12.4 on phones). Selected: tint fill,
 * Fill icon and 600 weight (14.5). `data-workbench-item` lets the shell put
 * focus back on it when a phone page pops.
 */
export function WorkbenchNavButton({
  item,
  current,
  narrow,
  tabbable,
  onSelect,
}: {
  item: WorkbenchNavItem;
  current: boolean;
  narrow: boolean;
  tabbable: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-roving
      data-workbench-item={item.id}
      tabIndex={tabbable ? 0 : -1}
      disabled={item.disabled}
      aria-current={current ? "page" : undefined}
      aria-label={item.ariaLabel}
      onClick={() => onSelect(item.id)}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2 text-left outline-offset-[-2px] transition-colors duration-150 ease-(--rm-ease-out) disabled:cursor-default disabled:opacity-45",
        PRESS,
        HIT,
        narrow ? "min-h-12 px-3 text-ui-md" : "h-8 text-ui-sm",
        current
          ? "bg-rm-tint-2 font-semibold text-rm-text"
          : "font-medium text-rm-text-secondary pointer-fine:hover:enabled:bg-rm-tint-1 pointer-fine:hover:enabled:text-rm-text",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Icon
          name={item.icon}
          size="md"
          state={current ? ("active" as never) : undefined}
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.trailing ??
        (narrow ? (
          <Icon
            name="chevronRight"
            size="xs"
            className="shrink-0 text-rm-text-muted"
          />
        ) : null)}
    </button>
  );
}

/** Grouped nav list with roving arrow-key focus. */
export function WorkbenchNav({
  groups,
  activeId,
  onSelect,
}: {
  groups: WorkbenchNavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const narrow = useIsMobile();
  const visible = groups.filter((group) => group.items.length > 0);
  const firstId = visible[0]?.items[0]?.id;
  return (
    <div onKeyDown={(event) => rovingKeyDown(event)}>
      {visible.map((group, index) => (
        <div key={group.title ?? index} className="mt-4 first:mt-0">
          {group.title ? (
            <h3 className="px-2 pb-1 text-ui-xs font-semibold text-rm-text-secondary">
              {group.title}
            </h3>
          ) : null}
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => (
              <li key={item.id}>
                <WorkbenchNavButton
                  item={item}
                  narrow={narrow}
                  current={!narrow && item.id === activeId}
                  tabbable={narrow ? item.id === firstId : item.id === activeId}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                                */
/* ------------------------------------------------------------------ */

export type SettingsWorkbenchProps = {
  open: boolean;
  onClose: () => void;
  /** Dialog name and nav heading ("Settings", "Server settings"). */
  title: string;
  /** Line under the nav heading (the server or channel name). */
  subtitle?: ReactNode;
  closeLabel?: string;
  /** Pinned above the nav list (Studio's search field). */
  navTop?: ReactNode;
  /** Nav list content; usually <WorkbenchNav>. */
  nav: ReactNode;
  /** Id of the selected nav item, to restore focus when a phone page pops. */
  activeId: string;
  /** Phone only: the list is showing instead of a page. */
  showList: boolean;
  onShowListChange: (showList: boolean) => void;
  pageTitle: ReactNode;
  /** Changes re-run the page enter animation. Defaults to `activeId`. */
  pageKey?: string;
  /**
   * A nested page (role editor, permission override). The header shows its
   * back button on every width and Escape takes it first.
   */
  back?: { label: string; onBack: () => void };
  /** Extra header controls before the close button. */
  headerActions?: ReactNode;
  /** Sticky footer under the scroller (a save bar). Gets safe-area padding. */
  footer?: ReactNode;
  /** Escape handler that runs before `back` (clear a search). */
  onEscape?: () => boolean;
  /**
   * prose: content capped at 720 and centred (12.1).
   * full: the page lays itself out (split editors, Studio's preview rail).
   */
  width?: "prose" | "full";
  /** Kept mounted but hidden (Studio's theme preview sheet). */
  hidden?: boolean;
  /** Opened over another dialog: overlay and surface move to z-60. */
  stacked?: boolean;
  bodyRef?: (node: HTMLDivElement | null) => void;
  mainRef?: (node: HTMLDivElement | null) => void;
  /** Pointer down in the scroller (Studio clears its landing highlight). */
  onBodyPointerDown?: () => void;
  children: ReactNode;
};

const WORKBENCH_SURFACE =
  "fixed inset-0 m-0 flex h-full w-full min-h-0 flex-row items-stretch overflow-hidden bg-rm-bg-primary p-0 outline-none md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(820px,calc(100dvh-32px))] md:w-[min(1120px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border md:border-rm-border md:shadow-2xl animate-in fade-in duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-150 md:zoom-in-[0.98] md:data-[state=closed]:zoom-out-[0.98]";

export function SettingsWorkbench({
  open,
  onClose,
  title,
  subtitle,
  closeLabel,
  navTop,
  nav,
  activeId,
  showList,
  onShowListChange,
  pageTitle,
  pageKey,
  back,
  headerActions,
  footer,
  onEscape,
  width = "prose",
  hidden = false,
  stacked = false,
  bodyRef,
  mainRef,
  onBodyPointerDown,
  children,
}: SettingsWorkbenchProps) {
  const narrow = useIsMobile();
  const titleId = useId();
  const pageTitleId = useId();
  const navRef = useRef<HTMLElement>(null);
  const pageTitleRef = useRef<HTMLHeadingElement>(null);
  const escapeStack = useRef<Array<() => boolean>>([]);
  const close = closeLabel ?? `Close ${title.toLowerCase()}`;

  const pageVisible = !narrow || !showList;
  const listVisible = !narrow || showList;

  /* Inline confirms register here, whoever provides the rest of the context. */
  const parent = useContext(SettingsContext);
  const registerEscape = useCallback((handler: () => boolean) => {
    escapeStack.current.push(handler);
    return () => {
      escapeStack.current = escapeStack.current.filter((h) => h !== handler);
    };
  }, []);
  const contextValue = useMemo<SettingsContextValue>(
    () => ({ ...parent, registerEscape }),
    [parent, registerEscape],
  );

  /** One step back. Returns false when the dialog itself should close. */
  const stepBack = useCallback(() => {
    const handler = escapeStack.current[escapeStack.current.length - 1];
    if (handler?.()) return true;
    if (onEscape?.()) return true;
    if (back) {
      back.onBack();
      return true;
    }
    if (narrow && !showList) {
      onShowListChange(true);
      return true;
    }
    return false;
  }, [back, narrow, onEscape, onShowListChange, showList]);

  /* Phone push: focus the page heading on push, the nav row on pop. */
  const previousShowList = useRef(showList);
  useEffect(() => {
    if (narrow && previousShowList.current && !showList) {
      pageTitleRef.current?.focus({ preventScroll: true });
    }
    if (narrow && !previousShowList.current && showList) {
      navRef.current
        ?.querySelector<HTMLElement>(`[data-workbench-item="${activeId}"]`)
        ?.focus({ preventScroll: true });
    }
    previousShowList.current = showList;
  }, [activeId, narrow, showList]);

  /* A nested page opening or closing moves focus to its heading too. */
  const hadBack = useRef(Boolean(back));
  useEffect(() => {
    if (hadBack.current !== Boolean(back)) {
      pageTitleRef.current?.focus({ preventScroll: true });
    }
    hadBack.current = Boolean(back);
  }, [back]);

  const headerBack = back
    ? back
    : narrow
      ? {
          label: `Back to ${title.toLowerCase()}`,
          onBack: () => onShowListChange(true),
        }
      : null;

  return (
    <SettingsContext.Provider value={contextValue}>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return;
          if (!stepBack()) onClose();
        }}
      >
        <DialogPortal>
          {!hidden ? (
            <DialogOverlay className={stacked ? "z-60" : undefined} />
          ) : null}
          <DialogSurface
            showCloseButton={false}
            aria-labelledby={titleId}
            data-settings-workbench=""
            onOpenAutoFocus={(event) => {
              // Phones land on the list or the page heading; coarse tablets
              // land on the nav so the on-screen keyboard stays down.
              const coarse =
                typeof window !== "undefined" &&
                window.matchMedia?.("(pointer: coarse)").matches;
              if (narrow || coarse) {
                event.preventDefault();
                (showList || !narrow
                  ? navRef.current
                  : pageTitleRef.current
                )?.focus?.();
              }
            }}
            onEscapeKeyDown={(event) => {
              if (stepBack()) event.preventDefault();
            }}
            className={cn(
              WORKBENCH_SURFACE,
              stacked ? "z-60" : "z-50",
              hidden && "invisible",
            )}
          >
            <DialogTitle id={titleId} className="sr-only">
              {title}
            </DialogTitle>
            <nav
              ref={navRef}
              tabIndex={-1}
              aria-label={`${title} navigation`}
              aria-hidden={!listVisible ? "true" : undefined}
              inert={!listVisible ? true : undefined}
              className={cn(
                "flex min-h-0 flex-col bg-rm-bg-sidebar outline-none",
                narrow
                  ? "w-full pt-[var(--safe-area-top,0px)]"
                  : "w-[240px] shrink-0 border-r border-rm-border",
                !listVisible && "hidden",
              )}
            >
              <div className="flex flex-col gap-3 px-3 pb-3 pt-3">
                <div className="flex min-h-8 items-center justify-between gap-2 pl-1">
                  <div aria-hidden="true" className="min-w-0">
                    <p className="truncate text-ui-lg font-semibold text-rm-text">
                      {title}
                    </p>
                    {subtitle ? (
                      <p className="truncate text-ui-xs text-rm-text-secondary">
                        {subtitle}
                      </p>
                    ) : null}
                  </div>
                  {narrow ? (
                    <IconButton
                      aria-label={close}
                      icon="close"
                      size="sm"
                      onClick={onClose}
                    />
                  ) : null}
                </div>
                {navTop}
              </div>
              <div className="rm-settings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(16px,var(--safe-area-bottom,0px))]">
                {nav}
              </div>
            </nav>
            <div
              ref={mainRef}
              role="region"
              aria-label={`${title} content`}
              aria-hidden={!pageVisible ? "true" : undefined}
              inert={!pageVisible ? true : undefined}
              className={cn(
                "@container relative flex min-h-0 min-w-0 flex-1 flex-col bg-rm-bg-primary",
                narrow && "pt-[var(--safe-area-top,0px)]",
                !pageVisible && "hidden",
              )}
            >
              {/* Settings exception (12.2): the page header is h-14 with an
                  xl title; it is the page heading, not a nav bar. */}
              <header className="flex h-14 shrink-0 items-center gap-2 border-b border-rm-border px-3 md:px-6">
                {headerBack ? (
                  <IconButton
                    aria-label={headerBack.label}
                    icon="chevronLeft"
                    size="sm"
                    onClick={headerBack.onBack}
                    className={cn(!narrow && "-ml-2")}
                  />
                ) : null}
                <h2
                  id={pageTitleId}
                  ref={pageTitleRef}
                  tabIndex={-1}
                  className="min-w-0 flex-1 truncate text-ui-xl font-semibold text-rm-text outline-none"
                >
                  {pageTitle}
                </h2>
                {headerActions}
                <IconButton
                  aria-label={close}
                  icon="close"
                  size="sm"
                  onClick={onClose}
                />
              </header>
              <div
                ref={bodyRef}
                onPointerDown={onBodyPointerDown}
                className="rm-settings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                {pageVisible ? (
                  <div
                    key={`${pageKey ?? activeId}-${narrow ? "n" : "w"}`}
                    className={cn(
                      "px-4 pt-5 md:px-6",
                      footer
                        ? "pb-8"
                        : "pb-[calc(64px+var(--safe-area-bottom,0px))]",
                      narrow ? "rm-settings-push-in" : "rm-settings-panel-in",
                    )}
                  >
                    {width === "prose" ? (
                      <div className="mx-auto flex max-w-[720px] min-w-0 flex-col gap-4">
                        {children}
                      </div>
                    ) : (
                      children
                    )}
                  </div>
                ) : null}
              </div>
              {footer && pageVisible ? (
                <div className="shrink-0 border-t border-rm-border bg-rm-bg-primary px-4 pt-3 pb-[max(12px,var(--safe-area-bottom,0px))] md:px-6">
                  {footer}
                </div>
              ) : null}
            </div>
          </DialogSurface>
        </DialogPortal>
      </Dialog>
    </SettingsContext.Provider>
  );
}
