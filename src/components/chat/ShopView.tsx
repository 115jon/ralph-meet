import { AvatarImage } from "@/components/chat/AvatarImage";
import { HomeIcon } from "@/components/chat/HomeIcon";
import { Menu } from "@/components/chat/Icons";
import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { BaseModal } from "@/components/ui/BaseModal";
import { Button } from "@/components/ui/button";
import { CustomSelect, type SelectOption } from "@/components/ui/CustomSelect";
import { Input } from "@/components/ui/input";
import { apiPatch } from "@/lib/api-client";
import {
  normalizeAvatarDisplay,
  type AvatarCollectibles,
  type AvatarDisplay,
} from "@/lib/avatar-display";
import {
  collectibleItemToSelection,
  getCollectibleApplySelections,
  getBundleConstituentItems,
  isBundleCollectible,
  isBundleFullyApplied,
  selectedSkuForKind,
} from "@/lib/collectible-selection";
import {
  getCachedCollectiblesCatalog,
  loadCollectiblesCatalog,
  subscribeCollectiblesCatalog,
} from "@/lib/collectibles-catalog-client";
import type {
  CollectibleCatalogCategory,
  CollectibleCatalogItem,
  CollectibleKind,
  CollectiblesCatalog,
} from "@/lib/collectibles-catalog";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import {
  BadgeCheck,
  Gem,
  LayoutGrid,
  Loader2,
  Palette,
  Search,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  forwardRef,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VirtuosoGrid, type GridComponents } from "react-virtuoso";

type ShopPage = "featured" | "all" | "frames" | "badges" | "orbs" | "misc";

type ShopGroup = {
  key: string;
  title: string;
  kind: CollectibleKind;
  categoryId: string;
  categoryName: string;
  category?: CollectibleCatalogCategory;
  items: CollectibleCatalogItem[];
};

type ShopCollectionSection = {
  category: CollectibleCatalogCategory;
  groups: ShopGroup[];
};

type ShopViewProps = {
  onMenuClick: () => void;
};

type ApplyResponseUser = {
  avatar_display: AvatarDisplay | null;
  nameplate_url: string | null;
  nameplate_content_type: string | null;
  updated_at: string | null;
};

type ShopGridContext = {
  header?: ReactNode;
};

const SHOP_PAGE_ORDER: ShopPage[] = ["featured", "all", "frames", "badges", "orbs", "misc"];
const FEATURED_CATEGORY_PRIORITY = [
  "Flux Vol. 2",
  "Toy Story",
  "World Cup",
  "Fruitables",
  "Starlight Magic",
  "Hello Kitty and Friends",
];
const KIND_LABELS: Record<CollectibleKind, string> = {
  avatar_decoration: "Avatar decoration",
  profile_effect: "Profile effect",
  nameplate: "Nameplate",
  profile_frame: "Profile frame",
};

const PAGE_COPY: Record<ShopPage, { label: string; description: string }> = {
  featured: {
    label: "Featured",
    description: "Hand-picked drops and spotlight collections.",
  },
  all: {
    label: "All Collectibles",
    description: "Everything mirrored into the local archive.",
  },
  frames: {
    label: "Avatar Decorations",
    description: "Avatar decorations and profile frame variants.",
  },
  badges: {
    label: "Nameplates",
    description: "Identity banners and plate variants.",
  },
  orbs: {
    label: "Profile Effects",
    description: "Animated profile effects and motion-led flourishes.",
  },
  misc: {
    label: "Bundles",
    description: "Mixed collectible packs and themed sets.",
  },
};

const SHOP_PANEL_CLASS = "rounded-[24px] border border-rm-border bg-rm-bg-surface/90 shadow-[0_24px_80px_rgba(0,0,0,0.18)]";
const SHOP_STATIC_GRID_CLASS = "grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))]";
const SHOP_FIELD_LABEL_CLASS = "mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-rm-text-muted";
const SHOP_META_PILL_CLASS = "inline-flex items-center rounded-full border border-rm-border bg-rm-bg-surface/70 px-2.5 py-0.5 text-[11px] text-rm-text-muted backdrop-blur-sm";
const SHOP_INPUT_CLASS = "h-10 rounded-2xl border-rm-border bg-rm-bg-surface/80 text-sm text-rm-text shadow-none placeholder:text-rm-text-muted focus-visible:border-primary/50 focus-visible:ring-primary/15";
const SHOP_SELECT_TRIGGER_CLASS = "h-10 rounded-2xl border-rm-border bg-rm-bg-surface/80 px-4 py-0 text-sm font-medium text-rm-text shadow-none hover:bg-rm-bg-hover focus:border-primary/50";
const SHOP_SELECT_MENU_CLASS = "rounded-2xl border-rm-border bg-rm-bg-floating/95 p-1.5 shadow-2xl backdrop-blur-xl";
const SHOP_RAIL_SHELL_CLASS = "relative overflow-visible rounded-[2rem] border border-rm-border/80 bg-rm-bg-hover/25 p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.12)]";
const SHOP_RAIL_CORE_CLASS = "relative overflow-visible rounded-[calc(2rem-0.375rem)] border border-white/5 bg-rm-bg-surface/92 p-3 sm:p-3.5";

function pageIcon(page: ShopPage) {
  if (page === "featured") return Sparkles;
  if (page === "all") return ShoppingBag;
  if (page === "frames") return LayoutGrid;
  if (page === "badges") return BadgeCheck;
  if (page === "orbs") return Gem;
  return Palette;
}

const SHOP_GRID_COMPONENTS: GridComponents<ShopGridContext> = {
  Header: ({ context }) => context.header ? <div className="pb-2">{context.header}</div> : null,
  List: forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(function ShopGridList(
    { children, className, style, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        {...props}
        className={cn(
          "mx-auto flex w-full max-w-[1480px] flex-wrap content-start items-stretch px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6",
          className
        )}
        style={style}
      >
        {children}
      </div>
    );
  }),
  Item: forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(function ShopGridItem(
    { children, className, style, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        {...props}
        className={cn("flex h-[368px] min-w-0 w-full p-1.5 min-[420px]:h-[392px] min-[420px]:w-1/2 sm:p-2 lg:w-1/3 xl:h-[426px] 2xl:w-1/4", className)}
        style={style}
      >
        {children}
      </div>
    );
  }),
  ScrollSeekPlaceholder: function ShopGridPlaceholder() {
    return (
      <div className={cn(SHOP_PANEL_CLASS, "h-full w-full overflow-hidden p-3 sm:p-4")}>
        <div className="h-52 animate-pulse rounded-[18px] bg-rm-bg-hover sm:h-60 sm:rounded-[22px]" />
        <div className="mt-3 h-5 w-2/3 animate-pulse rounded bg-rm-bg-hover sm:mt-4" />
        <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-rm-bg-hover" />
        <div className="mt-5 h-10 w-full animate-pulse rounded-full bg-rm-bg-hover" />
      </div>
    );
  },
};

function normalizeBaseName(name: string) {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function variantLabel(item: CollectibleCatalogItem) {
  const match = item.name.match(/\(([^)]+)\)\s*$/);
  if (match?.[1]) return match[1];
  if (item.palette) {
    return item.palette
      .split(/[_-]/g)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return null;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSourcePrice(item: CollectibleCatalogItem) {
  const price = item.price ?? item.nitroPrice;
  if (!price) return null;
  if (price.currency === "discord_orb") {
    return `${compactNumber(price.amount)} Orbs`;
  }
  const amount = price.amount / 10 ** price.exponent;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency.toUpperCase(),
  }).format(amount);
}

function isOrbsExclusive(item: CollectibleCatalogItem) {
  return item.price?.currency === "discord_orb";
}

function isCollectibleEquipped(
  display: AvatarDisplay | string | null | undefined,
  catalog: CollectiblesCatalog | null,
  item: CollectibleCatalogItem,
) {
  return isBundleCollectible(item)
    ? isBundleFullyApplied(display, catalog, item)
    : selectedSkuForKind(display, item.kind) === item.skuId;
}

