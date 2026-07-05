import { AvatarImage } from "@/components/chat/AvatarImage";
import { HomeIcon } from "@/components/chat/HomeIcon";
import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { Button } from "@/components/ui/button";
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
  syncCollectiblesCatalogClient,
} from "@/lib/collectibles-catalog-client";
import { getDisplayInitial } from "@/lib/display-name";
import { cn } from "@/lib/utils";
import type {
  CollectibleCatalogItem,
  CollectibleKind,
  CollectiblesCatalog,
} from "@/lib/collectibles-catalog";
import {
  Check,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type CollectiblesCatalogModalProps = {
  currentDisplay?: AvatarDisplay | string | null;
  avatarSrc?: string;
  displayName: string;
  initialKind?: CollectibleKind;
  onClose: () => void;
  onApplied: (user: {
    avatar_display: AvatarDisplay | null;
    nameplate_url: string | null;
    nameplate_content_type: string | null;
    updated_at: string | null;
  }) => void | Promise<void>;
};

const KIND_LABELS: Record<CollectibleKind, string> = {
  avatar_decoration: "Decorations",
  profile_effect: "Effects",
  nameplate: "Nameplates",
  profile_frame: "Frames",
};

const KIND_ORDER: CollectibleKind[] = [
  "avatar_decoration",
  "profile_effect",
  "nameplate",
  "profile_frame",
];

function formatPrice(item: CollectibleCatalogItem) {
  const price = item.price;
  if (!price) return null;
  if (price.currency === "discord_orb") {
    return `${price.amount.toLocaleString()} Orbs`;
  }
  const amount = price.amount / 10 ** price.exponent;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency.toUpperCase(),
  }).format(amount);
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

