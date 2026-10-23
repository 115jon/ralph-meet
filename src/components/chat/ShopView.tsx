/**
 * Collectibles shop. Every item is free to equip; the source shop's price is
 * shown struck through for context. Featured opens on the newest collection,
 * then a rail of collections and a row per collection; each type tab is a
 * grid grouped by collection; a collection opens its own page. Item detail
 * previews the item on the user's own avatar, card or name before equipping.
 */

import { ShopItemCard } from "@/components/chat/collectibles/ShopItemCard";
import { ShopItemDetail } from "@/components/chat/collectibles/ShopItemDetail";
import type { PreviewIdentity } from "@/components/chat/collectibles/CollectiblePreviews";
import { useCollectiblesCatalog } from "@/components/chat/collectibles/hooks";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Tabs, tabId } from "@/components/ui/tabs";
import { applyCollectible } from "@/lib/collectible-apply-client";
import {
  collectionHeroArt,
  collectionStripArt,
  resizedShopImageUrl,
} from "@/lib/collectible-assets";
import {
  buildCollectionSections,
  collectionStatus,
  COLLECTIBLE_KINDS,
  countSectionItems,
  groupVariantFamilies,
  KIND_COPY,
  type CollectionSection,
  type VariantFamily,
} from "@/lib/collectible-catalog-view";
import { selectedSkuForKind } from "@/lib/collectible-selection";
import type {
  CollectibleCatalogCategory,
  CollectibleCatalogItem,
  CollectibleKind,
  CollectiblesCatalog,
} from "@/lib/collectibles-catalog";
import { getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

type ShopViewProps = {
  onMenuClick: () => void;
};

type ShopTab = "featured" | CollectibleKind;

const FEATURED_ROWS = 6;
const RAIL_ITEMS = 12;
const GRID_CLASS =
  "grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))] lg:gap-4";

function relativeAge(iso: string | undefined) {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return format.format(-hours, "hour");
  return format.format(-Math.round(hours / 24), "day");
}

function freshnessLabel(catalog: CollectiblesCatalog) {
  const age = relativeAge(catalog.syncedAt);
  if (catalog.stale) {
    return age
      ? `Catalog may be out of date · synced ${age}`
      : "Catalog may be out of date";
  }
  return age ? `Synced ${age}` : null;
}

function StatusChip({ category }: { category: CollectibleCatalogCategory }) {
  const status = collectionStatus(category);
  if (!status) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-ui-2xs font-semibold",
        status.tone === "leaving"
          ? "bg-rm-warning-ink/90 text-black"
          : "bg-black/55 text-white/85",
      )}
    >
      <Icon name={status.tone === "leaving" ? "clock" : "lock"} size="xs" />
      {status.label}
    </span>
  );
}