function redeemButtonLabel(item: CollectibleCatalogItem) {
  const sourcePrice = formatSourcePrice(item);
  return sourcePrice ? `Redeem ${sourcePrice}` : "Redeem free";
}

function detailStageClass(item: CollectibleCatalogItem) {
  if (isBundleCollectible(item)) return "max-w-[680px] aspect-[16/11]";
  if (item.kind === "nameplate") return "max-w-[700px] aspect-[16/10]";
  if (item.kind === "profile_effect" || item.kind === "profile_frame") {
    return "max-w-[440px] aspect-[10/13]";
  }
  return "max-w-[440px] aspect-square";
}

function paletteToSwatch(item: CollectibleCatalogItem, index: number) {
  const key = `${item.palette ?? variantLabel(item) ?? item.name}`.toLowerCase();
  const swatches: Record<string, string> = {
    amethyst: "#9251ff",
    arctic: "#cdddf2",
    base: "#f5f5f5",
    blue: "#60a5fa",
    crimson: "#dd2747",
    green: "#4ade80",
    jade: "#69c8a7",
    mint: "#8de4c7",
    nightshade: "#5c405b",
    orange: "#fb923c",
    pink: "#ec7ed1",
    purple: "#b58cff",
    rainbow: "linear-gradient(135deg, #ff5d6c, #c966ff 35%, #62b7ff 68%, #9cf08f)",
    red: "#ef4444",
    rgb: "linear-gradient(135deg, #ef4444, #d946ef 38%, #60a5fa 68%, #9ae66e)",
    white: "#ffffff",
    yellow: "#facc15",
  };
  const fromMap = swatches[key];
  if (fromMap) return fromMap;

  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash + index * 47) % 360;
  return `hsl(${hue} 75% 65%)`;
}

function mergeCollectiblePreview(
  display: AvatarDisplay | string | null | undefined,
  kind: CollectibleKind,
  item: CollectibleCatalogItem | null,
) {
  const normalized = normalizeAvatarDisplay(display);
  const nextDisplay: AvatarDisplay = normalized ?? { version: 1 };
  const collectibles: AvatarCollectibles = { ...(nextDisplay.collectibles ?? {}) };

  if (!item) {
    if (kind === "avatar_decoration") delete collectibles.avatarDecoration;
    if (kind === "profile_effect") delete collectibles.profileEffect;
    if (kind === "nameplate") delete collectibles.nameplate;
    if (kind === "profile_frame") delete collectibles.profileFrame;
  } else {
    Object.assign(collectibles, collectibleItemToSelection(item));
  }

  // Do not render avatar decoration or other profile items for profile effects/frames previews
  if (kind === "profile_effect" || kind === "profile_frame") {
    delete collectibles.avatarDecoration;
    if (kind === "profile_effect") {
      delete collectibles.profileFrame;
    } else {
      delete collectibles.profileEffect;
    }
  }

  return normalizeAvatarDisplay({
    ...nextDisplay,
    collectibles,
  });
}