function CatalogPreview({
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
      <div className="relative flex h-full items-center justify-center overflow-hidden bg-rm-bg-primary p-2 select-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.03),_transparent_55%)]" />
        
        {/* 1. Profile Card (angled/skewed on the right) */}
        {effectItem && (
          <div 
            className="absolute top-2.5 -right-1 w-[62px] h-[100px] overflow-hidden rounded-[6px] border border-white/8 bg-[#10131a] shadow-[0_8px_24px_rgba(0,0,0,0.5)] origin-top-right rotate-[4deg]"
          >
            {/* Banner */}
            <div className="absolute left-0 right-0 top-0 h-5 bg-white/5 border-b border-white/8" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,_transparent,_rgba(17,20,27,0.96)_34%,_rgba(11,13,18,0.98))]" />
            
            {/* Avatar Placeholder */}
            <div className="absolute left-1.5 top-3.5 h-4.5 w-4.5 overflow-hidden rounded-full border border-white/10 bg-white/5 flex items-center justify-center shadow-[0_4px_8px_rgba(0,0,0,0.3)] z-10">
              <HomeIcon className="h-3 w-3 text-white/55" />
            </div>

            {/* Skeletons */}
            <div className="absolute left-1.5 top-[32px] h-1 w-6 rounded-full bg-white/20" />
            <div className="absolute left-1.5 top-[38px] h-0.5 w-8 rounded-full bg-white/10" />

            {/* Profile Effect Layer (Still frame/static version by default) */}
            {effectDisplay && (
              <ProfileCollectiblesLayer display={effectDisplay} effectOpacity={1} fit="cover" className="opacity-100" playAnimation={false} />
            )}
          </div>
        )}

        {/* 2. Avatar Decoration / Frame (top-left floating circle) */}
        <div className={cn(
          "absolute rounded-full bg-black/40 border border-white/8 flex items-center justify-center shadow-[0_6px_16px_rgba(0,0,0,0.4)]",
          effectItem ? "left-4 top-3 h-11 w-11" : "h-16 w-16"
        )}>
          <div className={cn(
            "relative rounded-full bg-white/5 flex items-center justify-center overflow-visible",
            effectItem ? "h-8.5 w-8.5" : "h-12 w-12"
          )}>
            <HomeIcon className={effectItem ? "h-4 w-4 text-white/50" : "h-6 w-6 text-white/50"} />
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

        {/* 3. Nameplate (bottom-left floating bar) */}
        {nameplateUrl && (
          <div className={cn(
            "absolute rounded-[4px] border border-white/8 overflow-hidden px-1 shadow-[0_6px_16px_rgba(0,0,0,0.4)] flex items-center gap-1 bg-[#0e1014]",
            effectItem ? "left-2.5 bottom-3.5 w-[70px] h-[20px]" : "bottom-3 w-[90px] h-[24px] gap-1.5"
          )}>
            <img
              src={nameplateUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-45"
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(0,0,0,0.55),_rgba(0,0,0,0.38)_50%,_rgba(0,0,0,0.58))]" />
            
            {/* Micro Avatar Placeholder */}
            <div className={cn(
              "relative z-10 flex shrink-0 items-center justify-center rounded-full bg-white/5 border border-white/10 overflow-hidden",
              effectItem ? "h-3.5 w-3.5" : "h-4.5 w-4.5"
            )}>
              <HomeIcon className={effectItem ? "h-2 w-2 text-white/50" : "h-2.5 w-2.5 text-white/50"} />
              <div className="absolute bottom-0 right-0 h-1 w-1 rounded-full border border-[#07080b] bg-emerald-400" />
            </div>
            
            {/* Skeleton Pill */}
            <div className={cn(
              "relative z-10 rounded-full bg-white/12 backdrop-blur-md border border-white/8",
              effectItem ? "h-1.5 w-8" : "h-2 w-10"
            )} />
          </div>
        )}
      </div>
    );
  }

  if (item.kind === "avatar_decoration") {
    return (
      <div className="flex h-full items-center justify-center bg-rm-bg-primary">
        <div className="relative h-16 w-16 rounded-full bg-primary text-primary-foreground">
          {avatarSrc ? (
            <AvatarImage
              src={avatarSrc}
              alt=""
              display={previewDisplay}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-full text-xl font-bold">
              {getDisplayInitial({ name: displayName })}
            </div>
          )}
        </div>
      </div>
    );
  }



  if (item.kind === "nameplate") {
    return (
      <div className="relative flex h-full flex-col justify-center overflow-hidden bg-rm-bg-primary p-3 font-sans select-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.02),_transparent_60%)]" />
        
        <div className="mx-auto flex w-full max-w-[240px] flex-col gap-2">
          {/* Row 1 (Skeleton) */}
          <div className="flex items-center opacity-[0.45]">
            <div className="relative h-6 w-6 shrink-0 rounded-full bg-white/10">
              <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-rm-bg-primary bg-white/20" />
            </div>
            <div className="ml-2.5 h-1.5 w-20 rounded-full bg-white/10" />
          </div>

          {/* Row 2 (Highlighted Preview Row with Nameplate) */}
          <div className="relative flex w-full h-[32px] items-center gap-2.5 rounded-[6px] border border-white/5 overflow-hidden px-2 shadow-[0_6px_16px_rgba(0,0,0,0.3)]">
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
            <div className="relative z-10 flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-white/5 border border-white/10 overflow-hidden">
              {playAnimation ? (
                avatarSrc ? (
                  <AvatarImage src={avatarSrc} alt="" display={previewDisplay} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-full text-[8px] font-bold text-white/70">
                    {getDisplayInitial({ name: displayName })}
                  </div>
                )
              ) : (
                <HomeIcon className="h-3 w-3 text-white/60" />
              )}
              {/* Badge circle */}
              <div className="absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full border border-[#07080b] bg-emerald-400" />
            </div>

            {/* Text skeleton */}
            <div className="relative z-10 h-2.5 w-20 rounded-full bg-white/12 backdrop-blur-md border border-white/8" />
          </div>

          {/* Row 3 (Skeleton) */}
          <div className="flex items-center opacity-[0.45]">
            <div className="relative h-6 w-6 shrink-0 rounded-full bg-white/10">
              <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-rm-bg-primary bg-white/20" />
            </div>
            <div className="ml-2.5 h-1.5 w-24 rounded-full bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  if (item.kind === "profile_effect" || item.kind === "profile_frame") {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden bg-rm-bg-primary p-2">
        <div
          className="relative h-full overflow-hidden rounded-lg border border-white/8 bg-[#10131a] shadow-[0_8px_24px_rgba(0,0,0,0.35)] w-[62px]"
          style={{ aspectRatio: "450 / 880" }}
        >
          {/* Mock profile background banner */}
          <div className="absolute left-0 right-0 top-0 h-5 bg-white/5 border-b border-white/8" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,_transparent,_rgba(17,20,27,0.96)_34%,_rgba(11,13,18,0.98))]" />
          
          {/* Mock small avatar placeholder with logo (no user avatar) */}
          <div className="absolute left-1.5 top-3 h-4.5 w-4.5 overflow-hidden rounded-full border border-white/10 bg-white/5 flex items-center justify-center shadow-[0_4px_8px_rgba(0,0,0,0.3)] z-10">
            <HomeIcon className="h-3 w-3 text-white/70" />
          </div>

          {/* User display name */}
          <div className="absolute left-1.5 top-[32px] h-1 w-6 rounded-full bg-white/20" />
          {/* Username */}
          <div className="absolute left-1.5 top-[38px] h-0.5 w-8 rounded-full bg-white/10" />

          {/* Divider */}
          <div className="absolute left-1.5 right-1.5 top-[44px] h-[1px] bg-white/8" />

          {/* About Me header */}
          <div className="absolute left-1.5 top-[48px] h-0.5 w-5 rounded-full bg-white/18" />
          {/* About Me body lines */}
          <div className="absolute left-1.5 top-[52px] h-0.5 w-9 rounded-full bg-white/10" />
          <div className="absolute left-1.5 top-[56px] h-0.5 w-7 rounded-full bg-white/10" />

          {/* Mock details block / activity at bottom */}
          <div className="absolute inset-x-1 bottom-1 rounded border border-white/8 bg-black/20 p-0.5">
            <div className="h-0.5 w-5 rounded-full bg-white/18" />
            <div className="mt-0.5 h-0.5 w-7 rounded-full bg-white/10" />
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
    <div className="relative h-full overflow-hidden bg-rm-bg-primary">
      {item.previewUrl && (
        <img src={item.previewUrl} alt="" className="absolute inset-0 h-full w-full object-contain p-2" loading="lazy" />
      )}
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
}