function CollectionHero({
  category,
  itemCount,
  onBrowse,
  headingLevel = "h2",
}: {
  category: CollectibleCatalogCategory;
  itemCount: number;
  onBrowse?: () => void;
  headingLevel?: "h1" | "h2";
}) {
  const art = collectionHeroArt(category, 1600);
  const logo =
    resizedShopImageUrl(category.logoUrl, 542, 136) ?? category.logoUrl;
  const Heading = headingLevel;
  return (
    <section
      aria-label={category.name}
      className="relative isolate overflow-hidden rounded-2xl bg-rm-bg-elevated"
      style={
        category.background ? { background: category.background } : undefined
      }
    >
      {art ? (
        <img
          src={art.src}
          alt=""
          aria-hidden="true"
          decoding="async"
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
      ) : null}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgba(0,0,0,0.78),rgba(0,0,0,0.2)_55%,transparent)] md:bg-[linear-gradient(90deg,rgba(0,0,0,0.78),rgba(0,0,0,0.25)_55%,transparent)]"
      />
      <div className="flex min-h-64 flex-col justify-end gap-3 p-5 md:min-h-[300px] md:max-w-[52%] md:justify-center md:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip category={category} />
          <span className="text-ui-xs font-medium text-white/75">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </span>
        </div>
        {logo ? (
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="h-12 w-auto max-w-[70%] self-start object-contain object-left md:h-16"
          />
        ) : null}
        <Heading
          className={cn(
            "text-ui-2xl font-semibold text-balance text-white",
            logo && "sr-only",
          )}
        >
          {category.name}
        </Heading>
        {category.marketingTitle || category.summary ? (
          <p className="max-w-prose text-ui-sm text-pretty text-white/85">
            {category.marketingTitle ?? category.summary}
          </p>
        ) : null}
        {onBrowse ? (
          <Button
            type="button"
            onClick={onBrowse}
            className="mt-1 h-11 self-start px-5 md:h-9"
          >
            Browse collection
            <Icon name="arrowRight" size="sm" />
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function CollectionCard({
  category,
  onOpen,
}: {
  category: CollectibleCatalogCategory;
  onOpen: () => void;
}) {
  const block = category.featuredBlockUrl
    ? resizedShopImageUrl(category.featuredBlockUrl, 520, 232)
    : null;
  const strip = block ? null : collectionStripArt(category, 520);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/collection flex w-[220px] shrink-0 snap-start flex-col gap-2 text-start outline-none [-webkit-tap-highlight-color:transparent] md:w-[260px]"
    >
      <span
        className="relative block aspect-[1037/463] w-full overflow-hidden rounded-xl bg-rm-bg-elevated ring-rm-focus ring-offset-2 ring-offset-rm-bg-primary transition-transform duration-150 ease-(--rm-ease-out) group-active/collection:scale-[0.98] group-focus-visible/collection:ring-2 motion-reduce:group-active/collection:scale-100"
        style={
          category.background ? { background: category.background } : undefined
        }
      >
        {block || strip ? (
          <img
            src={block ?? strip!.src}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        <span className="absolute start-2 top-2">
          <StatusChip category={category} />
        </span>
      </span>
      <span className="truncate px-0.5 text-ui-sm font-medium text-rm-text pointer-fine:group-hover/collection:underline">
        {category.name}
      </span>
    </button>
  );
}

function SectionHeading({
  title,
  count,
  action,
  id,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h2
        id={id}
        className="min-w-0 truncate text-ui-md font-semibold text-rm-text"
      >
        {title}
      </h2>
      {count != null ? (
        <span className="text-ui-xs text-rm-text-muted tabular-nums">
          {count}
        </span>
      ) : null}
      {action ? <span className="ms-auto shrink-0">{action}</span> : null}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className={GRID_CLASS} aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <span
          key={index}
          className="flex flex-col overflow-hidden rounded-xl border border-rm-border"
        >
          <span className="aspect-[4/3] animate-pulse bg-rm-tint-1" />
          <span className="flex flex-col gap-2 p-3">
            <span className="h-3 w-2/3 animate-pulse rounded-full bg-rm-tint-2" />
            <span className="h-2.5 w-1/3 animate-pulse rounded-full bg-rm-tint-1" />
          </span>
        </span>
      ))}
    </div>
  );
}

