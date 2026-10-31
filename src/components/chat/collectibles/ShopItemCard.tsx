import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
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

function ItemStage({
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
        <EffectThumb item={item} />
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
function VariantDots({ family }: { family: VariantFamily }) {
  if (family.variants.length < 2) return null;
  const shown = family.variants.slice(0, 4);
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {shown.map((variant) => (
        // Swatches are the collectible's own colours (catalog data).
        <span
          key={variant.id}
          className="size-2.5 rounded-full ring-1 ring-line-strong ring-inset"
          style={{
            background: variant.variantColor ?? "var(--color-tint-3)",
          }}
        />
      ))}
      <Num className="text-ink-3">{family.variants.length}</Num>
    </span>
  );
}

/**
 * One shop cell: the whole tile is the button (radius 10, ply-2, line). The
 * art plays only while the tile is hovered or focused and on screen; at rest
 * it is a still. Equipped reads as the accent ring plus a check disc, not a
 * pill stacked on the art.
 */
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
      data-equipped={equipped ? "" : undefined}
      className={cn(
        "group/card relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-ply-2 text-start outline-none [-webkit-tap-highlight-color:transparent]",
        // Hover is an ink overlay over art and caption alike (opacity only).
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-tint-1 after:opacity-0 after:transition-opacity after:duration-(--dur-1) after:ease-out pointer-fine:hover:after:opacity-100",
        "transition-[scale] duration-(--dur-1) ease-out active:scale-(--motion-press)",
        // The ring sits on the tile's own edge (not outside it), so rails
        // that scroll sideways never clip it.
        equipped && "outline-2 -outline-offset-2 outline-accent-ink",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className,
      )}
    >
      <span
        className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-tint-1"
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
          <span
            aria-hidden="true"
            className="absolute end-2 top-2 flex size-5 items-center justify-center rounded-full bg-accent-ink text-ply-0"
          >
            <Icon name="check" size="xs" />
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-3 pt-2 pb-2.5">
        <span className="truncate text-ui-row font-medium text-ink-1">
          {name}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-ui-xs text-ink-3">
          {equipped ? (
            <span className="shrink-0 font-medium text-accent-ink">
              Equipped
            </span>
          ) : showKind ? (
            <span className="truncate">{KIND_COPY[item.kind].one}</span>
          ) : (
            <span className="shrink-0 font-medium text-ink-2">Free</span>
          )}
          {price ? (
            <s className="truncate">
              <span className="sr-only">Source price </span>
              <Num>{price}</Num>
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
