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
 * Quiet Pro underline tabs. The indicator is drawn in the text colour, not
 * the accent, and slides with transform only (measured, so labels can be any
 * width). APG tabs keyboard model: one tab stop, arrows/Home/End move and
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
  className,
}: {
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

  React.useLayoutEffect(() => {
    const el = refs.current[index];
    if (!el) return;
    const measure = () => setBox({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, items.length]);

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

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      data-scrollable={scrollable || undefined}
      className={cn(
        "relative flex items-stretch gap-4",
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
              "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ui-sm outline-none [-webkit-tap-highlight-color:transparent] pointer-coarse:min-h-11",
              HIT,
              selected
                ? "font-semibold text-rm-text"
                : "font-medium text-rm-text-secondary pointer-fine:hover:text-rm-text",
            )}
          >
            {item.label}
            {item.adornment}
          </button>
        );
      })}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-[100px] origin-left rounded-full bg-rm-text transition-transform duration-200 ease-(--rm-ease-out) motion-reduce:transition-none"
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
