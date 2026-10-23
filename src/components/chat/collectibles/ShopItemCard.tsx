import { Icon } from "@/components/ui/icon";
import {
  baseItemName,
  formatSourcePrice,
  KIND_COPY,
  type VariantFamily,
} from "@/lib/collectible-catalog-view";
import type { CollectibleCatalogCategory } from "@/lib/collectibles-catalog";
import { cn } from "@/lib/utils";
import { memo, useState } from "react";

import {
  DecorationAvatar,
  EffectThumb,
  FrameThumb,
  NameplateRow,
  type PreviewIdentity,
} from "./CollectiblePreviews";
import { useInView } from "./hooks";

export function ItemStage({
  family,
  identity,
  animate,
}: {
  family: VariantFamily;
  identity: PreviewIdentity;
  animate: boolean;
}) {
  const item = family.base;
  if (item.kind === "avatar_decoration") {
    return (
      <span className="w-[44%] max-w-36">
        <DecorationAvatar item={item} identity={identity} animate={animate} />
      </span>
    );
  }
  if (item.kind === "profile_effect") {
    return (
      <span className="aspect-[450/880] h-[86%]">
        <EffectThumb item={item} className="shadow-(--rm-shadow-2)" />
      </span>
    );
  }
  if (item.kind === "profile_frame") {
    return (
      <span className="aspect-[450/880] h-[70%]">
        <FrameThumb item={item} identity={identity} />
      </span>
    );
  }
  return (
    <span className="w-[88%]">
      <NameplateRow item={item} identity={identity} animate={animate} />
    </span>
  );
}

/** Up to four colour dots for a design's variants, plus a count. */
export function VariantDots({ family }: { family: VariantFamily }) {
  if (family.variants.length < 2) return null;
  const shown = family.variants.slice(0, 4);
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {shown.map((variant) => (
        <span
          key={variant.id}
          className="size-2.5 rounded-full ring-1 ring-black/15 ring-inset"
          style={{
            background: variant.variantColor ?? "var(--color-rm-tint-3)",
          }}
        />
      ))}
      <span className="text-ui-2xs text-rm-text-muted tabular-nums">
        {family.variants.length}
      </span>
    </span>
  );
}

export const ShopItemCard = memo(function ShopItemCard({
  family,
  category,
  identity,
  equipped,
  showKind,
  onOpen,
  className,
}: {
  family: VariantFamily;
  category?: CollectibleCatalogCategory;
  identity: PreviewIdentity;
  equipped: boolean;
  /** Label the kind, for rails and results that mix kinds. */
  showKind?: boolean;
  onOpen: (family: VariantFamily) => void;
  className?: string;
}) {
  const item = family.base;
  const name = baseItemName(item);
  const price = formatSourcePrice(item);
  const [ref, inView] = useInView<HTMLButtonElement>();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const variantsLabel =
    family.variants.length > 1 ? `, ${family.variants.length} colours` : "";

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(family)}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      aria-label={`${name}, ${KIND_COPY[item.kind].one}${variantsLabel}${equipped ? ", equipped" : ""}`}
      className={cn(
        "group/card flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface text-start outline-none [-webkit-tap-highlight-color:transparent]",
        "transition-[transform,border-color] duration-150 ease-(--rm-ease-out) active:scale-[0.98] motion-reduce:active:scale-100 pointer-fine:hover:border-rm-border-strong",
        "focus-visible:ring-2 focus-visible:ring-rm-focus focus-visible:ring-offset-2 focus-visible:ring-offset-rm-bg-primary",
        equipped && "border-rm-accent",
        className,
      )}
    >
      <span
        className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-rm-bg-elevated"
        style={
          category?.background ? { background: category.background } : undefined
        }
      >
        <ItemStage
          family={family}
          identity={identity}
          animate={(hovered || focused) && inView}
        />
        {equipped ? (
          <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-rm-accent-solid px-2 py-0.5 text-ui-2xs font-semibold text-rm-on-accent">
            <Icon name="check" size="xs" />
            Equipped
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col gap-1 p-3">
        <span className="truncate text-ui-sm font-semibold text-rm-text">
          {name}
        </span>
        {showKind ? (
          <span className="truncate text-ui-xs text-rm-text-muted">
            {KIND_COPY[item.kind].one}
          </span>
        ) : null}
        <span className="mt-1 flex items-center gap-2">
          <span className="text-ui-sm font-semibold text-rm-accent-ink">
            Free
          </span>
          {price ? (
            <s className="truncate text-ui-xs text-rm-text-ghost">
              <span className="sr-only">Source price </span>
              {price}
            </s>
          ) : null}
          <span className="ms-auto">
            <VariantDots family={family} />
          </span>
        </span>
      </span>
    </button>
  );
});
