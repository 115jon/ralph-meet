import * as React from "react";

import { HIT } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";

export type TabItem<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** Trailing content, such as a count badge. */
  adornment?: React.ReactNode;
};

/**
 * Tabs (DESIGN.md, Tabs).
 *
 *   rule   C1, in a page: Bricolage 600 labels on a 1px line; the 2px ink-1
 *          indicator slides between tabs with transform only (200ms
 *          --ease-in-out), measured so labels can be any width.
 *   index  C2, top-level switches (the Studio groups You / Calls / App):
 *          equal cells on a 2px rule, each a silkscreen number over a bold
 *          label; the chosen cell's rule and label are ink-1, its number
 *          accent.
 *
 *  APG tabs keyboard model: one tab stop, arrows/Home/End move and
 * select. Pass `panelId` to wire `aria-controls` to the panel the caller
 * renders with `role="tabpanel"` and `aria-labelledby={tabId(value)}`.
 */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onValueChange,
  idBase,
  panelId,
  scrollable = false,
  variant = "rule",
  className,
}: {
  /** `rule` (C1, default) or `index` (C2 numbered cells). */
  variant?: "rule" | "index";
  /** Accessible name for the tab list. */
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Stable prefix for tab ids; defaults to a generated id. */
  idBase?: string;
  panelId?: string;
  /**
   * Narrow containers (phone pages): the list scrolls sideways, swipeable on
   * touch, and fades the edge that has more tabs past it so a clipped last
   * tab reads as "more", not as a cut-off label.
   */
  scrollable?: boolean;
  className?: string;
}) {
  const generated = React.useId();
  const base = idBase ?? generated;
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  const [box, setBox] = React.useState({ x: 0, w: 0 });
  const [fade, setFade] = React.useState({ start: false, end: false });

  // The indicator follows the selected tab's box. A sibling growing or
  // shrinking (a label or count badge changing) moves the selected tab
  // without resizing it, so the list and every tab are observed, not just
  // the selected one.
  const itemsKey = items.map((item) => item.value).join("\u0000");
  React.useLayoutEffect(() => {
    if (variant !== "rule") return;
    const measure = () => {
      const el = refs.current[index];
      if (!el) return;
      const next = { x: el.offsetLeft, w: el.offsetWidth };
      setBox((prev) => (prev.x === next.x && prev.w === next.w ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    if (listRef.current) ro.observe(listRef.current);
    for (const tab of refs.current.slice(0, items.length))
      if (tab) ro.observe(tab);
    return () => ro.disconnect();
  }, [index, itemsKey, items.length, variant]);

  const updateFade = React.useCallback(() => {
    const list = listRef.current;
    if (!list || !scrollable) return;
    const max = list.scrollWidth - list.clientWidth;
    // RTL scrollLeft runs 0 -> -max; compare magnitudes.
    const pos = Math.abs(list.scrollLeft);
    setFade((prev) => {
      const next = { start: pos > 1, end: max - pos > 1 };
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
  }, [scrollable]);

  React.useLayoutEffect(() => {
    if (!scrollable) return;
    updateFade();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(updateFade);
    ro.observe(list);
    return () => ro.disconnect();
  }, [scrollable, updateFade, items.length]);

  // Keep the selected tab in view when it changes (keyboard or a tap on a
  // half-visible tab). Instant: tab switches are frequent (9.6).
  React.useEffect(() => {
    if (!scrollable) return;
    const list = listRef.current;
    const el = refs.current[index];
    if (!list || !el) return;
    const start = el.offsetLeft;
    const end = start + el.offsetWidth;
    if (start < list.scrollLeft) list.scrollLeft = start;
    else if (end > list.scrollLeft + list.clientWidth)
      list.scrollLeft = end - list.clientWidth;
  }, [index, scrollable]);

  const mask = scrollable ? fadeMask(fade) : undefined;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const count = items.length;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    onValueChange(items[next].value);
    refs.current[next]?.focus();
  };

  if (variant === "index") {
    return (
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        data-variant="index"
        className={cn("grid", className)}
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
        onKeyDown={onKeyDown}
      >
        {items.map((item, i) => {
          const selected = i === index;
          return (
            <button
              key={item.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={tabId(base, item.value)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onValueChange(item.value)}
              className={cn(
                "flex h-14 min-w-0 flex-col items-start justify-end gap-1 border-t-2 px-3 pb-2 text-left outline-none [-webkit-tap-highlight-color:transparent] transition-colors duration-(--dur-1) ease-out focus-visible:outline-offset-[-2px]!",
                selected
                  ? "border-ink-1 text-ink-1"
                  : "border-line-strong text-ink-3 pointer-fine:hover:border-ink-2 pointer-fine:hover:text-ink-2",
              )}
            >
              <span className={cn("silkscreen", selected && "text-accent-ink")}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex max-w-full items-center gap-1.5 truncate font-display text-[17px] leading-5 font-bold">
                {item.label}
                {item.adornment}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      data-scrollable={scrollable || undefined}
      className={cn(
        "relative flex items-stretch gap-6 border-b border-line",
        scrollable &&
          "min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none",
        className,
      )}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      onScroll={scrollable ? updateFade : undefined}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) => {
        const selected = i === index;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={tabId(base, item.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "relative inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap font-display text-[15px] font-semibold outline-none [-webkit-tap-highlight-color:transparent] pointer-coarse:min-h-11 focus-visible:outline-offset-[-2px]!",
              HIT,
              selected
                ? "text-ink-1"
                : "text-ink-3 transition-colors duration-(--dur-1) ease-out pointer-fine:hover:text-ink-1",
            )}
          >
            {item.label}
            {item.adornment}
          </button>
        );
      })}
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-px left-0 h-0.5 w-[100px] origin-left bg-ink-1 transition-transform duration-(--dur-3) ease-in-out motion-reduce:transition-none"
        style={{ transform: `translateX(${box.x}px) scaleX(${box.w / 100})` }}
      />
    </div>
  );
}

/** 24px fades on whichever inline edge has more tabs past it. */
function fadeMask({ start, end }: { start: boolean; end: boolean }) {
  if (!start && !end) return undefined;
  const from = start ? "transparent 0, black 24px" : "black 0";
  const to = end ? "black calc(100% - 24px), transparent 100%" : "black 100%";
  return `linear-gradient(to right, ${from}, ${to})`;
}

/** The id `Tabs` gives a tab, for the panel's `aria-labelledby`. */
export function tabId(idBase: string, value: string) {
  return `${idBase}-tab-${value}`;
}
