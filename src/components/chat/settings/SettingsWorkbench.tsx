/**
 * The settings workbench shell (design-system 12.6, 12.8, 13.1; component kit,
 * direction C), extracted from Studio so every settings-like surface shares
 * one frame:
 *
 *   desktop  a dialog: a 264px nav (ply-1, 48px header, numbered silkscreen
 *            groups) on the leading side, a titled page (48px header, one
 *            scroller) on the trailing side
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
import { Kbd } from "@/components/ui/kbd";
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
import { UnsavedBar, type UnsavedBarProps } from "./UnsavedBar";
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
 * One nav row: 36 high (48 on phones), 20px icon, Geist 14. Selected: tint-2,
 * semibold ink-1, Fill icon; idle rows are ink-2 at 500 with a tint-1 hover.
 * `data-workbench-item` lets the shell put focus back on it when a phone page
 * pops.
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
        "flex w-full min-w-0 items-center gap-3 rounded-[2px] px-2 text-left outline-offset-[-2px] transition-colors duration-(--dur-1) ease-out disabled:cursor-default disabled:opacity-45",
        PRESS,
        HIT,
        narrow ? "min-h-12 px-3 text-ui-md" : "h-9 text-ui-row",
        current
          ? "bg-tint-2 font-semibold text-ink-1"
          : "font-medium text-ink-2 pointer-fine:hover:enabled:bg-tint-1 pointer-fine:hover:enabled:text-ink-1",
      )}
    >
      <Icon
        name={item.icon}
        size="lg"
        state={current ? ("active" as never) : undefined}
        className={cn("shrink-0", current ? "text-ink-1" : "text-ink-3")}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.trailing ??
        (narrow ? (
          <Icon name="chevronRight" size="xs" className="shrink-0 text-ink-3" />
        ) : null)}
    </button>
  );
}

/**
 * A titled nav group: a numbered silkscreen label ("01 You", the number in
 * ink-1, the name in ink-3) over its rows. Untitled groups render flat.
 */
