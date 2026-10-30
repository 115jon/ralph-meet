/**
 * A single-select listbox of collectibles grouped by collection.
 *
 * Keyboard (APG listbox, laid out as a grid): one tab stop (roving tabindex),
 * arrows move by geometry so Up/Down land on the option visually above or
 * below, Home/End jump to the ends, Enter/Space choose. Each option tracks its
 * own hover/focus/in-view state so only the option under the pointer or focus
 * (and the chosen one, while on screen) plays its animated art.
 */

import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
import {
  collectionStripArt,
  resizedShopImageUrl,
} from "@/lib/collectible-assets";
import {
  collectionStatus,
  type CollectionSection,
} from "@/lib/collectible-catalog-view";
import type { CollectibleCatalogItem } from "@/lib/collectibles-catalog";
import { cn } from "@/lib/utils";
import {
  memo,
  useCallback,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { useInView } from "./hooks";

export const NONE_OPTION_ID = "__none";

export type OptionVisualState = {
  selected: boolean;
  equipped: boolean;
  /** Hovered or focused and on screen: play animated art. */
  active: boolean;
  /** Chosen and on screen. */
  visible: boolean;
};

type RenderOption = (
  item: CollectibleCatalogItem | null,
  state: OptionVisualState,
) => ReactNode;

function optionLabel(item: CollectibleCatalogItem | null, noneLabel: string) {
  if (!item) return noneLabel;
  return item.variantLabel && !item.name.includes(item.variantLabel)
    ? `${item.name}, ${item.variantLabel}`
    : item.name;
}

const Option = memo(function Option({
  id,
  item,
  label,
  selected,
  equipped,
  tabbable,
  className,
  onChoose,
  onFocusOption,
  render,
}: {
  id: string;
  item: CollectibleCatalogItem | null;
  label: string;
  selected: boolean;
  equipped: boolean;
  tabbable: boolean;
  className?: string;
  onChoose: (item: CollectibleCatalogItem | null) => void;
  onFocusOption: (id: string) => void;
  render: RenderOption;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <div
      ref={ref}
      role="option"
      id={id}
      data-option-id={id}
      aria-selected={selected}
      aria-label={equipped ? `${label}, equipped` : label}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => {
        onFocusOption(id);
        onChoose(item);
      }}
      onFocus={() => {
        setFocused(true);
        onFocusOption(id);
      }}
      onBlur={() => setFocused(false)}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      className={cn(
        "group/option relative cursor-pointer rounded-lg outline-none [-webkit-tap-highlight-color:transparent]",
        "transition-[scale] duration-(--dur-1) ease-out active:scale-(--motion-press)",
        // Cells touch, so the focused one lifts above its neighbours.
        "focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className,
      )}
    >
      {render(item, {
        selected,
        equipped,
        active: (hovered || focused) && inView,
        visible: inView,
      })}
    </div>
  );
});

function SectionHeader({
  section,
  headingId,
  count,
}: {
  section: CollectionSection;
  headingId: string;
  count: number;
}) {
  // The collection's card block (the same art as the shop's collection
  // cards); the wide strip only when there is no block.
  const block = section.category.featuredBlockUrl
    ? resizedShopImageUrl(section.category.featuredBlockUrl, 160, 72)
    : null;
  const art = block
    ? { src: block }
    : collectionStripArt(section.category, 240);
  const status = collectionStatus(section.category);
  // Layout keeps the title off the art: the collection banner is a thumbnail
  // at the start of the row, the name sits beside it in panel ink.
  return (
    <div className="mb-2 flex min-h-10 items-center gap-3 px-1">
      {art ? (
        <img
          src={art.src}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="aspect-[1037/463] h-9 shrink-0 rounded-sm border border-line bg-ply-2 object-cover"
        />
      ) : null}
      <h3
        id={headingId}
        className="min-w-0 truncate text-ui-row font-semibold text-ink-1"
      >
        {section.category.name}
      </h3>
      <Num className="shrink-0 text-ink-3">{count}</Num>
      {status ? (
        <span
          className={cn(
            "ms-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-ui-xs font-medium",
            status.tone === "leaving"
              ? "bg-warning-tint text-warning-ink"
              : "bg-tint-1 text-ink-2",
          )}
        >
          <Icon name={status.tone === "leaving" ? "clock" : "lock"} size="xs" />
          {status.label}
        </span>
      ) : null}
    </div>
  );
}

