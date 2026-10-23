/**
 * Purpose-built picker for one collectible slot (decoration, effect,
 * nameplate or frame), opened from the profile editor.
 *
 * It is a nested Dialog, not a body portal: the old catalog sat outside the
 * editor's modal Dialog, so it was aria-hidden, Escape went to the editor and
 * the editor's focus trap pulled focus out of its search field. As the topmost
 * layer it owns scroll lock, focus, Escape and the back button.
 *
 * Phones: full screen, header, sticky preview band, one scrolling list,
 * Apply in a bottom bar above the home indicator. md+: preview pane on the
 * left, list on the right.
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import type { AvatarDisplay } from "@/lib/avatar-display";
import {
  applyCollectible,
  type CollectibleApplyUser,
} from "@/lib/collectible-apply-client";
import {
  buildCollectionSections,
  collectionStatus,
  countSectionItems,
  findItemBySku,
  KIND_COPY,
} from "@/lib/collectible-catalog-view";
import {
  displayWithCollectible,
  selectedSkuForKind,
} from "@/lib/collectible-selection";
import type {
  CollectibleCatalogItem,
  CollectibleKind,
} from "@/lib/collectibles-catalog";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  CollectibleListbox,
  NONE_OPTION_ID,
  type OptionVisualState,
} from "./CollectibleListbox";
import {
  CollectibleStage,
  DecorationAvatar,
  EffectThumb,
  FrameThumb,
  NameplateRow,
  type PreviewIdentity,
} from "./CollectiblePreviews";
import { useCollectiblesCatalog } from "./hooks";

export type CollectiblePickerProps = {
  open: boolean;
  kind: CollectibleKind;
  currentDisplay?: AvatarDisplay | string | null;
  avatarSrc?: string;
  displayName: string;
  username?: string;
  onClose: () => void;
  onApplied: (
    user: CollectibleApplyUser,
    appliedKinds: CollectibleKind[],
  ) => void | Promise<void>;
};

const GRID_CLASS: Record<CollectibleKind, string> = {
  avatar_decoration:
    "grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-x-1.5 gap-y-2",
  profile_effect:
    "grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-x-1.5 gap-y-2",
  nameplate: "grid grid-cols-1 gap-2 md:grid-cols-2",
  profile_frame:
    "grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-3 gap-y-4",
};

function SelectionMarks({
  selected,
  equipped,
}: Pick<OptionVisualState, "selected" | "equipped">) {
  return (
    <>
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute end-1.5 top-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-rm-accent-solid text-rm-on-accent shadow-(--rm-shadow-1)"
        >
          <Icon name="check" size="xs" />
        </span>
      ) : null}
      {equipped ? (
        <span className="absolute start-1.5 top-1.5 z-10 rounded-full bg-rm-bg-floating/90 px-1.5 py-0.5 text-ui-2xs font-semibold text-rm-text-secondary shadow-(--rm-shadow-1)">
          Equipped
        </span>
      ) : null}
    </>
  );
}

function tileFrameClass(selected: boolean) {
  return cn(
    "relative flex h-full flex-col rounded-xl p-1.5 transition-colors duration-150",
    selected
      ? "bg-rm-accent-tint ring-2 ring-rm-accent ring-inset"
      : "pointer-fine:group-hover/option:bg-rm-tint-1",
  );
}

function TileCaption({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1.5 line-clamp-2 px-0.5 text-center text-ui-xs leading-snug text-rm-text-secondary">
      {children}
    </span>
  );
}

function NoneGlyph() {
  return (
    <span className="absolute inset-0 flex items-center justify-center text-rm-text-muted">
      <Icon name="close" size="lg" />
    </span>
  );
}

function useRenderOption(
  kind: CollectibleKind,
  identity: PreviewIdentity,
  noneLabel: string,
) {
  return useCallback(
    (item: CollectibleCatalogItem | null, state: OptionVisualState) => {
      const caption = item ? item.name : noneLabel;
      if (kind === "avatar_decoration") {
        return (
          <span className={tileFrameClass(state.selected)}>
            <SelectionMarks {...state} />
            <span className="mx-auto w-full max-w-[76px] p-[12%]">
              <DecorationAvatar
                item={item}
                identity={identity}
                animate={state.active || (state.selected && state.visible)}
              />
            </span>
            <TileCaption>{caption}</TileCaption>
          </span>
        );
      }
      if (kind === "profile_effect") {
        return (
          <span className={tileFrameClass(state.selected)}>
            <SelectionMarks {...state} />
            <span className="relative">
              <EffectThumb item={item} />
              {item ? null : <NoneGlyph />}
            </span>
            <TileCaption>{caption}</TileCaption>
          </span>
        );
      }
      if (kind === "profile_frame") {
        return (
          <span className={tileFrameClass(state.selected)}>
            <SelectionMarks {...state} />
            <span className="relative px-[10%] pt-[14%] pb-[8%]">
              <FrameThumb item={item} identity={identity} />
            </span>
            <TileCaption>{caption}</TileCaption>
          </span>
        );
      }
      return (
        <span
          className={cn(
            "relative flex min-h-[72px] flex-col gap-1.5 rounded-xl p-1.5 transition-colors duration-150",
            state.selected
              ? "bg-rm-accent-tint ring-2 ring-rm-accent ring-inset"
              : "pointer-fine:group-hover/option:bg-rm-tint-1",
          )}
        >
          <NameplateRow
            item={item}
            identity={identity}
            animate={state.active || (state.selected && state.visible)}
          />
          <span className="flex items-center gap-2 px-1 text-ui-xs text-rm-text-secondary">
            <span className="min-w-0 truncate">{caption}</span>
            {state.equipped ? (
              <span className="ms-auto shrink-0 font-semibold text-rm-text-muted">
                Equipped
              </span>
            ) : null}
            {state.selected ? (
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full bg-rm-accent-solid text-rm-on-accent",
                  !state.equipped && "ms-auto",
                )}
              >
                <Icon name="check" size="xs" />
              </span>
            ) : null}
          </span>
        </span>
      );
    },
    [identity, kind, noneLabel],
  );
}

export function CollectiblePicker({
  open,
  kind,
  currentDisplay,
  avatarSrc,
  displayName,
  username,
  onClose,
  onApplied,
}: CollectiblePickerProps) {
  const { catalog, error: loadError, loading } = useCollectiblesCatalog();
  const copy = KIND_COPY[kind];
  const searchId = useId();
  const sectionIdPrefix = `${useId()}-section-`;
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const equippedSku = selectedSkuForKind(currentDisplay, kind) ?? null;
  const equippedItem = findItemBySku(catalog, kind, equippedSku);
  const equippedId = equippedItem?.id ?? null;
  const selectedId = draftId ?? equippedId ?? NONE_OPTION_ID;

  const sections = useMemo(
    () =>
      buildCollectionSections(catalog, { kinds: [kind], query: deferredQuery }),
    [catalog, deferredQuery, kind],
  );
  const allSections = useMemo(
    () => buildCollectionSections(catalog, { kinds: [kind] }),
    [catalog, kind],
  );
  const resultCount = countSectionItems(sections);

  const previewItem =
    selectedId === NONE_OPTION_ID
      ? null
      : (catalog?.items.find((item) => item.id === selectedId) ?? equippedItem);
  const previewDisplay = useMemo(
    () => displayWithCollectible(currentDisplay, kind, previewItem),
    [currentDisplay, kind, previewItem],
  );
  const identity = useMemo<PreviewIdentity>(
    () => ({ avatarSrc, displayName, username, display: currentDisplay }),
    [avatarSrc, currentDisplay, displayName, username],
  );
  const renderOption = useRenderOption(kind, identity, copy.noneLabel);

  const changed = selectedId !== (equippedId ?? NONE_OPTION_ID);
  const previewCategory = previewItem
    ? catalog?.categories.find(
        (category) => category.id === previewItem.categoryId,
      )
    : null;
  const previewStatus = previewCategory
    ? collectionStatus(previewCategory)
    : null;

  const handleChoose = useCallback((item: CollectibleCatalogItem | null) => {
    setApplyError(null);
    setDraftId(item ? item.id : NONE_OPTION_ID);
  }, []);

  const handleApply = async () => {
    if (!changed || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      const result = await applyCollectible({
        catalog,
        kind,
        item: previewItem,
        currentDisplay,
      });
      await onApplied(result.user, result.appliedKinds);
      onClose();
    } catch (err) {
      setApplyError(
        err instanceof Error ? err.message : "Couldn't apply that. Try again.",
      );
    } finally {
      setApplying(false);
    }
  };

  const jumpTo = (categoryId: string) => {
    document
      .getElementById(`${sectionIdPrefix}${categoryId}`)
      ?.scrollIntoView({ block: "start" });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <DialogOverlay className="z-70 max-md:hidden" />
        <DialogSurface
          showCloseButton={false}
          ref={surfaceRef}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            // Land on the surface, not the first button: no stray focus ring
            // and no keyboard popping up on phones. Tab goes to Back/Search.
            event.preventDefault();
            surfaceRef.current?.focus({ preventScroll: true });
          }}
          className={cn(
            "fixed inset-0 z-70 grid overflow-hidden bg-rm-bg-primary outline-none",
            "grid-rows-[auto_auto_minmax(0,1fr)_auto] [grid-template-areas:'header'_'preview'_'list'_'footer']",
            "md:inset-auto md:top-1/2 md:left-1/2 md:h-[min(760px,calc(100dvh-48px))] md:w-[min(1080px,calc(100vw-48px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:border-rm-border md:shadow-(--rm-shadow-3)",
            "md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)_auto] md:[grid-template-areas:'preview_header'_'preview_list'_'footer_list']",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 max-md:data-[state=open]:slide-in-from-bottom-6 md:data-[state=open]:zoom-in-[0.97]",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 max-md:data-[state=closed]:slide-out-to-bottom-6 md:data-[state=closed]:zoom-out-[0.97]",
            "motion-reduce:slide-in-from-bottom-0 motion-reduce:slide-out-to-bottom-0 motion-reduce:zoom-in-100 motion-reduce:zoom-out-100",
          )}
        >
          {/* Header */}
          <header className="flex items-center gap-2 border-b border-rm-border px-2 pt-[calc(var(--safe-area-top,env(safe-area-inset-top,0px))+0.5rem)] pb-2 [grid-area:header] md:px-5 md:pt-4 md:pb-3">
            <IconButton
              icon="back"
              aria-label="Back to profile"
              variant="ghost"
              size="md"
              onClick={onClose}
              className="md:hidden"
            />
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-ui-lg">
                {copy.pickerTitle}
              </DialogTitle>
              <DialogDescription className="truncate text-ui-xs">
                {catalog
                  ? `${(allSections.length ? countSectionItems(allSections) : 0).toLocaleString()} to choose from`
                  : "Loading the catalog"}
              </DialogDescription>
            </div>
            <IconButton
              icon="close"
              aria-label="Close"
              variant="ghost"
              size="md"
              onClick={onClose}
              className="max-md:hidden"
            />
          </header>

          {/* Preview */}
          <aside
            aria-label="Preview"
            className="flex items-center gap-4 border-b border-rm-border bg-rm-bg-secondary px-4 py-3 [grid-area:preview] md:flex-col md:justify-center md:gap-6 md:border-e md:border-b-0 md:px-6 md:py-8"
          >
            <div className="flex shrink-0 items-center justify-center md:min-h-0 md:w-full md:flex-1">
              <CollectibleStage
                kind={kind}
                identity={identity}
                item={previewItem}
                display={previewDisplay}
              />
            </div>
            <div
              className={cn(
                "min-w-0 flex-1 md:w-full md:flex-none md:text-center",
                kind === "nameplate" && "max-md:hidden",
              )}
              aria-live="polite"
            >
              <p className="truncate text-ui-md font-semibold text-rm-text">
                {previewItem ? previewItem.name : copy.noneLabel}
              </p>
              <p className="truncate text-ui-xs text-rm-text-muted">
                {previewItem
                  ? previewItem.categoryName
                  : "Your profile without one"}
              </p>
              {previewStatus ? (
                <p className="mt-1 text-ui-2xs font-semibold text-rm-warning-ink">
                  {previewStatus.label}
                </p>
              ) : null}
            </div>
          </aside>

          {/* List */}
          <div className="min-h-0 overflow-y-auto overscroll-contain [grid-area:list] [touch-action:pan-y] [scroll-padding-top:7rem]">
            <div className="sticky top-0 z-20 flex flex-col gap-2 border-b border-rm-border bg-rm-bg-primary/95 px-3 py-2.5 md:px-5">
              <label htmlFor={searchId} className="sr-only">
                Search {copy.many.toLowerCase()}
              </label>
              <div className="relative">
                <Icon
                  name="search"
                  size="sm"
                  className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-rm-text-muted"
                />
                <input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${copy.many.toLowerCase()}`}
                  enterKeyHint="search"
                  autoComplete="off"
                  className="h-11 w-full rounded-lg border border-rm-field-edge bg-rm-bg-surface ps-9 pe-3 text-ui-md text-rm-text outline-none placeholder:text-rm-text-muted focus-visible:border-rm-focus md:h-9 md:text-ui-sm"
                />
              </div>
              {!deferredQuery && allSections.length > 1 ? (
                <nav
                  aria-label="Collections"
                  className="-mx-3 flex snap-x gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] [touch-action:pan-x] md:-mx-5 md:px-5"
                >
                  {allSections.map((section) => (
                    <button
                      key={section.category.id}
                      type="button"
                      onClick={() => jumpTo(section.category.id)}
                      className="h-8 shrink-0 snap-start rounded-full bg-rm-tint-1 px-3 text-ui-xs font-medium whitespace-nowrap text-rm-text-secondary transition-colors duration-150 pointer-fine:hover:bg-rm-tint-2 pointer-fine:hover:text-rm-text focus-visible:ring-2 focus-visible:ring-rm-focus focus-visible:outline-none max-md:h-9"
                    >
                      {section.category.name}
                    </button>
                  ))}
                </nav>
              ) : null}
              <p className="sr-only" role="status">
                {deferredQuery
                  ? `${resultCount} ${resultCount === 1 ? "result" : "results"}`
                  : ""}
              </p>
            </div>

            <div className="px-3 pt-3 pb-6 md:px-5">
              {loading ? (
                <div className={GRID_CLASS[kind]} aria-hidden="true">
                  {Array.from({ length: 12 }, (_, index) => (
                    <span
                      key={index}
                      className={cn(
                        "animate-pulse rounded-xl bg-rm-tint-1",
                        kind === "nameplate" ? "h-[72px]" : "aspect-[3/4]",
                      )}
                    />
                  ))}
                </div>
              ) : !catalog ? (
                <p className="py-12 text-center text-ui-sm text-rm-text-muted">
                  {loadError ?? "Couldn't load collectibles."}
                </p>
              ) : (
                <CollectibleListbox
                  label={copy.many}
                  sections={sections}
                  noneLabel={deferredQuery ? undefined : copy.noneLabel}
                  selectedId={selectedId}
                  equippedId={equippedId}
                  onChoose={handleChoose}
                  renderOption={renderOption}
                  gridClassName={GRID_CLASS[kind]}
                  sectionIdPrefix={sectionIdPrefix}
                  emptyState={
                    <p className="py-12 text-center text-ui-sm text-rm-text-muted">
                      Nothing matches “{deferredQuery}”.
                    </p>
                  }
                />
              )}
            </div>
          </div>

          {/* Footer */}
          <footer className="flex items-center gap-2 border-t border-rm-border bg-rm-bg-primary px-3 pt-3 pb-[calc(var(--safe-area-bottom,env(safe-area-inset-bottom,0px))+0.75rem)] [grid-area:footer] md:border-e md:bg-rm-bg-secondary md:px-6 md:pb-6">
            {applyError ? (
              <p
                role="alert"
                className="me-auto min-w-0 text-ui-xs text-rm-danger-ink"
              >
                {applyError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className={cn(
                "h-11 px-4 md:h-9",
                !applyError && "me-auto md:me-0 md:flex-1",
              )}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={!changed || applying}
              aria-busy={applying || undefined}
              className="h-11 flex-1 px-5 md:h-9"
            >
              {applying ? (
                <Icon name="loader" size="sm" className="animate-spin" />
              ) : null}
              {selectedId === NONE_OPTION_ID && changed ? "Remove" : "Apply"}
            </Button>
          </footer>
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}
