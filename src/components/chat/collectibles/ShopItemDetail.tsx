/**
 * Item detail for the shop: a live preview on the user's own avatar, card or
 * name, colour variants, and Equip / Remove. A dialog on desktop and a bottom
 * drawer on phones (ResponsiveDialog). Everything is free; the source price is
 * shown struck through for context only.
 */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { AvatarDisplay } from "@/lib/avatar-display";
import {
  baseItemName,
  collectionStatus,
  formatSourcePrice,
  KIND_COPY,
  variantName,
  type VariantFamily,
} from "@/lib/collectible-catalog-view";
import {
  displayWithCollectible,
  selectedSkuForKind,
} from "@/lib/collectible-selection";
import type {
  CollectibleCatalogCategory,
  CollectibleCatalogItem,
} from "@/lib/collectibles-catalog";
import { cn } from "@/lib/utils";
import { HIT, PRESS } from "@/components/ui/interaction";
import { Num } from "@/components/ui/num";
import { useMemo, useState } from "react";

import { CollectibleStage, type PreviewIdentity } from "./CollectiblePreviews";

export function ShopItemDetail({
  family,
  category,
  identity,
  currentDisplay,
  busy,
  error,
  onOpenChange,
  onEquip,
  onRemove,
}: {
  family: VariantFamily;
  category?: CollectibleCatalogCategory;
  identity: PreviewIdentity;
  currentDisplay?: AvatarDisplay | string | null;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onEquip: (item: CollectibleCatalogItem) => void;
  onRemove: (item: CollectibleCatalogItem) => void;
}) {
  const equippedSku = selectedSkuForKind(currentDisplay, family.base.kind);
  const [variantId, setVariantId] = useState(
    () =>
      family.variants.find((variant) => variant.skuId === equippedSku)?.id ??
      family.base.id,
  );
  const item =
    family.variants.find((variant) => variant.id === variantId) ?? family.base;
  const equipped = equippedSku === item.skuId;
  const display = useMemo(
    () => displayWithCollectible(currentDisplay, item.kind, item),
    [currentDisplay, item],
  );
  const price = formatSourcePrice(item);
  const status = category ? collectionStatus(category) : null;
  const copy = KIND_COPY[item.kind];

  return (
    <ResponsiveDialog open onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        size="xl"
        initialFocus="surface"
        dialogClassName="gap-0 overflow-hidden p-0 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)]"
        drawerClassName="px-0 pb-[calc(var(--safe-area-bottom,0px)+1rem)]"
      >
        {/* The art plays here, inside the open detail, and nowhere at rest. */}
        <div
          className="relative flex min-h-56 items-center justify-center overflow-hidden border-line bg-ply-2 px-4 py-6 md:min-h-[480px] md:border-e md:py-10"
          style={
            category?.background
              ? { background: category.background }
              : undefined
          }
        >
          <CollectibleStage
            kind={item.kind}
            identity={identity}
            item={item}
            display={display}
            decorationClassName="w-36 p-4 md:w-56 md:p-6"
            cardClassName="h-64 md:h-[400px]"
          />
        </div>

        <div className="flex flex-col gap-5 px-4 pt-4 md:p-5">
          <div className="flex flex-col gap-1">
            <ResponsiveDialogTitle className="pe-8">
              {baseItemName(item)}
            </ResponsiveDialogTitle>
            <p className="text-ui-xs text-ink-3">
              {copy.one}
              {category ? ` · ${category.name}` : ""}
            </p>
            <ResponsiveDialogDescription className="mt-1">
              {item.label ?? item.summary ?? ""}
            </ResponsiveDialogDescription>
            {status ? (
              <p className="mt-1 inline-flex items-center gap-1 text-ui-xs font-medium text-warning-ink">
                <Icon
                  name={status.tone === "leaving" ? "clock" : "lock"}
                  size="xs"
                />
                {status.label}
              </p>
            ) : null}
          </div>

          {family.variants.length > 1 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-ui-sm font-medium text-ink-1">
                Colour
                <span className="font-normal text-ink-3">
                  {" "}
                  · {variantName(item) ?? "Base"}
                </span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {family.variants.map((variant) => {
                  const selected = variant.id === item.id;
                  const label = variantName(variant) ?? variant.name;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      aria-pressed={selected}
                      aria-label={label}
                      title={label}
                      onClick={() => setVariantId(variant.id)}
                      className={cn(
                        "size-8 rounded-full p-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                        PRESS,
                        HIT,
                        selected
                          ? "ring-2 ring-accent-ink"
                          : "ring-1 ring-line pointer-fine:hover:ring-line-strong",
                      )}
                    >
                      {/* The swatch is the collectible's own colour. */}
                      <span
                        className="block size-full rounded-full ring-1 ring-line-strong ring-inset"
                        style={{
                          background:
                            variant.variantColor ?? "var(--color-tint-3)",
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <div className="mt-auto flex flex-col gap-3">
            <p className="flex items-baseline gap-2">
              <span className="text-ui-md font-semibold text-ink-1">Free</span>
              {price ? (
                <s className="text-ink-3">
                  <span className="sr-only">Source price </span>
                  <Num size="sm">{price}</Num>
                </s>
              ) : null}
            </p>
            {error ? (
              <p role="alert" className="text-ui-xs text-danger-ink">
                {error}
              </p>
            ) : null}
            {equipped ? (
              <div className="flex items-center gap-2">
                <p className="me-auto inline-flex items-center gap-1.5 text-ui-sm font-medium text-accent-ink">
                  <Icon name="check" size="sm" />
                  Equipped
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onRemove(item)}
                  loading={busy}
                  className="max-md:h-11"
                >
                  Remove
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                onClick={() => onEquip(item)}
                loading={busy}
                className="w-full max-md:h-11"
              >
                Equip {copy.one.toLowerCase()}
              </Button>
            )}
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
