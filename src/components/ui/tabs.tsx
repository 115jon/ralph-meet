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
  className?: string;
}) {
  const generated = React.useId();
  const base = idBase ?? generated;
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  const [box, setBox] = React.useState({ x: 0, w: 0 });

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
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn("relative flex items-stretch gap-4", className)}
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
              "relative inline-flex items-center gap-1.5 whitespace-nowrap text-ui-sm font-medium outline-none [-webkit-tap-highlight-color:transparent]",
              HIT,
              selected
                ? "text-rm-text"
                : "text-rm-text-muted pointer-fine:hover:text-rm-text",
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

/** The id `Tabs` gives a tab, for the panel's `aria-labelledby`. */
export function tabId(idBase: string, value: string) {
  return `${idBase}-tab-${value}`;
}