function CatalogItemCard({
  item,
  currentDisplay,
  avatarSrc,
  displayName,
  isSelected,
  price,
  applyingId,
  handleApply,
  catalog = null,
}: {
  item: CollectibleCatalogItem;
  currentDisplay?: AvatarDisplay | string | null;
  avatarSrc?: string;
  displayName: string;
  isSelected: boolean;
  price: string | null;
  applyingId: string | null;
  handleApply: (item: CollectibleCatalogItem) => void;
  catalog?: CollectiblesCatalog | null;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border bg-rm-bg-surface transition-colors",
        isSelected ? "border-primary/70" : "border-rm-border hover:border-rm-border-strong",
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="h-32 border-b border-rm-border/70">
        <CatalogPreview
          item={item}
          currentDisplay={currentDisplay}
          avatarSrc={avatarSrc}
          displayName={displayName}
          playAnimation={isHovered}
          catalog={catalog}
        />
      </div>
      <div className="space-y-3 p-3">
        <div className="min-h-[48px]">
          <div className="line-clamp-1 text-sm font-bold text-rm-text">{item.name}</div>
          <div className="line-clamp-1 text-xs text-rm-text-muted">{item.categoryName}</div>
          {price && <div className="mt-1 text-[11px] font-semibold text-rm-text-secondary">{price}</div>}
        </div>
        <Button
          type="button"
          className={cn(
            "h-8 w-full gap-1.5",
            isSelected
              ? "bg-primary/15 text-primary hover:bg-primary/20"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
          onClick={() => handleApply(item)}
          disabled={Boolean(applyingId)}
        >
          {applyingId === item.id ? (
            <Loader2 size={14} className="animate-spin" />
          ) : isSelected ? (
            <Check size={14} />
          ) : (
            <Sparkles size={14} />
          )}
          {isSelected ? "Applied" : "Apply"}
        </Button>
      </div>
    </article>
  );
}

export function CollectiblesCatalogModal({
  currentDisplay,
  avatarSrc,
  displayName,
  initialKind,
  onClose,
  onApplied,
}: CollectiblesCatalogModalProps) {
  const [catalog, setCatalog] = useState<CollectiblesCatalog | null>(() => getCachedCollectiblesCatalog());
  const [activeKind, setActiveKind] = useState<CollectibleKind>(initialKind ?? "avatar_decoration");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(() => getCachedCollectiblesCatalog() == null);
  const [refreshing, setRefreshing] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveKind(initialKind ?? "avatar_decoration");
  }, [initialKind]);

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
        if (!cancelled) setCatalog(nextCatalog);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load collectibles.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const selectedSku = selectedSkuForKind(currentDisplay, activeKind);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (catalog?.items ?? [])
      .filter((item) => item.kind === activeKind)
      .filter((item) => {
        if (!normalizedQuery) return true;
        return `${item.name} ${item.categoryName} ${item.label ?? ""}`.toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 180);
  }, [activeKind, catalog?.items, query]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const nextCatalog = await syncCollectiblesCatalogClient();
      setCatalog(nextCatalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh collectibles.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleApply = async (item: CollectibleCatalogItem | null) => {
    const id = item?.id ?? `clear:${activeKind}`;
    setApplyingId(id);
    setError(null);
    try {
      const bundleSelections = item ? getCollectibleApplySelections(catalog, item) : [];
      const data = await apiPatch<{
        ok: true;
        user: {
          avatar_display: AvatarDisplay | null;
          nameplate_url: string | null;
          nameplate_content_type: string | null;
          updated_at: string | null;
        };
      }>("/api/collectibles/apply", {
        ...(bundleSelections.length > 1
          ? { selections: bundleSelections }
          : {
              kind: item?.kind ?? activeKind,
              skuId: item?.skuId ?? null,
            }),
        avatarDisplay: currentDisplay ?? null,
      });
      await onApplied(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to apply collectible.");
    } finally {
      setApplyingId(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
      <section className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary shadow-2xl">
        <header className="flex items-center gap-3 border-b border-rm-border px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-rm-text">Collectibles Catalog</h2>
            <p className="truncate text-xs text-rm-text-muted">
              {catalog ? `${catalog.items.length.toLocaleString()} items synced from ${catalog.source}` : "Loading catalog"}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text"
            aria-label="Close collectibles catalog"
          >
            <X size={18} />
          </button>
        </header>

        <div className="border-b border-rm-border px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="flex gap-2 overflow-x-auto">
                  {KIND_ORDER.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setActiveKind(kind)}
                  className={cn(
                    "shrink-0 rounded-lg border px-3 py-2 text-xs font-bold transition-colors",
                    activeKind === kind
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-rm-border bg-rm-bg-elevated text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text",
                  )}
                >
                  {KIND_LABELS[kind]}
                  {catalog && (
                    <span className="ml-2 opacity-70">{catalog.counts[kind].toLocaleString()}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-rm-text-muted" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 border-rm-border bg-rm-bg-elevated pl-9 text-rm-text"
                placeholder="Search"
              />
            </div>
            {selectedSku && (
              <Button
                type="button"
                variant="outline"
                className="h-9 border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover"
                onClick={() => handleApply(null)}
                disabled={Boolean(applyingId)}
              >
                {applyingId === `clear:${activeKind}` ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
                Remove
              </Button>
            )}
          </div>
          {error && (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scrollbar">
          {loading ? (
            <div className="flex h-56 items-center justify-center text-rm-text-muted">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-rm-text-muted">
              No collectibles found.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredItems.map((item) => {
                const isSelected = isBundleCollectible(item)
                  ? isBundleFullyApplied(currentDisplay, catalog, item)
                  : selectedSku === item.skuId;
                const price = formatPrice(item);
                return (
                  <CatalogItemCard
                    key={item.id}
                    item={item}
                    currentDisplay={currentDisplay}
                    avatarSrc={avatarSrc}
                    displayName={displayName}
                    isSelected={isSelected}
                    price={price}
                    applyingId={applyingId}
                    handleApply={handleApply}
                    catalog={catalog}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