export default function ShopView({ onMenuClick }: ShopViewProps) {
  const chatUser = useChatStore((state) => state.user);
  const { dispatch } = useChatActions();
  const { catalog, error: loadError, loading } = useCollectiblesCatalog();
  const [tab, setTab] = useState<ShopTab>("featured");
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [detail, setDetail] = useState<VariantFamily | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tabsId = useId();
  const panelId = `${tabsId}-panel`;
  const searchId = `${tabsId}-search`;

  const display = chatUser?.avatar_display ?? null;
  const identity = useMemo<PreviewIdentity>(
    () => ({
      avatarSrc: chatUser?.avatar_url
        ? getAuthAssetUrl(chatUser.avatar_url)
        : undefined,
      displayName: getDisplayName(chatUser, "You"),
      username: chatUser?.username ? `@${chatUser.username}` : undefined,
      display,
    }),
    [chatUser, display],
  );

  const categoriesById = useMemo(
    () => new Map((catalog?.categories ?? []).map((c) => [c.id, c] as const)),
    [catalog],
  );
  const equippedSkus = useMemo(
    () =>
      new Set(
        COLLECTIBLE_KINDS.map((kind) =>
          selectedSkuForKind(display, kind),
        ).filter(Boolean) as string[],
      ),
    [display],
  );
  const isEquipped = useCallback(
    (family: VariantFamily) =>
      family.variants.some((variant) => equippedSkus.has(variant.skuId)),
    [equippedSkus],
  );

  const sections = useMemo(
    () =>
      buildCollectionSections(catalog, {
        kinds: tab === "featured" ? undefined : [tab],
        query: deferredQuery,
      }),
    [catalog, deferredQuery, tab],
  );
  const allSections = useMemo(
    () => buildCollectionSections(catalog),
    [catalog],
  );
  const kindCounts = useMemo(() => {
    const counts = {} as Record<CollectibleKind, number>;
    for (const kind of COLLECTIBLE_KINDS) {
      counts[kind] = (catalog?.items ?? []).filter(
        (item) => item.kind === kind,
      ).length;
    }
    return counts;
  }, [catalog]);

  const collection = collectionId ? categoriesById.get(collectionId) : null;
  const collectionSection = collection
    ? allSections.find((section) => section.category.id === collection.id)
    : null;
  const heroSection = allSections[0] ?? null;

  const openCollection = (id: string) => {
    startTransition(() => setCollectionId(id));
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const changeTab = (next: ShopTab) => {
    startTransition(() => {
      setTab(next);
      setCollectionId(null);
    });
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const openDetail = useCallback((family: VariantFamily) => {
    setActionError(null);
    setDetail(family);
  }, []);

  const runApply = async (
    kind: CollectibleKind,
    item: CollectibleCatalogItem | null,
  ) => {
    if (!chatUser || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const { user } = await applyCollectible({
        catalog,
        kind,
        item,
        currentDisplay: chatUser.avatar_display ?? null,
      });
      dispatch({
        type: "SET_USER",
        user: {
          ...chatUser,
          avatar_display: user.avatar_display,
          nameplate_url: user.nameplate_url ?? undefined,
          nameplate_content_type: user.nameplate_content_type ?? undefined,
          updated_at: user.updated_at ?? chatUser.updated_at,
        },
      });
      dispatch({
        type: "UPDATE_MEMBER_PROFILE",
        userId: chatUser.id,
        avatar_display: user.avatar_display,
        nameplate_url: user.nameplate_url,
        nameplate_content_type: user.nameplate_content_type,
        updated_at: user.updated_at ?? undefined,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Couldn't equip that. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const renderGrid = (items: CollectibleCatalogItem[], showKind = false) => (
    <div className={GRID_CLASS}>
      {groupVariantFamilies(items).map((family) => (
        <ShopItemCard
          key={family.key}
          family={family}
          category={categoriesById.get(family.base.categoryId)}
          identity={identity}
          equipped={isEquipped(family)}
          showKind={showKind}
          onOpen={openDetail}
        />
      ))}
    </div>
  );

  const renderRail = (items: CollectibleCatalogItem[]) => (
    <div className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 md:scroll-px-6 [scrollbar-width:thin] [touch-action:pan-x_pan-y] md:-mx-6 md:px-6">
      {groupVariantFamilies(items)
        .slice(0, RAIL_ITEMS)
        .map((family) => (
          <ShopItemCard
            key={family.key}
            family={family}
            category={categoriesById.get(family.base.categoryId)}
            identity={identity}
            equipped={isEquipped(family)}
            showKind
            onOpen={openDetail}
            className="w-[168px] shrink-0 snap-start md:w-[196px]"
          />
        ))}
    </div>
  );

  const renderSectionGrids = (list: CollectionSection[], showKind: boolean) =>
    list.map((section) => (
      <section
        key={section.category.id}
        aria-labelledby={`${tabsId}-${section.category.id}`}
        className="[contain-intrinsic-size:auto_640px] [content-visibility:auto]"
      >
        <SectionHeading
          id={`${tabsId}-${section.category.id}`}
          title={section.category.name}
          count={groupVariantFamilies(section.items).length}
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => openCollection(section.category.id)}
              className="max-md:h-9"
            >
              View collection
            </Button>
          }
        />
        {renderGrid(section.items, showKind)}
      </section>
    ));

  let body: React.ReactNode;
  if (loading) {
    body = <LoadingGrid />;
  } else if (!catalog) {
    body = (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Icon name="shop" size="xl" className="text-rm-text-muted" />
        <p className="text-ui-sm text-rm-text-secondary">
          {loadError ?? "Couldn't load the shop."}
        </p>
      </div>
    );
  } else if (collection && collectionSection) {
    body = (
      <div className="flex flex-col gap-8">
        <CollectionHero
          category={collection}
          itemCount={collectionSection.items.length}
          headingLevel="h2"
        />
        {COLLECTIBLE_KINDS.map((kind) => {
          const items = collectionSection.items.filter(
            (item) => item.kind === kind,
          );
          if (!items.length) return null;
          return (
            <section key={kind} aria-labelledby={`${tabsId}-c-${kind}`}>
              <SectionHeading
                id={`${tabsId}-c-${kind}`}
                title={KIND_COPY[kind].many}
                count={groupVariantFamilies(items).length}
              />
              {renderGrid(items)}
            </section>
          );
        })}
      </div>
    );
  } else if (deferredQuery) {
    const total = countSectionItems(sections);
    body = (
      <div className="flex flex-col gap-8">
        <p role="status" className="text-ui-sm text-rm-text-secondary">
          {total
            ? `${total} ${total === 1 ? "result" : "results"} for “${deferredQuery}”`
            : `Nothing matches “${deferredQuery}”.`}
        </p>
        {renderSectionGrids(sections, tab === "featured")}
      </div>
    );
  } else if (tab === "featured") {
    body = (
      <div className="flex flex-col gap-10">
        {heroSection ? (
          <CollectionHero
            category={heroSection.category}
            itemCount={heroSection.items.length}
            onBrowse={() => openCollection(heroSection.category.id)}
          />
        ) : null}
        <section aria-labelledby={`${tabsId}-collections`}>
          <SectionHeading
            id={`${tabsId}-collections`}
            title="Collections"
            count={allSections.length}
          />
          <div className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 md:scroll-px-6 [scrollbar-width:thin] md:-mx-6 md:px-6">
            {allSections.map((section) => (
              <CollectionCard
                key={section.category.id}
                category={section.category}
                onOpen={() => openCollection(section.category.id)}
              />
            ))}
          </div>
        </section>
        {allSections.slice(0, FEATURED_ROWS).map((section) => (
          <section
            key={section.category.id}
            aria-labelledby={`${tabsId}-row-${section.category.id}`}
          >
            <SectionHeading
              id={`${tabsId}-row-${section.category.id}`}
              title={section.category.name}
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openCollection(section.category.id)}
                  className="max-md:h-9"
                >
                  See all
                  <Icon name="chevronRight" size="sm" />
                </Button>
              }
            />
            {renderRail(section.items)}
          </section>
        ))}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-10">
        {renderSectionGrids(sections, false)}
      </div>
    );
  }

  const tabItems = [
    { value: "featured" as const, label: "Featured" },
    ...COLLECTIBLE_KINDS.map((kind) => ({
      value: kind,
      label: KIND_COPY[kind].many,
      adornment: catalog ? (
        <span className="text-ui-2xs text-rm-text-muted tabular-nums">
          {kindCounts[kind]}
        </span>
      ) : undefined,
    })),
  ];
  const freshness = catalog ? freshnessLabel(catalog) : null;
  const detailCategory = detail
    ? categoriesById.get(detail.base.categoryId)
    : undefined;

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-rm-bg-primary text-rm-text">
      <header className="shrink-0 border-b border-rm-border">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 md:flex-nowrap md:px-6">
          <IconButton
            icon="menu"
            aria-label="Open navigation"
            variant="ghost"
            size="md"
            onClick={onMenuClick}
            className="-ms-2 lg:hidden"
          />
          {collection ? (
            <IconButton
              icon="back"
              aria-label="Back to the shop"
              variant="ghost"
              size="md"
              onClick={() => setCollectionId(null)}
              className="-ms-1"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-ui-lg font-semibold text-rm-text">
              {collection ? collection.name : "Shop"}
            </h1>
            <p className="truncate text-ui-xs text-rm-text-muted">
              {collection
                ? "Collection"
                : freshness
                  ? `Every collectible is free to equip · ${freshness}`
                  : "Every collectible is free to equip"}
            </p>
          </div>
          <div className="relative w-full md:w-72">
            <label htmlFor={searchId} className="sr-only">
              Search the shop
            </label>
            <Icon
              name="search"
              size="sm"
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-rm-text-muted"
            />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (collectionId) setCollectionId(null);
              }}
              placeholder="Search the shop"
              enterKeyHint="search"
              autoComplete="off"
              className="h-11 w-full rounded-lg border border-rm-field-edge bg-rm-bg-surface ps-9 pe-3 text-base text-rm-text outline-none placeholder:text-rm-text-muted focus-visible:border-rm-focus md:h-9 md:text-ui-sm"
            />
          </div>
        </div>
        {collection ? (
          <div className="h-3" />
        ) : (
          <div className="mx-auto w-full max-w-[1400px] overflow-x-auto px-4 [scrollbar-width:none] md:px-6">
            <Tabs
              label="Collectible type"
              items={tabItems}
              value={tab}
              onValueChange={changeTab}
              idBase={tabsId}
              panelId={panelId}
              className="h-11 w-max gap-5"
            />
          </div>
        )}
      </header>

      <div
        ref={scrollRef}
        id={panelId}
        role={collection ? "region" : "tabpanel"}
        aria-labelledby={collection ? undefined : tabId(tabsId, tab)}
        aria-label={collection ? collection.name : undefined}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-5 pb-[calc(var(--safe-area-bottom,0px)+2rem)] md:px-6 md:pt-6">
          {body}
        </div>
      </div>

      {detail ? (
        <ShopItemDetail
          key={detail.key}
          family={detail}
          category={detailCategory}
          identity={identity}
          currentDisplay={chatUser?.avatar_display}
          busy={busy}
          error={actionError}
          onOpenChange={(open) => {
            if (!open) setDetail(null);
          }}
          onEquip={(item) => void runApply(item.kind, item)}
          onRemove={(item) => void runApply(item.kind, null)}
        />
      ) : null}
    </div>
  );
}
