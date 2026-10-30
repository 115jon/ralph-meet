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
import { WORKBENCH_SURFACE } from "@/components/chat/settings/SettingsWorkbench";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
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
    <div className="flex h-full w-full flex-col">
      <SampleDataNote />
      <div className="flex min-h-0 w-full flex-1">
        <ShopView onMenuClick={() => {}} />
      </div>
    </div>
  );
}

/**
 * The catalog sample is a captured third-party listing: its collection art
 * and names are someone else's marks, not Ralph Meet's own collection. The
 * product reads the same upstream, and its renderers only accept that
 * upstream's asset hosts, so the art can't be swapped for authored fixture
 * art without touching product code. Label it instead, in the fixture only.
 */
function SampleDataNote() {
  return (
    <p
      role="note"
      className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-ply-1 px-4 text-ui-xs text-ink-2"
    >
      <Icon name="info" size="xs" className="shrink-0 text-ink-3" />
      <span className="font-semibold text-ink-1">Sample data</span>
      <span className="min-w-0 truncate">
        A captured third-party catalog, used to test layout. Its names and art
        belong to their owners.
      </span>
    </p>
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
        {/* Stands in for the profile editor: the same workbench shell, so the
            picker stacks on it (light scrim, the host recedes) as in the app. */}
        <DialogOverlay />
        <DialogSurface
          showCloseButton={false}
          aria-label="Edit profile"
          className={cn(WORKBENCH_SURFACE, "z-50 flex-col gap-3 p-6")}
        >
          <h2 className="text-ui-lg font-semibold text-ink-1">
            Profile editor (fixture host)
          </h2>
          <button
            type="button"
            className="w-fit rounded-md border border-line-strong px-3 py-1.5 text-ui-sm"
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
      </DialogPortal>
    </Dialog>
  );
}