export function CollectibleListbox({
  label,
  sections,
  noneLabel,
  selectedId,
  equippedId,
  onChoose,
  renderOption,
  gridClassName,
  optionClassName,
  noneClassName,
  sectionIdPrefix,
  emptyState,
}: {
  label: string;
  sections: CollectionSection[];
  /** Shows a leading "none" option with this label. */
  noneLabel?: string;
  /** Draft choice: an item id, NONE_OPTION_ID, or null for no choice yet. */
  selectedId: string | null;
  equippedId: string | null;
  onChoose: (item: CollectibleCatalogItem | null) => void;
  renderOption: RenderOption;
  gridClassName: string;
  optionClassName?: string;
  noneClassName?: string;
  /** Section elements get `${prefix}${categoryId}` ids for jump links. */
  sectionIdPrefix: string;
  emptyState?: ReactNode;
}) {
  const baseId = useId();
  const firstId = noneLabel
    ? NONE_OPTION_ID
    : (sections[0]?.items[0]?.id ?? null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabbableId = focusId ?? selectedId ?? firstId;

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const root = event.currentTarget;
    const options = [...root.querySelectorAll<HTMLElement>('[role="option"]')];
    if (!options.length) return;
    const current = document.activeElement as HTMLElement | null;
    const index = current ? options.indexOf(current) : -1;
    let next: HTMLElement | undefined;

    switch (event.key) {
      case "ArrowRight":
        next = options[Math.min(options.length - 1, index + 1)];
        break;
      case "ArrowLeft":
        next = options[Math.max(0, index - 1)];
        break;
      case "Home":
        next = options[0];
        break;
      case "End":
        next = options[options.length - 1];
        break;
      case "ArrowDown":
      case "ArrowUp": {
        if (index < 0) {
          next = options[0];
          break;
        }
        const from = options[index]!.getBoundingClientRect();
        const centerX = from.left + from.width / 2;
        const down = event.key === "ArrowDown";
        let bestRowTop: number | null = null;
        let bestDistance = Infinity;
        for (const option of options) {
          const rect = option.getBoundingClientRect();
          const inDirection = down
            ? rect.top > from.top + from.height / 2
            : rect.bottom < from.bottom - from.height / 2;
          if (!inDirection) continue;
          const rowTop = rect.top;
          const isCloserRow =
            bestRowTop === null ||
            (down ? rowTop < bestRowTop - 2 : rowTop > bestRowTop + 2);
          const isSameRow =
            bestRowTop !== null && Math.abs(rowTop - bestRowTop) <= 2;
          const distance = Math.abs(rect.left + rect.width / 2 - centerX);
          if (isCloserRow) {
            bestRowTop = rowTop;
            bestDistance = distance;
            next = option;
          } else if (isSameRow && distance < bestDistance) {
            bestDistance = distance;
            next = option;
          }
        }
        break;
      }
      case "Enter":
      case " ":
        if (index >= 0) {
          event.preventDefault();
          options[index]!.click();
        }
        return;
      default:
        return;
    }

    if (next && next !== current) {
      event.preventDefault();
      next.focus();
      next.scrollIntoView({ block: "nearest" });
    }
  }, []);

  const hasItems = sections.some((section) => section.items.length > 0);

  return (
    <div
      role="listbox"
      aria-label={label}
      aria-orientation="vertical"
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-6 outline-none"
    >
      {noneLabel ? (
        <div role="group" aria-label={noneLabel} className={gridClassName}>
          <Option
            id={NONE_OPTION_ID}
            item={null}
            label={noneLabel}
            selected={selectedId === NONE_OPTION_ID}
            equipped={equippedId === null}
            tabbable={tabbableId === NONE_OPTION_ID}
            className={cn(optionClassName, noneClassName)}
            onChoose={onChoose}
            onFocusOption={setFocusId}
            render={renderOption}
          />
        </div>
      ) : null}
      {hasItems
        ? sections.map((section) => {
            const headingId = `${baseId}-${section.category.id}`;
            return (
              <section
                key={section.category.id}
                id={`${sectionIdPrefix}${section.category.id}`}
                role="group"
                aria-labelledby={headingId}
                className="scroll-mt-4 [contain-intrinsic-size:auto_480px] [content-visibility:auto]"
              >
                <SectionHeader
                  section={section}
                  headingId={headingId}
                  count={section.items.length}
                />
                <div className={gridClassName}>
                  {section.items.map((item) => (
                    <Option
                      key={item.id}
                      id={item.id}
                      item={item}
                      label={optionLabel(item, "")}
                      selected={selectedId === item.id}
                      equipped={equippedId === item.id}
                      tabbable={tabbableId === item.id}
                      className={optionClassName}
                      onChoose={onChoose}
                      onFocusOption={setFocusId}
                      render={renderOption}
                    />
                  ))}
                </div>
              </section>
            );
          })
        : emptyState}
    </div>
  );
}
