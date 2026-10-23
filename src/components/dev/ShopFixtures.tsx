/**
 * Dev-only shop and collectible-picker fixtures (mounted by UiFixtures).
 * Seeds the catalog client cache with a trimmed real yapper payload so the
 * real components render without a session or network.
 *
 *   /ui-fixtures?surface=shop
 *   /ui-fixtures?surface=catalog-decorations | catalog-effects
 *                       | catalog-nameplates | catalog-frames
 *
 * Catalog surfaces open the picker on top of a modal Dialog, the way the
 * profile editor does, so touch scrolling is tested under a parent scroll lock.
 */

import { CollectiblePicker } from "@/components/chat/collectibles/CollectiblePicker";
import ShopView from "@/components/chat/ShopView";
import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import type { AvatarDisplay } from "@/lib/avatar-display";
import { primeCollectiblesCatalogCache } from "@/lib/collectibles-catalog-client";
import {
  normalizeYapperCatalog,
  type CollectibleKind,
} from "@/lib/collectibles-catalog";
import sample from "@/lib/__fixtures__/yapper-catalog.sample.json";
import { useChatStore } from "@/stores/chat-store";
import { useEffect, useState } from "react";

const FIXTURE_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#22c3a6"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/><circle cx="64" cy="50" r="22" fill="#fff" fill-opacity=".9"/><path d="M22 118c6-26 24-38 42-38s36 12 42 38" fill="#fff" fill-opacity=".9"/></svg>`,
  );

let seeded = false;

function seedFixtureCatalog() {
  if (seeded) return;
  seeded = true;
  const catalog = normalizeYapperCatalog(sample, new Date().toISOString());
  primeCollectiblesCatalogCache(catalog);
}

const CATALOG_FIXTURE_KINDS: Record<string, CollectibleKind> = {
  "catalog-decorations": "avatar_decoration",
  "catalog-effects": "profile_effect",
  "catalog-nameplates": "nameplate",
  "catalog-frames": "profile_frame",
};

export function ShopFixture() {
  seedFixtureCatalog();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const user = useChatStore.getState().user;
    if (user) {
      useChatStore.setState({ user: { ...user, avatar_url: FIXTURE_AVATAR } });
    }
    const id = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(id);
  }, []);
  if (!ready) return null;
  return (
    <div className="flex h-full w-full">
      <ShopView onMenuClick={() => {}} />
    </div>
  );
}

export function CatalogFixture({ surface }: { surface: string }) {
  const kind: CollectibleKind =
    CATALOG_FIXTURE_KINDS[surface] ?? "avatar_decoration";
  seedFixtureCatalog();
  const [display, setDisplay] = useState<AvatarDisplay | null>(null);
  const [open, setOpen] = useState(true);
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/56 p-4">
          <DialogSurface
            showCloseButton={false}
            aria-label="Edit profile"
            className="relative flex h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-3xl border border-rm-border bg-rm-bg-primary p-6"
          >
            <h2 className="text-ui-lg font-semibold text-rm-text">
              Profile editor (fixture host)
            </h2>
            <button
              type="button"
              className="w-fit rounded-lg border border-rm-border px-3 py-2 text-ui-sm"
              onClick={() => setOpen(true)}
            >
              Open picker
            </button>
            {open && (
              <CollectiblePicker
                open
                kind={kind}
                username="@jon"
                currentDisplay={display}
                avatarSrc={FIXTURE_AVATAR}
                displayName="Jon"
                onClose={() => setOpen(false)}
                onApplied={(user) => setDisplay(user.avatar_display)}
              />
            )}
          </DialogSurface>
        </div>
      </DialogPortal>
    </Dialog>
  );
}