function groupCatalogItems(catalog: CollectiblesCatalog | null): ShopGroup[] {
  if (!catalog) return [];

  const categoryById = new Map(catalog.categories.map((category) => [category.id, category] as const));
  const categoryRank = new Map(catalog.categories.map((category, index) => [category.id, index] as const));
  const groups = new Map<string, ShopGroup>();

  for (const item of catalog.items) {
    const title = normalizeBaseName(item.name);
      const isItemBundle = isBundleCollectible(item);
    const key = isItemBundle
      ? `bundle|${item.categoryId}|${item.productId}`
      : `${item.kind}|${item.categoryId}|${title.toLowerCase()}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      continue;
    }

    groups.set(key, {
      key,
      title,
      kind: item.kind,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      category: categoryById.get(item.categoryId),
      items: [item],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => {
        const leftLabel = variantLabel(left) ?? left.name;
        const rightLabel = variantLabel(right) ?? right.name;
        return leftLabel.localeCompare(rightLabel);
      }),
    }))
    .sort((left, right) => {
      const categoryOrder = (categoryRank.get(left.categoryId) ?? Number.MAX_SAFE_INTEGER)
        - (categoryRank.get(right.categoryId) ?? Number.MAX_SAFE_INTEGER);
      if (categoryOrder !== 0) return categoryOrder;
      return left.title.localeCompare(right.title);
    });
}

function matchesQuery(group: ShopGroup, query: string) {
  if (!query) return true;
  const haystack = [
    group.title,
    group.categoryName,
    ...group.items.map((item) => `${item.name} ${item.label ?? ""} ${item.summary}`),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function heroCategory(catalog: CollectiblesCatalog | null) {
  if (!catalog) return null;
  const byName = new Map(catalog.categories.map((category) => [category.name, category] as const));
  for (const name of FEATURED_CATEGORY_PRIORITY) {
    const match = byName.get(name);
    if (match?.bannerUrl) return match;
  }
  return catalog.categories.find((category) => category.bannerUrl) ?? null;
}

function buildFeaturedSections(catalog: CollectiblesCatalog | null, groups: ShopGroup[]) {
  if (!catalog) return [];
  const sections: ShopCollectionSection[] = [];
  const byName = new Map(catalog.categories.map((category) => [category.name, category] as const));
  const seen = new Set<string>();

  for (const name of FEATURED_CATEGORY_PRIORITY) {
    const category = byName.get(name);
    if (!category) continue;
    const sectionGroups = groups.filter((group) => group.categoryId === category.id);
    if (!sectionGroups.length) continue;
    sections.push({ category, groups: sectionGroups });
    seen.add(category.id);
  }

  for (const category of catalog.categories) {
    if (seen.has(category.id)) continue;
    const sectionGroups = groups.filter((group) => group.categoryId === category.id);
    if (!sectionGroups.length) continue;
    sections.push({ category, groups: sectionGroups });
  }

  return sections.slice(0, 10);
}

function previewCategoryForPage(catalog: CollectiblesCatalog | null, page: ShopPage) {
  if (!catalog) return null;
  const categories = catalog.categories;

  if (page === "all") {
    return categories.find((category) => category.bannerUrl) ?? null;
  }
  if (page === "frames") {
    return categories.find((category) => category.name === "Frames") ?? categories.find((category) => category.bannerUrl) ?? null;
  }
  if (page === "badges") {
    return categories.find((category) => category.name.includes("Nameplate")) ?? categories.find((category) => category.name === "Nameplates") ?? null;
  }
  if (page === "orbs") {
    return categories.find((category) => category.name === "Orb") ?? null;
  }
  if (page === "misc") {
    return categories.find((category) => category.name === "Fruitables")
      ?? categories.find((category) => category.name === "Fantasy")
      ?? categories.find((category) => category.bannerUrl) ?? null;
  }
  return heroCategory(catalog);
}

function isRecentlyUpdated(item: CollectibleCatalogItem) {
  if (!item.updatedAt) return false;
  const updatedAt = Date.parse(item.updatedAt);
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() - updatedAt <= 1000 * 60 * 60 * 24 * 120;
}

function ShopPreview({
  item,
  currentDisplay,
  avatarSrc,
  displayName,
  playAnimation = true,
  catalog = null,
}: {
  item: CollectibleCatalogItem;
  currentDisplay?: AvatarDisplay | string | null;
  avatarSrc?: string;
  displayName: string;
  playAnimation?: boolean;
  catalog?: CollectiblesCatalog | null;
}) {
  const previewDisplay = mergeCollectiblePreview(currentDisplay, item.kind, item);

  if (isBundleCollectible(item)) {
    const fg = item.previewAssets?.fg_static;
    const bg = item.previewAssets?.bg_static;
    if (fg || bg) {
      return (
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-rm-bg-primary">
          {bg && (
            <img
              src={bg}
              alt=""
              className="absolute left-0 top-0 w-full h-[48.5%] object-cover object-center"
              loading="lazy"
            />
          )}
          {fg && (
            <img
              src={fg}
              alt=""
              className="absolute inset-0 w-full h-full object-contain"
              loading="lazy"
            />
          )}
        </div>
      );
    }

    const constituents = getBundleConstituentItems(catalog, item);

    const decoration = constituents.find((c) => c.kind === "avatar_decoration");
    const nameplate = constituents.find((c) => c.kind === "nameplate");
    const frameItem = constituents.find((c) => c.kind === "profile_frame");
    const effectItem = constituents.find((c) => c.kind === "profile_effect");

    const decorationUrl = decoration?.staticUrl ?? decoration?.previewUrl ?? decoration?.animatedUrl;
    const nameplateUrl = nameplate?.staticUrl ?? nameplate?.previewUrl;

    const frameSelection = frameItem ? collectibleItemToSelection(frameItem).profileFrame : undefined;
    const frameDisplay = frameSelection ? normalizeAvatarDisplay({
      version: 1,
      collectibles: {
        profileFrame: frameSelection,
      },
    }) : null;

    const effectSelection = effectItem ? collectibleItemToSelection(effectItem).profileEffect : undefined;
    const effectDisplay = effectSelection ? normalizeAvatarDisplay({
      version: 1,
      collectibles: {
        profileEffect: effectSelection,
      },
    }) : null;

    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[22px] bg-rm-bg-floating p-3 select-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.03),_transparent_55%)]" />
        
        {/* 1. Profile Card (angled/skewed on the right) */}
        {effectItem && (
          <div 
            className="absolute top-4 -right-2 h-[190px] w-[114px] origin-top-right rotate-[4deg] overflow-hidden rounded-[12px] border border-rm-border bg-rm-bg-surface shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
          >
            {/* Banner */}
            <div className="absolute left-0 right-0 top-0 h-10 border-b border-rm-border bg-rm-bg-hover" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,_transparent,_rgba(17,20,27,0.96)_34%,_rgba(11,13,18,0.98))]" />
            
            {/* Avatar Placeholder */}
            <div className="absolute left-2.5 top-6 z-10 flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-rm-border bg-rm-bg-hover shadow-[0_6px_12px_rgba(0,0,0,0.3)]">
              <HomeIcon className="h-4.5 w-4.5 text-rm-text-muted" />
            </div>

            {/* Skeletons */}
            <div className="absolute left-2.5 top-[58px] h-2 w-10 rounded-full bg-white/20" />
            <div className="absolute left-2.5 top-[66px] h-1.5 w-14 rounded-full bg-white/10" />
            <div className="absolute left-2.5 right-2.5 top-[76px] h-[1px] bg-white/8" />
            <div className="absolute left-2.5 top-[84px] h-1.5 w-8 rounded-full bg-white/18" />
            <div className="absolute left-2.5 top-[92px] h-1 w-16 rounded-full bg-white/10" />

            {/* Profile Effect Layer (Still frame/static version by default, no hover play) */}
            {effectDisplay && (
              <ProfileCollectiblesLayer display={effectDisplay} effectOpacity={1} fit="cover" className="opacity-100" playAnimation={false} />
            )}
          </div>
        )}

        {/* 2. Avatar Decoration / Frame (top-left floating circle) */}
        <div className={cn(
          "absolute flex items-center justify-center rounded-full border border-rm-border bg-rm-bg-floating/80 shadow-[0_12px_32px_rgba(0,0,0,0.4)]",
          effectItem ? "left-6 top-6 h-20 w-20" : "h-28 w-28"
        )}>
          <div className={cn(
            "relative flex items-center justify-center overflow-visible rounded-full bg-rm-bg-hover",
            effectItem ? "h-14 w-14" : "h-20 w-20"
          )}>
            <HomeIcon className={effectItem ? "h-7 w-7 text-rm-text-muted" : "h-10 w-10 text-rm-text-muted"} />
            {decorationUrl && (
              <img
                src={decorationUrl}
                alt=""
                className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-[124%] w-[124%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
              />
            )}
            {frameDisplay && (
              <ProfileCollectiblesLayer display={frameDisplay} className="absolute inset-0 z-20 scale-[1.1]" playAnimation={false} />
            )}
          </div>
        </div>

        {/* 3. Nameplate Bar (bottom-left floating bar) */}
        {nameplateUrl && (
          <div className={cn(
            "absolute flex items-center overflow-hidden rounded-[8px] border border-rm-border bg-rm-bg-floating shadow-[0_8px_24px_rgba(0,0,0,0.4)]",
            effectItem ? "left-4 bottom-5 w-[120px] h-[34px] px-2.5 gap-2" : "bottom-6 w-[160px] h-[40px] px-3 gap-2.5"
          )}>
            {/* Nameplate image background */}
            <img src={nameplateUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-85" />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(0,0,0,0.65),_rgba(0,0,0,0.38)_50%,_rgba(0,0,0,0.58))]" />
            {/* Avatar inside nameplate */}
            <div className={cn(
              "relative z-10 flex shrink-0 items-center justify-center rounded-full border border-rm-border bg-rm-bg-hover shadow-[0_2px_6px_rgba(0,0,0,0.3)]",
              effectItem ? "h-[18px] w-[18px]" : "h-[22px] w-[22px]"
            )}>
              <HomeIcon className={effectItem ? "h-2.5 w-2.5 text-rm-text-secondary" : "h-3 w-3 text-rm-text-secondary"} />
            </div>
            {/* Skeleton text bar */}
            <div className={cn("rounded-full bg-white/25 z-10", effectItem ? "h-2 w-12" : "h-2.5 w-16")} />
          </div>
        )}
      </div>
    );
  }

  if (item.kind === "avatar_decoration") {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[22px] bg-rm-bg-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(130,170,255,0.28),_transparent_45%),radial-gradient(circle_at_bottom,_rgba(255,110,180,0.22),_transparent_50%)]" />
        <div className="relative h-28 w-28 rounded-full bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
          {avatarSrc ? (
            <AvatarImage src={avatarSrc} alt="" display={previewDisplay} />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-full text-3xl font-bold text-rm-text-secondary">
              {getDisplayInitial({ name: displayName })}
            </div>
          )}
        </div>
      </div>
    );
  }



  if (item.kind === "nameplate") {
    return (
      <div className="relative flex h-full flex-col justify-center overflow-hidden rounded-[22px] bg-rm-bg-floating p-4 font-sans select-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.02),_transparent_60%)]" />
        
        <div className="mx-auto flex w-full max-w-[280px] flex-col gap-2.5">
          {/* Row 1 (Skeleton) */}
          <div className="flex items-center opacity-[0.25]">
            <div className="relative h-8 w-8 shrink-0 rounded-full bg-white/8">
              <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-[#07080b] bg-white/15" />
            </div>
            <div className="ml-3 h-2 w-28 rounded-full bg-white/8" />
          </div>

          {/* Row 2 (Skeleton) */}
          <div className="flex items-center opacity-[0.45]">
            <div className="relative h-8 w-8 shrink-0 rounded-full bg-white/10">
              <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-[#07080b] bg-white/20" />
            </div>
            <div className="ml-3 h-2 w-24 rounded-full bg-white/10" />
          </div>

          {/* Row 3 (Highlighted Preview Row with Nameplate) */}
          <div className="relative flex w-full h-[40px] items-center gap-3 rounded-[8px] border border-white/5 overflow-hidden px-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
            {playAnimation && item.animatedUrl ? (
              <video
                src={item.animatedUrl}
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                loop
                muted
                playsInline
              />
            ) : item.staticUrl ? (
              <img
                src={item.staticUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-r from-black/25 via-black/10 to-black/35" />

            {/* Avatar container */}
            <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 border border-white/10 overflow-hidden">
              {playAnimation ? (
                avatarSrc ? (
                  <AvatarImage src={avatarSrc} alt="" display={previewDisplay} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-full text-[10px] font-bold text-rm-text-secondary">
                    {getDisplayInitial({ name: displayName })}
                  </div>
                )
              ) : (
                <HomeIcon className="h-4 w-4 text-rm-text-secondary" />
              )}
              {/* Badge circle */}
              <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-[#07080b] bg-emerald-400" />
            </div>

            {/* Text skeleton */}
            <div className="relative z-10 h-3 w-28 rounded-full border border-rm-border bg-rm-bg-hover backdrop-blur-md" />
          </div>

          {/* Row 4 (Skeleton) */}
          <div className="flex items-center opacity-[0.45]">
            <div className="relative h-8 w-8 shrink-0 rounded-full bg-white/10">
              <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-[#07080b] bg-white/20" />
            </div>
            <div className="ml-3 h-2 w-28 rounded-full bg-white/10" />
          </div>

          {/* Row 5 (Skeleton) */}
          <div className="flex items-center opacity-[0.25]">
            <div className="relative h-8 w-8 shrink-0 rounded-full bg-white/8">
              <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-[#07080b] bg-white/15" />
            </div>
            <div className="ml-3 h-2 w-20 rounded-full bg-white/8" />
          </div>
        </div>
      </div>
    );
  }

  if (item.kind === "profile_effect" || item.kind === "profile_frame") {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[22px] bg-rm-bg-primary p-3">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_45%)]" />
        <div
          className="relative h-full w-[114px] overflow-hidden rounded-[14px] border border-rm-border bg-rm-bg-surface shadow-[0_12px_36px_rgba(0,0,0,0.35)]"
          style={{ aspectRatio: "450 / 880" }}
        >
          {/* Mock profile background banner / skeleton */}
          <div className="absolute left-0 right-0 top-0 h-10 border-b border-rm-border bg-rm-bg-hover" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,_transparent,_rgba(17,20,27,0.96)_34%,_rgba(11,13,18,0.98))]" />
          
          {/* Mock small avatar placeholder with logo (no user avatar) */}
          <div className="absolute left-2 top-6 z-10 flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-rm-border bg-rm-bg-hover shadow-[0_6px_12px_rgba(0,0,0,0.3)]">
            <HomeIcon className="h-4.5 w-4.5 text-rm-text-secondary" />
          </div>

          {/* User display name */}
          <div className="absolute left-2.5 top-[58px] h-2 w-12 rounded-full bg-white/20" />
          {/* Username */}
          <div className="absolute left-2.5 top-[66px] h-1.5 w-16 rounded-full bg-white/10" />

          {/* Divider */}
          <div className="absolute left-2.5 right-2.5 top-[76px] h-[1px] bg-white/8" />

          {/* About Me header */}
          <div className="absolute left-2.5 top-[84px] h-1.5 w-10 rounded-full bg-white/18" />
          {/* About Me body lines */}
          <div className="absolute left-2.5 top-[92px] h-1 w-20 rounded-full bg-white/10" />
          <div className="absolute left-2.5 top-[99px] h-1 w-16 rounded-full bg-white/10" />

          {/* Divider 2 */}
          <div className="absolute left-2.5 right-2.5 top-[110px] h-[1px] bg-white/8" />

          {/* Member since header */}
          <div className="absolute left-2.5 top-[118px] h-1.5 w-12 rounded-full bg-white/18" />
          {/* Member since value */}
          <div className="absolute left-2.5 top-[126px] h-1 w-14 rounded-full bg-white/10" />

          {/* Mock details block / activity at bottom */}
          <div className="absolute inset-x-2 bottom-2 rounded-lg border border-rm-border bg-rm-bg-floating/80 p-1.5">
            <div className="h-1.5 w-10 rounded-full bg-white/18 animate-pulse" />
            <div className="mt-1 h-1 w-14 rounded-full bg-white/10 animate-pulse" />
          </div>
          
          {/* Profile effect overlay layer */}
          <ProfileCollectiblesLayer display={previewDisplay} effectOpacity={1} fit="cover" className="opacity-100" playAnimation={playAnimation} />
          
          {/* Subtle surface highlights */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.05),_transparent_42%),linear-gradient(180deg,_rgba(6,7,10,0.04),_rgba(6,7,10,0.18))]" />
        </div>
      </div>
    );
  }

  // Fallback return
  return (
      <div className="relative h-full overflow-hidden rounded-[22px] bg-rm-bg-primary">
      {item.previewUrl && (
        <img
          src={item.previewUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-[1.02] object-contain p-3 opacity-58"
          loading="lazy"
          decoding="async"
        />
      )}
      <ProfileCollectiblesLayer display={previewDisplay} className="opacity-95" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.16),_transparent_45%),linear-gradient(180deg,_rgba(0,0,0,0.18),_rgba(0,0,0,0.52))]" />
      <div className="absolute bottom-4 left-4 z-10 h-20 w-20 rounded-full bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
        {avatarSrc ? (
          <AvatarImage src={avatarSrc} alt="" display={previewDisplay} />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-full text-2xl font-bold text-rm-text-secondary">
            {getDisplayInitial({ name: displayName })}
          </div>
        )}
      </div>
    </div>
  );
}

function CollectionBanner({
  section,
  ctaLabel,
  onClick,
}: {
  section: ShopCollectionSection;
  ctaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        SHOP_PANEL_CLASS,
        "group relative w-full overflow-hidden text-left transition-transform duration-300 hover:-translate-y-1 sm:rounded-[26px]",
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,var(--rm-accent-dim),transparent_34%)]" />
      {section.category.bannerUrl && (
        <img
          src={section.category.bannerUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.015]"
          loading="lazy"
          decoding="async"
        />
      )}
      <div className="absolute inset-0 [background-image:var(--rm-profile-banner-overlay)]" />
      <div className="relative flex min-h-40 flex-col justify-between gap-5 p-5 sm:min-h-52 sm:gap-6 sm:p-8">
        <div className="max-w-lg">
          <h3 className="text-balance text-[1.9rem] font-black tracking-[-0.05em] text-rm-text sm:text-4xl">
            {section.category.name}
          </h3>
        </div>
        <span className="inline-flex w-fit items-center rounded-2xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-transform duration-300 group-hover:translate-x-1 sm:px-4">
          {ctaLabel}
        </span>
      </div>
    </button>
  );
}

function CollectibleDetailModal({
  group,
  item,
  previewItem,
  previewItems,
  currentDisplay,
  avatarSrc,
  displayName,
  isEquipped,
  isApplying,
  onClose,
  onRedeem,
  onEquip,
  onSelectVariant,
  onSelectPreviewItem,
  catalog = null,
}: {
  group: ShopGroup;
  item: CollectibleCatalogItem;
  previewItem: CollectibleCatalogItem;
  previewItems: CollectibleCatalogItem[];
  currentDisplay?: AvatarDisplay | string | null;
  avatarSrc?: string;
  displayName: string;
  isEquipped: boolean;
  isApplying: boolean;
  onClose: () => void;
  onRedeem: () => void;
  onEquip: () => void;
  onSelectVariant: (itemId: string) => void;
  onSelectPreviewItem: (itemId: string) => void;
  catalog?: CollectiblesCatalog | null;
}) {
  const sourcePrice = formatSourcePrice(item);
  const showVariantSwatches = group.items.length > 1;
  const showBundleStrip = isBundleCollectible(item) && previewItems.length > 1;
  const currentVariant = variantLabel(item);
  const previewBackdrop =
    previewItem.previewAssets?.bg_static
    ?? item.previewAssets?.bg_static
    ?? group.category?.bannerUrl
    ?? previewItem.previewUrl
    ?? item.previewUrl
    ?? null;
  const previewDescriptor = previewItem.id === item.id && isBundleCollectible(item)
    ? "Bundle scene"
    : `${KIND_LABELS[previewItem.kind]} preview`;

  return (
    <BaseModal onClose={onClose}>
      <div
        className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/72 p-3 backdrop-blur-md md:p-5"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        role="presentation"
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby={`collectible-detail-title-${item.id}`}
          className="relative flex max-h-[92vh] w-full max-w-[1220px] flex-col overflow-hidden rounded-[2rem] border border-rm-border/80 bg-rm-bg-primary shadow-[0_30px_120px_rgba(0,0,0,0.45)] lg:min-h-[700px] lg:flex-row"
          onClick={(event) => event.stopPropagation()}
        >
          <aside className="relative flex w-full shrink-0 flex-col overflow-y-auto border-b border-rm-border bg-rm-bg-surface/95 p-4 custom-scrollbar sm:p-5 lg:w-[340px] lg:border-b-0 lg:border-r lg:p-6">
            <div className="space-y-5">
              <div className={SHOP_RAIL_SHELL_CLASS}>
                <div className={cn(SHOP_RAIL_CORE_CLASS, "p-2.5")}>
                  <div className={cn("relative mx-auto w-full overflow-hidden rounded-[calc(2rem-0.5rem)] border border-white/8 bg-rm-bg-primary", detailStageClass(previewItem))}>
                    <ShopPreview
                      item={previewItem}
                      currentDisplay={currentDisplay}
                      avatarSrc={avatarSrc}
                      displayName={displayName}
                      playAnimation={false}
                      catalog={catalog}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <span className={SHOP_META_PILL_CLASS}>{group.categoryName}</span>
                  <span className={SHOP_META_PILL_CLASS}>{KIND_LABELS[item.kind]}</span>
                  <span className={SHOP_META_PILL_CLASS}>Source {item.source}</span>
                </div>

                <div>
                  <h2
                    id={`collectible-detail-title-${item.id}`}
                    className="text-balance text-[1.9rem] font-black tracking-[-0.05em] text-rm-text sm:text-[2.15rem]"
                  >
                    {group.title}
                  </h2>
                  <p className="mt-1 text-sm text-rm-text-secondary">
                    {currentVariant ? `${KIND_LABELS[item.kind]} / ${currentVariant}` : KIND_LABELS[item.kind]}
                  </p>
                  <p className="mt-3 max-w-[30ch] text-sm leading-6 text-rm-text-muted">
                    {showBundleStrip ? `Bundle includes ${previewItems.length} pieces. ${item.summary}` : item.summary}
                  </p>
                </div>
              </div>

              {showVariantSwatches ? (
                <div className="space-y-2">
                  <p className={SHOP_FIELD_LABEL_CLASS}>Variants</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {group.items.map((variant, index) => {
                      const selected = variant.id === item.id;
                      const swatch = paletteToSwatch(variant, index);
                      return (
                        <button
                          key={variant.id}
                          type="button"
                          onClick={() => onSelectVariant(variant.id)}
                          className={cn(
                            "h-8 w-8 rounded-[10px] border-2 transition-all duration-200",
                            selected
                              ? "scale-105 border-primary shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                              : "border-transparent hover:scale-105 hover:border-rm-border-strong",
                          )}
                          style={{ background: swatch }}
                          aria-label={variantLabel(variant) ?? variant.name}
                          title={variantLabel(variant) ?? variant.name}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {showBundleStrip ? (
                <div className="space-y-2.5">
                  <p className={SHOP_FIELD_LABEL_CLASS}>Preview each piece</p>
                  <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                    {previewItems.map((candidate) => {
                      const selected = candidate.id === previewItem.id;
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          onClick={() => onSelectPreviewItem(candidate.id)}
                          className={cn(
                            "w-[72px] shrink-0 rounded-[1.1rem] border p-1.5 text-left transition-all duration-200",
                            selected
                              ? "border-primary bg-primary/10 shadow-[0_14px_35px_rgba(0,0,0,0.22)]"
                              : "border-rm-border bg-rm-bg-hover/55 hover:border-rm-border-strong hover:bg-rm-bg-hover",
                          )}
                          aria-label={`Preview ${candidate.name}`}
                        >
                          <div className="h-[58px] overflow-hidden rounded-[0.95rem] bg-rm-bg-primary">
                            <ShopPreview
                              item={candidate}
                              currentDisplay={currentDisplay}
                              avatarSrc={avatarSrc}
                              displayName={displayName}
                              playAnimation={false}
                              catalog={catalog}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-rm-text-muted">
                    Previewing {previewItem.id === item.id && isBundleCollectible(item) ? "the full bundle scene" : normalizeBaseName(previewItem.name)}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-5 space-y-3 pt-1">
              <div className="rounded-[1.4rem] border border-rm-border bg-rm-bg-hover/70 px-4 py-3.5">
                <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.14em] text-rm-text-muted">
                  <span>{isOrbsExclusive(item) ? "Using Orbs" : "Archive access"}</span>
                  <span className="truncate text-rm-text-secondary">{sourcePrice ?? "Free drop"}</span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[1.65rem] font-semibold tracking-[-0.05em] text-rm-text">
                      {sourcePrice ?? "Free"}
                    </div>
                    <p className="text-xs text-rm-text-muted">
                      {isEquipped ? "Already applied to your profile." : "Redeem it, then equip it instantly."}
                    </p>
                  </div>
                  {isEquipped ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                      <BadgeCheck className="h-3.5 w-3.5" />
                      Applied
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2">
                <Button
                  type="button"
                  onClick={onRedeem}
                  disabled={isApplying}
                  className="h-11 rounded-2xl bg-primary text-primary-foreground shadow-[0_16px_40px_var(--rm-glow)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-primary/90"
                >
                  {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gem className="h-4 w-4" />}
                  {redeemButtonLabel(item)}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onEquip}
                  disabled={isApplying || isEquipped}
                  className={cn(
                    "h-11 rounded-2xl border-rm-border bg-rm-bg-hover/70 text-rm-text transition-all duration-200 hover:bg-rm-bg-hover",
                    isEquipped && "border-primary/25 bg-primary/10 text-primary hover:bg-primary/10",
                  )}
                >
                  {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {isEquipped ? "Equipped" : "Equip now"}
                </Button>
              </div>
            </div>
          </aside>

          <div className="relative flex min-h-[360px] flex-1 flex-col overflow-hidden">
            {previewBackdrop ? (
              <img
                src={previewBackdrop}
                alt=""
                className="absolute inset-0 h-full w-full scale-[1.08] object-cover opacity-30 blur-3xl"
                loading="lazy"
                decoding="async"
              />
            ) : null}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--rm-accent-dim),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_24%),linear-gradient(180deg,rgba(7,8,12,0.12),rgba(7,8,12,0.78))]" />
            <div className="relative flex h-full flex-col p-4 sm:p-6 lg:p-8">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <span className={cn(SHOP_META_PILL_CLASS, "bg-rm-bg-floating/70")}>
                    {previewDescriptor}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-rm-border bg-rm-bg-floating/82 text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text"
                  aria-label="Close collectible preview"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              <div className="flex flex-1 items-center justify-center py-6">
                <div className={cn(SHOP_RAIL_SHELL_CLASS, "w-full max-w-[760px] bg-black/15 p-2 shadow-[0_25px_80px_rgba(0,0,0,0.28)]")}>
                  <div className={cn("relative mx-auto w-full overflow-hidden rounded-[calc(2rem-0.5rem)] border border-white/8 bg-rm-bg-floating/80", detailStageClass(previewItem))}>
                    <ShopPreview
                      item={previewItem}
                      currentDisplay={currentDisplay}
                      avatarSrc={avatarSrc}
                      displayName={displayName}
                      playAnimation
                      catalog={catalog}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold tracking-[-0.03em] text-rm-text">
                    {previewItem.id === item.id && isBundleCollectible(item) ? item.name : normalizeBaseName(previewItem.name)}
                  </p>
                  <p className="text-xs text-rm-text-muted">
                    {previewItem.id === item.id && isBundleCollectible(item)
                      ? "The full set layered together in one live preview."
                      : `${KIND_LABELS[previewItem.kind]} on your live profile preview.`}
                  </p>
                </div>
                {showBundleStrip ? (
                  <p className="text-xs text-rm-text-muted">
                    Tap the strip on the left to swap what you are previewing.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </BaseModal>
  );
}

function ShopCard({
  group,
  item,
  currentDisplay,
  avatarSrc,
  displayName,
  isEquipped,
  isApplying,
  onEquip,
  onOpenDetail,
  onSelectVariant,
  catalog = null,
}: {
  group: ShopGroup;
  item: CollectibleCatalogItem;
  currentDisplay?: AvatarDisplay | string | null;
  avatarSrc?: string;
  displayName: string;
  isEquipped: boolean;
  isApplying: boolean;
  onEquip: () => void;
  onOpenDetail: () => void;
  onSelectVariant: (itemId: string) => void;
  catalog?: CollectiblesCatalog | null;
}) {
  const sourcePrice = formatSourcePrice(item);
  const showNew = isRecentlyUpdated(item);
  const showOrbs = isOrbsExclusive(item);
  const showSwatches = group.items.length > 1;
  const [isHovered, setIsHovered] = useState(false);

  return (
    <article
      className="group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[20px] border border-rm-border bg-rm-bg-surface/95 shadow-[0_18px_60px_rgba(0,0,0,0.16)] transition-transform duration-300 hover:-translate-y-1 hover:border-primary/25 sm:rounded-[22px]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
        <div className="flex flex-wrap gap-1.5">
          {showNew && (
            <span className="rounded-full border border-rm-border bg-rm-bg-floating/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-rm-text">
              New
            </span>
          )}
          {showOrbs && (
            <span className="rounded-full border border-primary/20 bg-primary/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              Orbs only
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenDetail}
        className="flex w-full min-w-0 flex-col text-left outline-none"
        aria-label={`Open details for ${group.title}`}
      >
        <div className="h-52 shrink-0 p-3 sm:h-60">
          <ShopPreview
            item={item}
            currentDisplay={currentDisplay}
            avatarSrc={avatarSrc}
            displayName={displayName}
            playAnimation={isHovered}
            catalog={catalog}
          />
        </div>

        <div className="space-y-2 px-3.5 pt-1 sm:px-4">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-base font-semibold tracking-[-0.04em] text-rm-text sm:text-[1.05rem]">
              {group.title}
            </h3>
            <p className="mt-1 line-clamp-1 text-[11px] font-medium uppercase tracking-[0.18em] text-rm-text-muted">
              {group.categoryName}
              {variantLabel(item) ? ` / ${variantLabel(item)}` : ""}
            </p>
          </div>
        </div>
      </button>

      <div className="flex flex-1 flex-col space-y-3 px-3.5 pb-3.5 pt-3 sm:space-y-4 sm:px-4 sm:pb-4">
        <div className="min-h-5">
          {showSwatches && (
            <div className="flex flex-wrap items-center gap-2">
              {group.items.map((variant, index) => {
                const selected = variant.id === item.id;
                const swatch = paletteToSwatch(variant, index);
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => onSelectVariant(variant.id)}
                    className={cn(
                      "h-5 w-5 rounded-[6px] border-2 transition-transform duration-200",
                      selected
                        ? "scale-105 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.2)]"
                        : "border-transparent hover:scale-105"
                    )}
                    style={{ background: swatch }}
                    aria-label={variantLabel(variant) ?? variant.name}
                    title={variantLabel(variant) ?? variant.name}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {sourcePrice ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-rm-text-muted line-through">
                  {sourcePrice}
                </span>
                <span className="text-sm text-rm-text-ghost">/</span>
                <span className="text-lg font-semibold tracking-[-0.03em] text-primary">
                  Free
                </span>
              </div>
            ) : (
              <span className="text-lg font-semibold tracking-[-0.03em] text-primary">
                Free
              </span>
            )}
          </div>

          <Button
            type="button"
            onClick={onEquip}
            disabled={isApplying || isEquipped}
            className={cn(
              "h-10 w-full rounded-full px-4 text-sm font-semibold transition-all duration-200 sm:w-auto",
              isEquipped
                ? "cursor-default border-primary/25 bg-primary/10 text-primary hover:bg-primary/10"
                : "bg-primary text-primary-foreground shadow-[0_10px_30px_var(--rm-glow)] hover:-translate-y-0.5 hover:bg-primary/90"
            )}
          >
            {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : isEquipped ? "Equipped" : "Equip free"}
          </Button>
        </div>
      </div>
    </article>
  );
}

function LoadingCards() {
  return (
    <div className={SHOP_STATIC_GRID_CLASS}>
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className={cn(SHOP_PANEL_CLASS, "overflow-hidden p-3 sm:rounded-[26px] sm:p-4")}
        >
          <div className="h-52 animate-pulse rounded-[18px] bg-rm-bg-hover sm:h-60 sm:rounded-[22px]" />
          <div className="mt-3 h-5 w-2/3 animate-pulse rounded bg-rm-bg-hover sm:mt-4" />
          <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-rm-bg-hover" />
          <div className="mt-5 h-10 w-full animate-pulse rounded-full bg-rm-bg-hover" />
        </div>
      ))}
    </div>
  );
}

export default function ShopView({ onMenuClick }: ShopViewProps) {
  const chatUser = useChatStore((state) => state.user);
  const { dispatch } = useChatActions();
  const [catalog, setCatalog] = useState<CollectiblesCatalog | null>(() => getCachedCollectiblesCatalog());
  const [activePage, setActivePage] = useState<ShopPage>("featured");
  const [featuredFocus, setFeaturedFocus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(() => getCachedCollectiblesCatalog() == null);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [variantSelection, setVariantSelection] = useState<Record<string, string>>({});
  const [detailGroupKey, setDetailGroupKey] = useState<string | null>(null);
  const [detailPreviewItemId, setDetailPreviewItemId] = useState<string | null>(null);
  const featuredScrollRef = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    if (activePage === "featured") {
      featuredScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [featuredFocus, activePage]);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    const unsubscribe = subscribeCollectiblesCatalog((nextCatalog) => {
      if (!cancelled) {
        setCatalog(nextCatalog);
      }
    });

    if (!getCachedCollectiblesCatalog()) {
      setLoading(true);
    }

    loadCollectiblesCatalog()
      .then((nextCatalog) => {
        if (cancelled) return;
        setCatalog(nextCatalog);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load the shop.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const groupedItems = useMemo(() => groupCatalogItems(catalog), [catalog]);
  const featuredSections = useMemo(() => buildFeaturedSections(catalog, groupedItems), [catalog, groupedItems]);
  const spotlightCategory = useMemo(() => heroCategory(catalog), [catalog]);
  const spotlightSection = useMemo(
    () => featuredSections.find((section) => section.category.id === spotlightCategory?.id) ?? null,
    [featuredSections, spotlightCategory?.id],
  );
  const previewCategory = useMemo(() => previewCategoryForPage(catalog, activePage), [activePage, catalog]);
  const currentDisplayName = getDisplayName(chatUser, "You");
  const currentAvatarSrc = chatUser?.avatar_url ? getAuthAssetUrl(chatUser.avatar_url) : undefined;

  const pageGroups = useMemo(() => {
    const filtered = groupedItems.filter((group) => matchesQuery(group, deferredQuery));

    const isBundleGroup = (group: ShopGroup) =>
      group.items.some((item) => isBundleCollectible(item));

    return {
      all: filtered,
      frames: filtered.filter((group) => group.kind === "avatar_decoration" && !isBundleGroup(group)),
      badges: filtered.filter((group) => group.kind === "nameplate" && !isBundleGroup(group)),
      orbs: filtered.filter((group) => (group.kind === "profile_effect" || group.kind === "profile_frame") && !isBundleGroup(group)),
      misc: filtered.filter((group) => isBundleGroup(group)),
    };
  }, [deferredQuery, groupedItems]);

  const featuredResults = useMemo(() => {
    const sections = featuredSections
      .map((section) => ({
        ...section,
        groups: section.groups.filter((group) => matchesQuery(group, deferredQuery)),
      }))
      .filter((section) => section.groups.length > 0);

    if (!featuredFocus) return sections;

    const focused = sections.find((section) => section.category.name === featuredFocus);
    if (!focused) return sections;
    return [focused, ...sections.filter((section) => section.category.name !== featuredFocus)];
  }, [deferredQuery, featuredFocus, featuredSections]);
  const remainingFeaturedResults = useMemo(
    () => featuredResults.filter((section) => section.category.id !== spotlightCategory?.id),
    [featuredResults, spotlightCategory?.id],
  );
  const featuredCollectionOptions = useMemo(
    () => featuredSections.filter((section) => section.groups.length > 0),
    [featuredSections],
  );
  const detailGroup = useMemo(
    () => (detailGroupKey ? groupedItems.find((group) => group.key === detailGroupKey) ?? null : null),
    [detailGroupKey, groupedItems],
  );
  const detailItem = useMemo(() => {
    if (!detailGroup) return null;
    const selectedId = variantSelection[detailGroup.key];
    return detailGroup.items.find((candidate) => candidate.id === selectedId) ?? detailGroup.items[0] ?? null;
  }, [detailGroup, variantSelection]);
  const detailPreviewItems = useMemo(
    () => (detailItem && isBundleCollectible(detailItem) ? getBundleConstituentItems(catalog, detailItem) : []),
    [catalog, detailItem],
  );
  const detailPreviewItem = useMemo(() => {
    if (!detailItem) return null;
    if (!detailPreviewItems.length) return detailItem;
    return detailPreviewItems.find((candidate) => candidate.id === detailPreviewItemId) ?? detailPreviewItems[0] ?? detailItem;
  }, [detailItem, detailPreviewItems, detailPreviewItemId]);
  const pageItemCounts = useMemo(
    () => ({
      featured: featuredSections.reduce((count, section) => count + section.groups.length, 0),
      all: pageGroups.all.length,
      frames: pageGroups.frames.length,
      badges: pageGroups.badges.length,
      orbs: pageGroups.orbs.length,
      misc: pageGroups.misc.length,
    }),
    [featuredSections, pageGroups],
  );
  const pageSelectOptions = useMemo<SelectOption[]>(
    () => SHOP_PAGE_ORDER.map((page) => ({
      value: page,
      label: `${PAGE_COPY[page].label} (${pageItemCounts[page]})`,
    })),
    [pageItemCounts],
  );
  const featuredSelectOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: "All collections" },
      ...featuredCollectionOptions.map((section) => ({
        value: section.category.name,
        label: `${section.category.name} (${section.groups.length})`,
      })),
    ],
    [featuredCollectionOptions],
  );

  const applyCollectible = async (item: CollectibleCatalogItem) => {
    if (!chatUser) return;
    setApplyingId(item.id);
    setError(null);

    try {
      const bundleSelections = getCollectibleApplySelections(catalog, item);
      const data = await apiPatch<{ ok: true; user: ApplyResponseUser }>("/api/collectibles/apply", {
        ...(bundleSelections.length > 1
          ? { selections: bundleSelections }
          : {
              kind: item.kind,
              skuId: item.skuId,
            }),
        avatarDisplay: chatUser.avatar_display ?? null,
      });

      dispatch({
        type: "SET_USER",
        user: {
          ...chatUser,
          avatar_display: data.user.avatar_display,
          nameplate_url: data.user.nameplate_url ?? undefined,
          nameplate_content_type: data.user.nameplate_content_type ?? undefined,
          updated_at: data.user.updated_at ?? chatUser.updated_at,
        },
      });
      dispatch({
        type: "UPDATE_MEMBER_PROFILE",
        userId: chatUser.id,
        avatar_display: data.user.avatar_display,
        nameplate_url: data.user.nameplate_url,
        nameplate_content_type: data.user.nameplate_content_type,
        updated_at: data.user.updated_at ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to equip that collectible.");
    } finally {
      setApplyingId(null);
    }
  };

  const renderEmptyState = () => (
    <div className={cn(SHOP_PANEL_CLASS, "border-dashed px-6 py-12 text-center")}>
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-rm-border bg-rm-bg-hover text-rm-text-muted">
        <ShoppingBag className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-[-0.03em] text-rm-text">Nothing matched this filter.</h3>
      <p className="mt-2 text-sm text-rm-text-muted">
        Try another search or switch to a different collection rail.
      </p>
    </div>
  );

  const renderGroupCard = (group: ShopGroup) => {
    const selectedId = variantSelection[group.key];
    const activeItem = group.items.find((item) => item.id === selectedId) ?? group.items[0];
    const isEquipped = isCollectibleEquipped(chatUser?.avatar_display, catalog, activeItem);

    return (
      <ShopCard
        key={group.key}
        group={group}
        item={activeItem}
        currentDisplay={chatUser?.avatar_display}
        avatarSrc={currentAvatarSrc}
        displayName={currentDisplayName}
        isEquipped={isEquipped}
        isApplying={applyingId === activeItem.id}
        onEquip={() => applyCollectible(activeItem)}
        onOpenDetail={() => {
          setDetailGroupKey(group.key);
          setDetailPreviewItemId(null);
        }}
        onSelectVariant={(itemId) => {
          setVariantSelection((current) => ({ ...current, [group.key]: itemId }));
          if (detailGroupKey === group.key) {
            setDetailPreviewItemId(null);
          }
        }}
        catalog={catalog}
      />
    );
  };

  const renderStaticGroups = (groups: ShopGroup[]) => {
    if (!groups.length) {
      return renderEmptyState();
    }

    return (
      <div className={SHOP_STATIC_GRID_CLASS}>
        {groups.map((group) => (
          <div key={group.key} className="flex min-w-0">
            {renderGroupCard(group)}
          </div>
        ))}
      </div>
    );
  };

  const renderVirtualizedGroups = (groups: ShopGroup[], header?: ReactNode) => {
    if (!groups.length) {
      return (
        <div className="flex h-full flex-col overflow-y-auto custom-scrollbar">
          {header ? <div className="pb-2">{header}</div> : null}
          <div className="mx-auto w-full max-w-[1480px] px-3 pb-6 sm:px-5 lg:px-6">
            {renderEmptyState()}
          </div>
        </div>
      );
    }

    return (
      <VirtuosoGrid
        data={groups}
        style={{ height: "100%", width: "100%", outline: "none" }}
        context={{ header }}
        components={SHOP_GRID_COMPONENTS}
        computeItemKey={(_, group) => group.key}
        increaseViewportBy={{ top: 240, bottom: 720 }}
        overscan={{ reverse: 240, main: 720 }}
        itemContent={(_, group) => renderGroupCard(group)}
      />
    );
  };

  const activeHeading = PAGE_COPY[activePage].label;
  const catalogSummary = catalog
    ? `${catalog.items.length.toLocaleString()} items / ${catalog.categories.length.toLocaleString()} collections`
    : "Fetching the latest mirrored catalog";
  const catalogMeta = catalog ? `${catalogSummary} / Source ${catalog.source}` : "Syncing catalog";
  const ActivePageIcon = pageIcon(activePage);
  const showCollectionSelect = activePage === "featured" && featuredCollectionOptions.length > 0;
  const selectPage = (page: ShopPage) => {
    startTransition(() => {
      setActivePage(page);
      setFeaturedFocus(null);
    });
  };
  const openFeaturedCollection = (collectionName: string) => {
    startTransition(() => {
      setActivePage("featured");
      setFeaturedFocus(collectionName);
    });
  };
  const renderArchiveRail = (className?: string) => (
    <section className={className}>
      <div className={SHOP_RAIL_SHELL_CLASS}>
        <div className={SHOP_RAIL_CORE_CLASS}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--rm-accent-dim),transparent_42%)]" />
          <div className="relative flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  className="shrink-0 border-none bg-transparent p-1 text-rm-text-muted transition-colors hover:text-rm-text lg:hidden"
                  onClick={onMenuClick}
                >
                  <Menu className="h-5 w-5" />
                </button>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-primary/10 text-primary">
                  <ActivePageIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-[-0.03em] text-rm-text">
                    {activeHeading}
                  </p>
                  {featuredFocus ? (
                    <p className="truncate text-[11px] text-rm-text-muted">
                      Focused on {featuredFocus}
                    </p>
                  ) : null}
                </div>
              </div>

              <span className={cn(SHOP_META_PILL_CLASS, "max-w-full truncate")}>
                {featuredFocus ? `Focused on ${featuredFocus}` : catalogMeta}
              </span>
            </div>

            <div className="grid gap-2 md:grid-cols-12">
              <label className={cn("w-full min-w-0", showCollectionSelect ? "md:col-span-3" : "md:col-span-4")}>
                <span className={SHOP_FIELD_LABEL_CLASS}>
                  <ActivePageIcon className="h-3 w-3 text-primary/75" />
                  Category
                </span>
                <CustomSelect
                  value={activePage}
                  onChange={(value) => selectPage(value as ShopPage)}
                  options={pageSelectOptions}
                  className="w-full"
                  triggerClassName={SHOP_SELECT_TRIGGER_CLASS}
                  menuClassName={SHOP_SELECT_MENU_CLASS}
                  ariaLabel="Select collectible category"
                />
              </label>

              {showCollectionSelect ? (
                <label className="w-full min-w-0 md:col-span-3">
                  <span className={SHOP_FIELD_LABEL_CLASS}>
                    <Sparkles className="h-3 w-3 text-primary/75" />
                    Collection
                  </span>
                  <CustomSelect
                    value={featuredFocus ?? ""}
                    onChange={(value) => {
                      startTransition(() => {
                        setActivePage("featured");
                        setFeaturedFocus(value || null);
                      });
                    }}
                    options={featuredSelectOptions}
                    className="w-full"
                    triggerClassName={SHOP_SELECT_TRIGGER_CLASS}
                    menuClassName={SHOP_SELECT_MENU_CLASS}
                    ariaLabel="Select featured collection"
                  />
                </label>
              ) : null}

              <label className={cn("min-w-0", showCollectionSelect ? "md:col-span-6" : "md:col-span-8")}>
                <span className={SHOP_FIELD_LABEL_CLASS}>
                  <Search className="h-3 w-3 text-primary/75" />
                  Search
                </span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search the archive"
                    aria-label="Search the archive"
                    className={cn(SHOP_INPUT_CLASS, "pl-10 pr-4")}
                  />
                </div>
              </label>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="relative flex flex-1 overflow-hidden bg-rm-bg-primary text-rm-text">
      <div className="min-w-0 flex flex-1 flex-col overflow-hidden">
        {activePage === "featured" ? (
          <div
            ref={featuredScrollRef}
            className="min-h-0 flex-1 overflow-y-auto custom-scrollbar"
          >
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
              {renderArchiveRail()}
              {error && (
                <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {loading ? (
                <LoadingCards />
              ) : featuredFocus ? (
                (() => {
                  const focusedSection = (featuredSections || []).find((section) => section.category.name === featuredFocus)
                    || (spotlightCategory?.name === featuredFocus ? spotlightSection : null);
                  if (!focusedSection) return renderEmptyState();
                  return (
                    <div className="space-y-6">
                      <div className="flex flex-col items-start justify-between gap-3 border-b border-rm-border pb-4 sm:flex-row sm:items-center">
                        <h2 className="text-2xl font-black tracking-[-0.04em] text-rm-text sm:text-3xl">
                          {featuredFocus} Collection
                        </h2>
                        <Button
                          type="button"
                          onClick={() => setFeaturedFocus(null)}
                          variant="outline"
                          className="w-full rounded-xl border-rm-border bg-rm-bg-surface/80 px-4 py-2.5 text-sm font-semibold text-rm-text hover:bg-rm-bg-hover sm:w-auto"
                        >
                          Back to featured
                        </Button>
                      </div>
                      {renderStaticGroups(focusedSection.groups)}
                    </div>
                  );
                })()
              ) : (
                <>
                  {spotlightCategory && spotlightSection && (
                    <section className={cn(SHOP_PANEL_CLASS, "relative overflow-hidden sm:rounded-[28px]")}>
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,var(--rm-accent-dim),transparent_35%)]" />
                      {spotlightCategory.bannerUrl && (
                        <img
                          src={spotlightCategory.bannerUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover object-center"
                          loading="eager"
                          decoding="async"
                        />
                      )}
                      <div className="absolute inset-0 [background-image:var(--rm-profile-banner-overlay)]" />
                      <div className="relative flex min-h-[220px] flex-col justify-end gap-4 px-5 py-5 sm:min-h-[320px] sm:px-8 sm:py-8">
                        <Button
                          type="button"
                          onClick={() => openFeaturedCollection(spotlightCategory.name)}
                          className="w-fit rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_16px_40px_var(--rm-glow)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-primary/90 sm:absolute sm:right-8 sm:top-8"
                        >
                          Shop the collection
                        </Button>
                      </div>
                      <div className="relative px-3 pb-3 sm:px-6 sm:pb-6">
                        <div className="flex gap-3 overflow-x-auto pb-1 custom-scrollbar sm:gap-4">
                          {spotlightSection.groups.map((group) => (
                            <div key={group.key} className="w-[82vw] max-w-[260px] shrink-0 sm:w-[260px]">
                              {renderGroupCard(group)}
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}

                  {remainingFeaturedResults.length > 0 && (
                    <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
                      {remainingFeaturedResults.slice(0, 4).map((section) => (
                        <CollectionBanner
                          key={section.category.id}
                          section={section}
                          ctaLabel="Take me there"
                          onClick={() => openFeaturedCollection(section.category.name)}
                        />
                      ))}
                    </div>
                  )}

                  {remainingFeaturedResults.length > 0 ? (
                    remainingFeaturedResults.map((section) => (
                      <section key={section.category.id} className="space-y-4">
                        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                          <h3 className="text-2xl font-semibold tracking-[-0.04em] text-rm-text">
                            {section.category.name}
                          </h3>
                          <Button
                            type="button"
                            onClick={() => openFeaturedCollection(section.category.name)}
                            variant="outline"
                            className="w-full rounded-xl border-rm-border bg-rm-bg-surface/80 px-3.5 py-2 text-sm font-medium text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text sm:w-auto"
                          >
                            Take me there
                          </Button>
                        </div>
                        {renderStaticGroups(section.groups.slice(0, 4))}
                      </section>
                    ))
                  ) : (
                    renderEmptyState()
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {error && (
              <div className="mx-auto w-full max-w-[1600px] px-4 pt-5 sm:px-5 lg:px-6">
                <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex flex-1 flex-col overflow-y-auto custom-scrollbar">
                {renderArchiveRail("mx-auto w-full max-w-[1480px] px-3 pt-4 sm:px-5 lg:px-6")}
                <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-5 lg:px-6">
                  <LoadingCards />
                </div>
              </div>
            ) : (
              renderVirtualizedGroups(
                pageGroups[activePage as Exclude<ShopPage, "featured">],
                <>
                  {renderArchiveRail("mx-auto w-full max-w-[1480px] px-3 pt-4 sm:px-5 lg:px-6")}
                  {previewCategory?.bannerUrl ? (
                    <div className={cn(SHOP_PANEL_CLASS, "relative mx-3 mt-4 overflow-hidden sm:mx-4 sm:mt-5 sm:rounded-[26px]")}>
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,var(--rm-accent-dim),transparent_30%)]" />
                      <img
                        src={previewCategory.bannerUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover object-center"
                        loading="lazy"
                        decoding="async"
                      />
                      <div className="absolute inset-0 [background-image:var(--rm-profile-banner-overlay)]" />
                      <div className="relative min-h-[180px] px-5 py-5 sm:min-h-[210px] sm:px-8 sm:py-8">
                        <h3 className="max-w-2xl text-[1.9rem] font-black tracking-[-0.05em] text-rm-text sm:text-4xl">
                          {PAGE_COPY[activePage].label}
                        </h3>
                      </div>
                    </div>
                  ) : null}
                </>,
              )
            )}
          </div>
        )}
      </div>

      {detailGroup && detailItem && detailPreviewItem ? (
        <CollectibleDetailModal
          group={detailGroup}
          item={detailItem}
          previewItem={detailPreviewItem}
          previewItems={detailPreviewItems}
          currentDisplay={chatUser?.avatar_display}
          avatarSrc={currentAvatarSrc}
          displayName={currentDisplayName}
          isEquipped={isCollectibleEquipped(chatUser?.avatar_display, catalog, detailItem)}
          isApplying={applyingId === detailItem.id}
          onClose={() => {
            setDetailGroupKey(null);
            setDetailPreviewItemId(null);
          }}
          onRedeem={() => applyCollectible(detailItem)}
          onEquip={() => applyCollectible(detailItem)}
          onSelectVariant={(itemId) => {
            setVariantSelection((current) => ({ ...current, [detailGroup.key]: itemId }));
            setDetailPreviewItemId(null);
          }}
          onSelectPreviewItem={setDetailPreviewItemId}
          catalog={catalog}
        />
      ) : null}
    </div>
  );
}
