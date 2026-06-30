import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import {
  getAvatarCollectibles,
  normalizeAvatarDisplay,
  type AvatarCollectibles,
  type AvatarDisplay,
} from "@/lib/avatar-display";
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

function selectedSkuForKind(display: AvatarDisplay | string | null | undefined, kind: CollectibleKind) {
  const collectibles = getAvatarCollectibles(display);
  if (kind === "avatar_decoration") return collectibles?.avatarDecoration?.skuId;
  if (kind === "profile_effect") return collectibles?.profileEffect?.skuId;
  if (kind === "nameplate") return collectibles?.nameplate?.skuId;
  return collectibles?.profileFrame?.skuId;
}

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

function itemToSelection(item: CollectibleCatalogItem): Partial<AvatarCollectibles> {
  if (item.kind === "avatar_decoration" && item.asset) {
    return {
      avatarDecoration: {
        skuId: item.skuId,
        name: item.name,
        asset: item.asset,
        imageUrl: item.staticUrl ?? item.previewUrl ?? item.animatedUrl ?? "",
      },
    };
  }

  if (item.kind === "profile_effect") {
    return {
      profileEffect: {
        skuId: item.skuId,
        name: item.name,
        previewUrl: item.previewUrl ?? undefined,
        staticUrl: item.staticUrl ?? undefined,
        animatedUrl: item.animatedUrl ?? undefined,
        effectUrls: item.profileEffect?.effects.map((effect) => effect.src) ?? [],
      },
    };
  }

  if (item.kind === "nameplate" && item.staticUrl) {
    return {
      nameplate: {
        skuId: item.skuId,
        name: item.name,
        staticUrl: item.staticUrl,
        animatedUrl: item.animatedUrl ?? undefined,
      },
    };
  }

  if (item.kind === "profile_frame" && item.frame) {
    return {
      profileFrame: {
        skuId: item.skuId,
        name: item.name,
        innerWidth: item.frame.innerWidth,
        overflowTop: item.frame.overflowTop,
        overflowBottom: item.frame.overflowBottom,
        overflowHorizontal: item.frame.overflowHorizontal,
        layers: item.frame.layers,
      },
    };
  }

  return {};
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
    Object.assign(collectibles, itemToSelection(item));
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
}: {
  item: CollectibleCatalogItem;
  currentDisplay?: AvatarDisplay | string | null;
  avatarSrc?: string;
  displayName: string;
}) {
  const previewDisplay = mergeCollectiblePreview(currentDisplay, item.kind, item);

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

  if (item.kind === "profile_frame") {
    return (
      <div className="relative h-full overflow-hidden bg-linear-to-br from-rm-bg-primary to-rm-bg-elevated">
        <ProfileCollectiblesLayer display={previewDisplay} />
        <div className="absolute left-1/2 top-1/2 z-10 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary text-primary-foreground">
          {avatarSrc ? (
            <AvatarImage src={avatarSrc} alt="" display={previewDisplay} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg font-bold">
              {getDisplayInitial({ name: displayName })}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (item.kind === "nameplate") {
    return (
      <div className="relative h-full overflow-hidden bg-rm-bg-primary">
        {item.staticUrl && (
          <img src={item.staticUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" loading="lazy" />
        )}
        <div className="absolute inset-0 bg-linear-to-r from-black/55 via-black/20 to-black/55" />
        <div className="relative z-10 flex h-full items-center gap-2 px-3">
          <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground">
            {avatarSrc ? (
              <AvatarImage src={avatarSrc} alt="" display={previewDisplay} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-bold">
                {getDisplayInitial({ name: displayName })}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-white">{displayName}</div>
            <div className="truncate text-[10px] text-white/70">{item.name}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-rm-bg-primary">
      {item.previewUrl && (
        <img src={item.previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      )}
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
}

export function CollectiblesCatalogModal({
  currentDisplay,
  avatarSrc,
  displayName,
  onClose,
  onApplied,
}: CollectiblesCatalogModalProps) {
  const [catalog, setCatalog] = useState<CollectiblesCatalog | null>(null);
  const [activeKind, setActiveKind] = useState<CollectibleKind>("avatar_decoration");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<{ catalog: CollectiblesCatalog }>("/api/collectibles/catalog")
      .then((data) => {
        if (!cancelled) setCatalog(data.catalog);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load collectibles.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
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
      const data = await apiPost<{ catalog: CollectiblesCatalog }>("/api/collectibles/sync", {});
      setCatalog(data.catalog);
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
      const data = await apiPatch<{
        ok: true;
        user: {
          avatar_display: AvatarDisplay | null;
          nameplate_url: string | null;
          nameplate_content_type: string | null;
          updated_at: string | null;
        };
      }>("/api/collectibles/apply", {
        kind: item?.kind ?? activeKind,
        skuId: item?.skuId ?? null,
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
                const isSelected = selectedSku === item.skuId;
                const price = formatPrice(item);
                return (
                  <article
                    key={item.id}
                    className={cn(
                      "overflow-hidden rounded-xl border bg-rm-bg-surface transition-colors",
                      isSelected ? "border-primary/70" : "border-rm-border hover:border-rm-border-strong",
                    )}
                  >
                    <div className="h-32 border-b border-rm-border/70">
                      <CatalogPreview item={item} currentDisplay={currentDisplay} avatarSrc={avatarSrc} displayName={displayName} />
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
                          "h-8 w-full",
                          isSelected
                            ? "bg-primary/15 text-primary hover:bg-primary/20"
                            : "bg-primary text-primary-foreground hover:bg-primary/90",
                        )}
                        onClick={() => handleApply(item)}
                        disabled={Boolean(applyingId)}
                      >
                        {applyingId === item.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : isSelected ? (
                          <Check size={15} />
                        ) : (
                          <Sparkles size={15} />
                        )}
                        {isSelected ? "Applied" : "Apply"}
                      </Button>
                    </div>
                  </article>
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
