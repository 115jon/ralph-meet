import { AvatarImage } from "@/components/chat/AvatarImage";
import { HomeIcon } from "@/components/chat/HomeIcon";
import { Menu } from "@/components/chat/Icons";
import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { apiPatch } from "@/lib/api-client";
import {
  getAvatarCollectibles,
  normalizeAvatarDisplay,
  type AvatarCollectibles,
  type AvatarDisplay,
} from "@/lib/avatar-display";
import { collectibleItemToSelection } from "@/lib/collectible-selection";
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

const PAGE_COPY: Record<ShopPage, { label: string; description: string }> = {
  featured: {
    label: "Featured",
    description: "Hand-picked drops and spotlight collections.",
  },
  all: {
    label: "Catalog",
    description: "Everything mirrored into the local archive.",
  },
  frames: {
    label: "Decorations",
    description: "Avatar treatments and profile frame pieces.",
  },
  badges: {
    label: "Nameplates",
    description: "Identity banners and plate variants.",
  },
  orbs: {
    label: "Profile FX",
    description: "Profile effects and motion-led profile frames.",
  },
  misc: {
    label: "Bundles",
    description: "Mixed collectible packs and themed sets.",
  },
};

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
          "flex flex-wrap content-start items-stretch mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-5 lg:px-6 lg:py-6", 
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
        className={cn("flex w-full p-2 md:w-1/2 xl:w-1/3 2xl:w-1/4 h-[426px]", className)}
        style={style}
      >
        {children}
      </div>
    );
  }),
  ScrollSeekPlaceholder: function ShopGridPlaceholder() {
    return (
      <div className="h-full w-full overflow-hidden rounded-[26px] border border-white/8 bg-[#181a22] p-4">
        <div className="h-60 animate-pulse rounded-[22px] bg-white/6" />
        <div className="mt-4 h-5 w-2/3 animate-pulse rounded bg-white/6" />
        <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-white/6" />
        <div className="mt-5 h-10 w-full animate-pulse rounded-full bg-white/6" />
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

function selectedSkuForKind(display: AvatarDisplay | string | null | undefined, kind: CollectibleKind) {
  const collectibles = getAvatarCollectibles(display);
  if (kind === "avatar_decoration") return collectibles?.avatarDecoration?.skuId;
  if (kind === "profile_effect") return collectibles?.profileEffect?.skuId;
  if (kind === "nameplate") return collectibles?.nameplate?.skuId;
  return collectibles?.profileFrame?.skuId;
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
    const isItemBundle = isBundle(item);
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

function isBundle(item: CollectibleCatalogItem) {
  const isNameplate = item.kind === "nameplate";
  return !isNameplate && (
    (item.productType >= 1000 && item.productType < 2000) ||
    item.name.toLowerCase().includes("bundle")
  );
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

  if (isBundle(item)) {
    const fg = item.previewAssets?.fg_static;
    const bg = item.previewAssets?.bg_static;
    if (fg || bg) {
      return (
        <div className="relative h-full w-full overflow-hidden bg-[#0e1015] flex items-center justify-center">
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

    const constituents = catalog && item.productId
      ? catalog.items.filter((c) => c.productId === item.productId || (item.productId && c.productIds?.includes(item.productId)))
      : [];

    const decoration = constituents.find((c) => c.kind === "avatar_decoration");
    const nameplate = constituents.find((c) => c.kind === "nameplate");
    const frameItem = constituents.find((c) => c.kind === "profile_frame");
    const effectItem = constituents.find((c) => c.kind === "profile_effect");

    const decorationUrl = decoration?.staticUrl ?? decoration?.previewUrl ?? decoration?.animatedUrl;
    const nameplateUrl = nameplate?.staticUrl ?? nameplate?.previewUrl;

    const frameDisplay = frameItem ? normalizeAvatarDisplay({
      version: 1,
      collectibles: {
        profileFrame: {
          skuId: frameItem.skuId,
          name: frameItem.name,
          innerWidth: frameItem.frame?.innerWidth ?? 1200,
          overflowTop: frameItem.frame?.overflowTop ?? 300,
          overflowBottom: frameItem.frame?.overflowBottom ?? 200,
          overflowHorizontal: frameItem.frame?.overflowHorizontal ?? 50,
          layers: frameItem.frame?.layers ?? [],
        },
      },
    }) : null;

    const effectDisplay = effectItem ? normalizeAvatarDisplay({
      version: 1,
      collectibles: {
        profileEffect: {
          skuId: effectItem.skuId,
          name: effectItem.name,
          staticUrl: effectItem.staticUrl,
          previewUrl: effectItem.previewUrl,
          animatedUrl: effectItem.animatedUrl,
          effectUrls: effectItem.profileEffect?.effects.map((e) => e.src) ?? [],
          effects: effectItem.profileEffect?.effects ?? [],
        },
      },
    }) : null;

    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[22px] bg-[#07080b] p-3 select-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.03),_transparent_55%)]" />
        
        {/* 1. Profile Card (angled/skewed on the right) */}
        {effectItem && (
          <div 
            className="absolute top-4 -right-2 w-[114px] h-[190px] overflow-hidden rounded-[12px] border border-white/8 bg-[#10131a] shadow-[0_16px_40px_rgba(0,0,0,0.5)] origin-top-right rotate-[4deg]"
          >
            {/* Banner */}
            <div className="absolute left-0 right-0 top-0 h-10 bg-white/5 border-b border-white/8" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,_transparent,_rgba(17,20,27,0.96)_34%,_rgba(11,13,18,0.98))]" />
            
            {/* Avatar Placeholder */}
            <div className="absolute left-2.5 top-6 h-7 w-7 overflow-hidden rounded-full border border-white/10 bg-white/5 flex items-center justify-center shadow-[0_6px_12px_rgba(0,0,0,0.3)] z-10">
              <HomeIcon className="h-4.5 w-4.5 text-white/55" />
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
          "absolute rounded-full bg-black/40 border border-white/8 flex items-center justify-center shadow-[0_12px_32px_rgba(0,0,0,0.4)]",
          effectItem ? "left-6 top-6 h-20 w-20" : "h-28 w-28"
        )}>
          <div className={cn(
            "relative rounded-full bg-white/5 flex items-center justify-center overflow-visible",
            effectItem ? "h-14 w-14" : "h-20 w-20"
          )}>
            <HomeIcon className={effectItem ? "h-7 w-7 text-white/50" : "h-10 w-10 text-white/50"} />
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
            "absolute overflow-hidden rounded-[8px] border border-white/8 bg-[#090b10] flex items-center shadow-[0_8px_24px_rgba(0,0,0,0.4)]",
            effectItem ? "left-4 bottom-5 w-[120px] h-[34px] px-2.5 gap-2" : "bottom-6 w-[160px] h-[40px] px-3 gap-2.5"
          )}>
            {/* Nameplate image background */}
            <img src={nameplateUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-85" />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(0,0,0,0.65),_rgba(0,0,0,0.38)_50%,_rgba(0,0,0,0.58))]" />
            {/* Avatar inside nameplate */}
            <div className={cn(
              "relative rounded-full bg-white/10 flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.3)] z-10 border border-white/8 shrink-0",
              effectItem ? "h-[18px] w-[18px]" : "h-[22px] w-[22px]"
            )}>
              <HomeIcon className={effectItem ? "h-2.5 w-2.5 text-white/70" : "h-3 w-3 text-white/70"} />
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
      <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[22px] bg-[#0f1117]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(130,170,255,0.28),_transparent_45%),radial-gradient(circle_at_bottom,_rgba(255,110,180,0.22),_transparent_50%)]" />
        <div className="relative h-28 w-28 rounded-full bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
          {avatarSrc ? (
            <AvatarImage src={avatarSrc} alt="" display={previewDisplay} />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-full text-3xl font-bold text-white/70">
              {getDisplayInitial({ name: displayName })}
            </div>
          )}
        </div>
      </div>
    );
  }



  if (item.kind === "nameplate") {
    return (
      <div className="relative flex h-full flex-col justify-center overflow-hidden rounded-[22px] bg-[#07080b] p-4 font-sans select-none">
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
                  <div className="flex h-full w-full items-center justify-center rounded-full text-[10px] font-bold text-white/70">
                    {getDisplayInitial({ name: displayName })}
                  </div>
                )
              ) : (
                <HomeIcon className="h-4 w-4 text-white/60" />
              )}
              {/* Badge circle */}
              <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-[#07080b] bg-emerald-400" />
            </div>

            {/* Text skeleton */}
            <div className="relative z-10 h-3 w-28 rounded-full bg-white/12 backdrop-blur-md border border-white/8" />
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
      <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[22px] bg-[#0f1117] p-3">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_45%)]" />
        <div
          className="relative h-full overflow-hidden rounded-[14px] border border-white/8 bg-[#10131a] shadow-[0_12px_36px_rgba(0,0,0,0.35)] w-[114px]"
          style={{ aspectRatio: "450 / 880" }}
        >
          {/* Mock profile background banner / skeleton */}
          <div className="absolute left-0 right-0 top-0 h-10 bg-white/5 border-b border-white/8" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,_transparent,_rgba(17,20,27,0.96)_34%,_rgba(11,13,18,0.98))]" />
          
          {/* Mock small avatar placeholder with logo (no user avatar) */}
          <div className="absolute left-2 top-6 h-7 w-7 overflow-hidden rounded-full border border-white/10 bg-white/5 flex items-center justify-center shadow-[0_6px_12px_rgba(0,0,0,0.3)] z-10">
            <HomeIcon className="h-4.5 w-4.5 text-white/70" />
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
          <div className="absolute inset-x-2 bottom-2 rounded-lg border border-white/8 bg-black/20 p-1.5">
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
    <div className="relative h-full overflow-hidden rounded-[22px] bg-[#0f1117]">
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
          <div className="flex h-full w-full items-center justify-center rounded-full text-2xl font-bold text-white/70">
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
      className="group relative w-full overflow-hidden rounded-[26px] border border-white/8 bg-[#0f1014] text-left shadow-[0_24px_70px_rgba(0,0,0,0.28)]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,_rgba(125,88,255,0.22),_transparent_34%),radial-gradient(circle_at_right,_rgba(50,190,255,0.16),_transparent_30%),linear-gradient(180deg,_#0b0d12,_#11131a)]" />
      {section.category.bannerUrl && (
        <img
          src={section.category.bannerUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.015]"
          loading="lazy"
          decoding="async"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(6,7,10,0.84)_0%,_rgba(6,7,10,0.28)_45%,_rgba(6,7,10,0.68)_100%)]" />
      <div className="relative flex min-h-44 flex-col justify-between gap-6 p-6 sm:min-h-52 sm:p-8">
        <div className="max-w-lg">
          <h3 className="text-balance text-3xl font-black tracking-[-0.05em] text-white sm:text-4xl">
            {section.category.name}
          </h3>
        </div>
        <span className="inline-flex w-fit items-center rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-[#13141a] transition-transform duration-300 group-hover:translate-x-1">
          {ctaLabel}
        </span>
      </div>
    </button>
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
      className="group relative flex h-full flex-col overflow-hidden rounded-[22px] border border-white/8 bg-[#111319] shadow-[0_18px_60px_rgba(0,0,0,0.2)] transition-transform duration-300 hover:-translate-y-1 hover:border-white/12"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
        <div className="flex flex-wrap gap-1.5">
          {showNew && (
            <span className="rounded-full border border-white/14 bg-black/35 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
              New
            </span>
          )}
          {showOrbs && (
            <span className="rounded-full border border-[#8c8cff33] bg-[#4b42ff22] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#d9d6ff]">
              Orbs Exclusive
            </span>
          )}
        </div>
      </div>

      <div className="h-60 shrink-0 p-3">
        <ShopPreview
          item={item}
          currentDisplay={currentDisplay}
          avatarSrc={avatarSrc}
          displayName={displayName}
          playAnimation={isHovered}
          catalog={catalog}
        />
      </div>

      <div className="flex flex-1 flex-col space-y-4 px-4 pb-4 pt-1">
        <div className="space-y-2">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-[1.05rem] font-semibold tracking-[-0.04em] text-white">
              {group.title}
            </h3>
            <p className="mt-1 line-clamp-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
              {group.categoryName} {variantLabel(item) ? `• ${variantLabel(item)}` : ""}
            </p>
          </div>
        </div>

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

        <div className="mt-auto flex items-end justify-between gap-3">
          <div>
            {sourcePrice ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white/38 line-through decoration-white/25">
                  {sourcePrice}
                </span>
                <span className="text-sm text-white/25">/</span>
                <span className="text-lg font-semibold tracking-[-0.03em] text-[#9ef0b4]">
                  Free
                </span>
              </div>
            ) : (
              <span className="text-lg font-semibold tracking-[-0.03em] text-[#9ef0b4]">
                Free
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onEquip}
            disabled={isApplying || isEquipped}
            className={cn(
              "inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold transition-all duration-200",
              isEquipped
                ? "cursor-default border border-emerald-400/20 bg-emerald-400/12 text-emerald-200"
                : "bg-white text-[#11131a] hover:translate-y-[-1px] hover:bg-[#f4f5f7] disabled:opacity-60"
            )}
          >
            {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : isEquipped ? "Equipped" : "Equip free"}
          </button>
        </div>
      </div>
    </article>
  );
}

function LoadingCards() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-[26px] border border-white/8 bg-[#181a22] p-4"
        >
          <div className="h-60 animate-pulse rounded-[22px] bg-white/6" />
          <div className="mt-4 h-5 w-2/3 animate-pulse rounded bg-white/6" />
          <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-white/6" />
          <div className="mt-5 h-10 w-full animate-pulse rounded-full bg-white/6" />
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
      group.items.some((item) => isBundle(item));

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
  const sidebarCollections = useMemo(
    () => featuredSections.filter((section) => section.groups.length > 0).slice(0, 6),
    [featuredSections],
  );
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

  const applyCollectible = async (item: CollectibleCatalogItem) => {
    if (!chatUser) return;
    setApplyingId(item.id);
    setError(null);

    try {
      const data = await apiPatch<{ ok: true; user: ApplyResponseUser }>("/api/collectibles/apply", {
        kind: item.kind,
        skuId: item.skuId,
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
    <div className="rounded-[28px] border border-dashed border-white/10 bg-[#181a22] px-6 py-12 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/55">
        <ShoppingBag className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-[-0.03em] text-white">Nothing matched that filter.</h3>
      <p className="mt-2 text-sm text-white/55">
        Try another search or switch to a different shop rail.
      </p>
    </div>
  );

  const renderGroupCard = (group: ShopGroup) => {
    const selectedId = variantSelection[group.key];
    const activeItem = group.items.find((item) => item.id === selectedId) ?? group.items[0];
    const isEquipped = selectedSkuForKind(chatUser?.avatar_display, activeItem.kind) === activeItem.skuId;

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
        onSelectVariant={(itemId) => {
          setVariantSelection((current) => ({ ...current, [group.key]: itemId }));
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {groups.map((group) => (
          <div key={group.key} className="flex">
            {renderGroupCard(group)}
          </div>
        ))}
      </div>
    );
  };

  const renderVirtualizedGroups = (groups: ShopGroup[], header?: ReactNode) => {
    if (!groups.length) {
      return renderEmptyState();
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

  const activeHeading = featuredFocus
    ? `${featuredFocus} Collection`
    : PAGE_COPY[activePage].label;
  const activeDescription = featuredFocus
    ? "A closer look at one collection with live profile previews."
    : PAGE_COPY[activePage].description;
  const catalogSummary = catalog
    ? `${catalog.items.length.toLocaleString()} items across ${catalog.categories.length.toLocaleString()} collections`
    : "Fetching the latest mirrored catalog";
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

  return (
    <div className="relative flex flex-1 overflow-hidden bg-[#06070a] text-white">
      <aside className="hidden w-[272px] shrink-0 border-r border-white/8 bg-[#090a0e] lg:flex lg:flex-col">
        <div className="border-b border-white/8 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,_rgba(255,255,255,0.10),_rgba(255,255,255,0.03))] shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/38">Shop Archives</p>
              <h2 className="truncate text-lg font-black tracking-[-0.04em] text-white">Collectibles</h2>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-white/55">
            A Yapper-style browse rail with live local previews and cached catalog data.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
          <nav className="space-y-1.5">
            {SHOP_PAGE_ORDER.map((page) => {
              const Icon = pageIcon(page);
              const active = activePage === page;
              return (
                <button
                  key={page}
                  type="button"
                  onClick={() => selectPage(page)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition-colors",
                    active
                      ? "border-white/10 bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]"
                      : "border-transparent bg-transparent text-white/58 hover:border-white/8 hover:bg-white/[0.03] hover:text-white",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-white">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{PAGE_COPY[page].label}</p>
                      <p className="truncate text-xs text-white/40">{PAGE_COPY[page].description}</p>
                    </div>
                  </div>
                  <span className="rounded-full border border-white/8 px-2 py-0.5 text-[11px] font-semibold text-white/48">
                    {pageItemCounts[page]}
                  </span>
                </button>
              );
            })}
          </nav>

          {sidebarCollections.length > 0 ? (
            <div className="mt-8 space-y-3">
              <div className="flex items-center justify-between px-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/32">
                  Collections
                </p>
                <span className="text-[11px] text-white/28">{sidebarCollections.length} surfaced</span>
              </div>
              <div className="space-y-1.5">
                {sidebarCollections.map((section) => (
                  <button
                    key={section.category.id}
                    type="button"
                    onClick={() => openFeaturedCollection(section.category.name)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm transition-colors",
                      featuredFocus === section.category.name
                        ? "bg-white/[0.08] text-white"
                        : "text-white/54 hover:bg-white/[0.03] hover:text-white",
                    )}
                  >
                    <span className="truncate">{section.category.name}</span>
                    <span className="text-[11px] text-white/32">{section.groups.length}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="border-t border-white/8 px-5 py-4">
          <p className="text-sm font-medium text-white">{catalogSummary}</p>
          <p className="mt-1 text-xs text-white/42">
            {catalog ? `Source: ${catalog.source}` : "Waiting for catalog"}
          </p>
        </div>
      </aside>

      <div className="min-w-0 flex flex-1 flex-col overflow-hidden">
        <header className="relative z-40 shrink-0 border-b border-white/8 bg-[#090a0e]/95 backdrop-blur-xl">
          <div className="px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <button
                  className="mt-1 cursor-pointer border-none bg-transparent p-1 text-white/65 transition-colors hover:text-white lg:hidden"
                  onClick={onMenuClick}
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/34">
                    Featured | Shop Archives
                  </p>
                  <h1 className="truncate text-2xl font-black tracking-[-0.05em] text-white sm:text-3xl">
                    {activeHeading}
                  </h1>
                  <p className="mt-1 max-w-3xl text-sm text-white/54 sm:text-[15px]">
                    {activeDescription}
                  </p>
                </div>
              </div>

              <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[360px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/38" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search the archive"
                    className="h-11 w-full rounded-2xl border border-white/8 bg-white/[0.04] pl-10 pr-4 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-white/16 focus:bg-white/[0.06]"
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-white/38">
                  <span>{catalogSummary}</span>
                  <span>{catalog ? `Source ${catalog.source}` : "Syncing"}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden custom-scrollbar">
              {SHOP_PAGE_ORDER.map((page) => {
                const Icon = pageIcon(page);
                const active = activePage === page;
                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => selectPage(page)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-white/10 bg-white/[0.1] text-white"
                        : "border-white/8 bg-transparent text-white/58 hover:bg-white/[0.05] hover:text-white",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{PAGE_COPY[page].label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {activePage === "featured" ? (
          <div
            ref={featuredScrollRef}
            className="min-h-0 flex-1 overflow-y-auto custom-scrollbar"
          >
            <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-6 px-4 py-5 sm:px-5 lg:px-6 lg:py-6">
              {error && (
                <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
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
                      <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
                        <h2 className="text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl">
                          {featuredFocus} Collection
                        </h2>
                        <button
                          type="button"
                          onClick={() => setFeaturedFocus(null)}
                          className="rounded-xl border border-white/8 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.07] cursor-pointer"
                        >
                          Back to Featured
                        </button>
                      </div>
                      {renderStaticGroups(focusedSection.groups)}
                    </div>
                  );
                })()
              ) : (
                <>
                  {spotlightCategory && spotlightSection && (
                    <section className="relative overflow-hidden rounded-[28px] border border-white/8 bg-[#0d0f15] shadow-[0_32px_120px_rgba(0,0,0,0.35)]">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,_rgba(110,74,255,0.35),_transparent_35%),radial-gradient(circle_at_center,_rgba(255,54,160,0.12),_transparent_28%),linear-gradient(180deg,_#0b0d12,_#11131a)]" />
                      {spotlightCategory.bannerUrl && (
                        <img
                          src={spotlightCategory.bannerUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover object-center"
                          loading="eager"
                          decoding="async"
                        />
                      )}
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(6,7,10,0.06),_rgba(6,7,10,0.58)_65%,_rgba(6,7,10,0.94)_100%)]" />
                      <div className="relative min-h-[260px] px-6 pt-6 sm:min-h-[320px] sm:px-8 sm:pt-8">
                        <button
                          type="button"
                          onClick={() => openFeaturedCollection(spotlightCategory.name)}
                          className="absolute right-6 top-6 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-[#12141c] shadow-[0_16px_40px_rgba(0,0,0,0.18)] transition-transform duration-200 hover:-translate-y-0.5 sm:right-8 sm:top-8"
                        >
                          Shop the Collection
                        </button>
                      </div>
                      <div className="relative px-4 pb-4 sm:px-6 sm:pb-6">
                        <div className="flex gap-4 overflow-x-auto pb-1 custom-scrollbar">
                          {spotlightSection.groups.map((group) => (
                            <div key={group.key} className="w-[240px] shrink-0 sm:w-[260px]">
                              {renderGroupCard(group)}
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}

                  {remainingFeaturedResults.length > 0 && (
                    <div className="grid gap-5 xl:grid-cols-2">
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
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-2xl font-semibold tracking-[-0.04em] text-white">
                            {section.category.name}
                          </h3>
                          <button
                            type="button"
                            onClick={() => openFeaturedCollection(section.category.name)}
                            className="rounded-xl border border-white/8 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white/72 transition-colors hover:bg-white/[0.07] hover:text-white"
                          >
                            Take me there
                          </button>
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
              <div className="mx-auto w-full max-w-[1520px] px-4 pt-5 sm:px-5 lg:px-6">
                <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              </div>
            )}

            {loading ? (
              <div className="mx-auto flex-1 w-full max-w-[1520px] overflow-y-auto px-4 py-5 sm:px-5 lg:px-6">
                <LoadingCards />
              </div>
            ) : (
              renderVirtualizedGroups(
                pageGroups[activePage as Exclude<ShopPage, "featured">],
                previewCategory?.bannerUrl ? (
                  <div className="relative mx-4 mt-5 overflow-hidden rounded-[26px] border border-white/8 bg-[#0f1014] shadow-[0_22px_80px_rgba(0,0,0,0.28)]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,_rgba(120,92,255,0.18),_transparent_30%),linear-gradient(180deg,_#0a0c11,_#101219)]" />
                    <img
                      src={previewCategory.bannerUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover object-center"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(8,10,16,0.82),_rgba(8,10,16,0.24)_50%,_rgba(8,10,16,0.7))]" />
                    <div className="relative min-h-[210px] px-6 py-6 sm:px-8 sm:py-8">
                      <h3 className="max-w-2xl text-3xl font-black tracking-[-0.05em] text-white sm:text-4xl">
                        {activePage === "misc" ? "Miscellaneous" : previewCategory.name}
                      </h3>
                    </div>
                  </div>
                ) : undefined,
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