export function WorkbenchNavBranch({
  title,
  index,
  children,
  className,
}: {
  title?: string;
  /** 1-based position among the titled groups, printed as "01". */
  index?: number;
  children: ReactNode;
  className?: string;
}) {
  const labelId = useId();
  if (!title) {
    return (
      <div role="group" className={cn("flex flex-col gap-0.5", className)}>
        {children}
      </div>
    );
  }
  return (
    <div className={className}>
      <h3
        id={labelId}
        className="silkscreen flex h-6 items-center gap-3 px-2 text-ink-3"
      >
        {index ? (
          <span aria-hidden="true" className="text-ink-1">
            {String(index).padStart(2, "0")}
          </span>
        ) : null}
        {title}
      </h3>
      <div
        role="group"
        aria-labelledby={labelId}
        className="mt-0.5 flex flex-col gap-0.5"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One row of a nav branch. `below` hangs under the row (Studio's search
 * hits). `current` and `tree` are kept for callers; the kit nav draws no
 * guides, the selected row's tint is its whole signal.
 */
export function WorkbenchNavLeaf({
  below,
  children,
}: {
  current?: boolean;
  /** Kept for existing callers. */
  tree?: boolean;
  below?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      {children}
      {below}
    </div>
  );
}

/** Grouped nav with roving arrow-key focus. */
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
  let titled = 0;
  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={(event) => rovingKeyDown(event)}
    >
      {visible.map((group, index) => (
        <WorkbenchNavBranch
          key={group.title ?? index}
          title={group.title}
          index={group.title ? ++titled : undefined}
        >
          {group.items.map((item) => {
            const current = !narrow && item.id === activeId;
            return (
              <WorkbenchNavLeaf
                key={item.id}
                tree={Boolean(group.title)}
                current={current}
              >
                <WorkbenchNavButton
                  item={item}
                  narrow={narrow}
                  current={current}
                  tabbable={narrow ? item.id === firstId : item.id === activeId}
                  onSelect={onSelect}
                />
              </WorkbenchNavLeaf>
            );
          })}
        </WorkbenchNavBranch>
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
  /** Glyph before the page title in the 48px header. */
  pageIcon?: IconName;
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
  /**
   * The shared save bar (UnsavedBar): hidden while clean, slides up when
   * dirty. While dirty, closing or Escape calls `nudge` instead of closing.
   */
  unsaved?: UnsavedBarProps & { nudge?: () => void };
  /** Escape handler that runs before `back` (clear a search). */
  onEscape?: () => boolean;
  /**
   * prose: content capped at 760 with 40px between sections.
   * full: the page lays itself out (split editors, Studio's preview rail).
   */
  width?: "prose" | "full";
  /**
   * default: 1120 wide. wide: 1280, for pages that carry a preview rail
   * beside a full column (Studio).
   */
  size?: "default" | "wide";
  /** Kept mounted but hidden (Studio's theme preview sheet). */
  hidden?: boolean;
  /** Opened over another dialog: overlay and surface move to z-60. */
  stacked?: boolean;
  bodyRef?: (node: HTMLDivElement | null) => void;
  mainRef?: (node: HTMLDivElement | null) => void;
  /** Pointer down in the scroller (Studio clears its landing highlight). */
  onBodyPointerDown?: () => void;
  /**
   * Where focus lands on open with a fine pointer. "nav" (default) focuses
   * the nav column itself, so no row draws a focus ring until you Tab;
   * "first" lets the dialog focus its first control (Studio's search).
   */
  initialFocus?: "nav" | "first";
  children: ReactNode;
};

/**
 * The one workbench shell (overlays §3b "Workbench"), shared by Studio,
 * server/channel settings, the profile editor and the catalog picker:
 * min(1120, 100vw-32) x min(820, 100dvh-32), 2px corners, ply-0 body with a
 * line edge and shadow-3 (the nav column sits on ply-1).
 * Presence: opacity + scale .98 -> 1 over 250ms, out 180ms; opacity only
 * when opened from the keyboard. Phones: a full-screen page.
 * Layout (flex-row / flex-col) is added by the caller.
 */
export const WORKBENCH_SURFACE =
  "fixed inset-0 m-0 flex h-full w-full min-h-0 items-stretch overflow-hidden bg-ply-0 p-0 text-ink-1 outline-none md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(820px,calc(100dvh-32px))] md:w-[min(1120px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border md:border-line md:shadow-modal animate-in fade-in duration-(--dur-4) data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-(--dur-4-exit) md:zoom-in-[0.98] md:data-[state=closed]:zoom-out-[0.98] data-keyboard:zoom-in-100 data-keyboard:md:zoom-in-100 data-keyboard:duration-100 data-stacked:z-60 [transition:transform_var(--dur-3)_var(--ease-out)] data-behind:[transform:translateY(-6px)_scale(0.985)] motion-reduce:data-behind:transform-none";

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
  pageIcon,
  pageKey,
  back,
  headerActions,
  footer,
  unsaved,
  onEscape,
  width = "prose",
  size = "default",
  hidden = false,
  stacked = false,
  bodyRef,
  mainRef,
  onBodyPointerDown,
  initialFocus = "nav",
  children,
}: SettingsWorkbenchProps) {
  const narrow = useIsMobile();
  const pageTitleId = useId();
  const unsavedDirty = Boolean(unsaved?.dirty);
  const unsavedNudge = unsaved?.nudge;
  /** Close, unless there are unsaved changes: then the bar nudges. */
  const requestClose = useCallback(() => {
    if (unsavedDirty) {
      unsavedNudge?.();
      return;
    }
    onClose();
  }, [onClose, unsavedDirty, unsavedNudge]);
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
          if (!stepBack()) requestClose();
        }}
      >
        <DialogPortal>
          {!hidden ? (
            <DialogOverlay className={stacked ? "z-60" : undefined} />
          ) : null}
          <DialogSurface
            showCloseButton={false}
            data-settings-workbench=""
            onOpenAutoFocus={(event) => {
              // Phones land on the list or the page heading; coarse tablets
              // land on the nav so the on-screen keyboard stays down; desktop
              // lands on the nav column unless the caller wants its first
              // control (a search field).
              const coarse =
                typeof window !== "undefined" &&
                window.matchMedia?.("(pointer: coarse)").matches;
              if (narrow || coarse || initialFocus === "nav") {
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
              size === "wide" && "md:w-[min(1280px,calc(100vw-32px))]",
              "flex-row",
              stacked ? "z-60" : "z-50",
              hidden && "invisible",
            )}
          >
            {/* Radix owns the title id and labels the dialog with it; an
                id override hides the title from its DialogTitle check. */}
            <DialogTitle className="sr-only">{title}</DialogTitle>
            <nav
              ref={navRef}
              tabIndex={-1}
              aria-label={`${title} navigation`}
              aria-hidden={!listVisible ? "true" : undefined}
              inert={!listVisible ? true : undefined}
              className={cn(
                "flex min-h-0 flex-col bg-ply-1 outline-none",
                narrow
                  ? "w-full pt-[var(--safe-area-top,0px)]"
                  : "w-[264px] shrink-0 border-r border-line",
                !listVisible && "hidden",
              )}
            >
              <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-1">
                <div aria-hidden="true" className="min-w-0">
                  <p className="truncate font-display text-[17px] leading-6 font-extrabold tracking-[-0.01em] text-ink-1 [font-optical-sizing:auto]">
                    {title}
                  </p>
                  {subtitle ? (
                    <p className="truncate text-ui-xs text-ink-3">{subtitle}</p>
                  ) : null}
                </div>
                {narrow ? (
                  <IconButton
                    aria-label={close}
                    icon="close"
                    variant="active"
                    size={40}
                    onClick={requestClose}
                  />
                ) : (
                  <Kbd
                    variant="outline"
                    aria-hidden="true"
                    className="shrink-0 pointer-coarse:hidden"
                  >
                    Esc
                  </Kbd>
                )}
              </div>
              {navTop ? (
                <div className="shrink-0 px-3 pt-4">{navTop}</div>
              ) : null}
              <div className="rm-settings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-6 pb-[max(16px,var(--safe-area-bottom,0px))]">
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
                "@container relative flex min-h-0 min-w-0 flex-1 flex-col bg-ply-0",
                narrow && "pt-[var(--safe-area-top,0px)]",
                !pageVisible && "hidden",
              )}
            >
              {/* The page header is 48 high: the panel's glyph and title in
                  Bricolage, and a 40px tint-2 close key at its end. */}
              <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3 md:px-4">
                {headerBack ? (
                  <IconButton
                    aria-label={headerBack.label}
                    icon="chevronLeft"
                    size={40}
                    onClick={headerBack.onBack}
                    className="-ml-1"
                  />
                ) : null}
                {pageIcon ? (
                  <Icon
                    name={pageIcon}
                    size="md"
                    aria-hidden="true"
                    className="shrink-0 text-ink-3"
                  />
                ) : null}
                <h2
                  id={pageTitleId}
                  ref={pageTitleRef}
                  tabIndex={-1}
                  className="min-w-0 flex-1 truncate font-display text-[18px] leading-6 font-extrabold tracking-[-0.02em] text-ink-1 outline-none [font-optical-sizing:auto]"
                >
                  {pageTitle}
                </h2>
                {headerActions}
                <IconButton
                  aria-label={close}
                  icon="close"
                  variant="active"
                  size={40}
                  onClick={requestClose}
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
                      "px-4 pt-6 md:px-8 md:pt-8",
                      footer || unsaved
                        ? "pb-8"
                        : "pb-[calc(64px+var(--safe-area-bottom,0px))]",
                      // Phones push in with a short slide; desktop pages
                      // crossfade (opacity only, 120ms).
                      narrow
                        ? "rm-settings-push-in"
                        : "animate-in fade-in-0 duration-120 ease-out",
                    )}
                  >
                    {width === "prose" ? (
                      <div className="flex w-full max-w-[760px] min-w-0 flex-col gap-10">
                        {children}
                      </div>
                    ) : (
                      children
                    )}
                  </div>
                ) : null}
              </div>
              {unsaved && pageVisible ? (
                <UnsavedBar
                  {...unsaved}
                  className={cn(
                    "pb-[max(12px,var(--safe-area-bottom,0px))]",
                    unsaved.className,
                  )}
                />
              ) : null}
              {footer && pageVisible ? (
                <div className="shrink-0 border-t-2 border-ink-1 bg-ply-0 px-4 pt-3 pb-[max(12px,var(--safe-area-bottom,0px))] md:px-8">
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
