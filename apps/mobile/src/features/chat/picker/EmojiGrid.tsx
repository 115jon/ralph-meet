import {
  ClockCounterClockwise,
  Flag,
  GameController,
  GlobeHemisphereWest,
  Hamburger,
  Heart,
  Leaf,
  Lightbulb,
  Smiley,
  Sparkle,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  View,
  type FlatList as RNFlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { FlatList } from "react-native-gesture-handler";

import { tapHaptic } from "@/lib/haptics";
import { RADIUS, useTheme } from "@/theme";
import { Icon, Text, useSheetScroll } from "@/ui";

import type { Creation } from "./api";
import { EmojiGlyph } from "./EmojiGlyph";
import {
  customToken,
  emojiCategories,
  emojiLabel,
  glyphFor,
  searchEmojis,
  SKIN_TONES,
  type SkinTone,
} from "./emoji-data";
import {
  gridColumns,
  layoutGrid,
  sectionAt,
  type EmojiCell,
  type GridLayout,
  type GridRow,
  type GridSection,
} from "./grid";
import { useCreations } from "./library";
import { rememberEmoji, setSkinTone, useRecents, useSkinTone } from "./recents";

/** The web's 40px cell, a little roomier for a thumb. */
const MIN_CELL = 44;
const LABEL_HEIGHT = 30;
const RAIL_HEIGHT = 46;
const SIDE = 4;

/** The rail's glyphs, the web's CATEGORY_ICON map plus the two of ours. */
const SECTION_ICON: ReadonlyMap<string, PhosphorIcon> = new Map([
  ["recent", ClockCounterClockwise],
  ["creations", Sparkle],
  ["people", Smiley],
  ["nature", Leaf],
  ["foods", Hamburger],
  ["activity", GameController],
  ["places", GlobeHemisphereWest],
  ["objects", Lightbulb],
  ["symbols", Heart],
  ["flags", Flag],
]);

function creationCell(creation: Creation): EmojiCell {
  const value = creation.token ?? customToken(creation.shortcode, creation.id);
  return {
    key: `c-${creation.id}`,
    value,
    label: `:${creation.shortcode}:`,
  };
}

function buildSections(
  recents: readonly string[],
  creations: readonly Creation[],
  tone: SkinTone,
): GridSection[] {
  return [
    {
      id: "recent",
      label: "Recently used",
      cells: recents.map((value) => ({
        key: `r-${value}`,
        value,
        label: emojiLabel(value),
      })),
    },
    {
      id: "creations",
      label: "Your creations",
      count: creations.length,
      cells: creations.map(creationCell),
    },
    ...emojiCategories().map((category) => ({
      id: category.id,
      label: category.label,
      cells: category.emojis.map((emoji) => ({
        key: emoji.id,
        value: glyphFor(emoji, tone),
        label: emoji.name,
        tones: emoji.skins.length > 1 ? emoji.skins : undefined,
      })),
    })),
  ];
}

function searchSection(
  query: string,
  creations: readonly Creation[],
  tone: SkinTone,
): GridSection[] {
  const q = query.trim().toLowerCase();
  const mine = creations.filter((creation) =>
    creation.shortcode.toLowerCase().includes(q),
  );
  const cells: EmojiCell[] = [
    ...mine.map(creationCell),
    ...searchEmojis(q).map((emoji) => ({
      key: emoji.id,
      value: glyphFor(emoji, tone),
      label: emoji.name,
      tones: emoji.skins.length > 1 ? emoji.skins : undefined,
    })),
  ];
  return [{ id: "results", label: "", cells }];
}

const EmojiKey = memo(function EmojiKey({
  cell,
  size,
  onPick,
  onHold,
}: {
  cell: EmojiCell;
  size: number;
  onPick: (value: string) => void;
  onHold: (cell: EmojiCell) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cell.label}
      accessibilityHint={cell.tones ? "Long press for skin tones" : undefined}
      onPress={() => onPick(cell.value)}
      onLongPress={cell.tones ? () => onHold(cell) : undefined}
      delayLongPress={300}
      style={({ pressed }) => ({
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: RADIUS,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <EmojiGlyph value={cell.value} size={Math.round(size * 0.58)} />
    </Pressable>
  );
});

const Row = memo(function Row({
  row,
  size,
  onPick,
  onHold,
}: {
  row: GridRow;
  size: number;
  onPick: (value: string) => void;
  onHold: (cell: EmojiCell) => void;
}) {
  if (row.kind === "label") {
    return (
      <View
        accessibilityRole="header"
        style={{
          height: LABEL_HEIGHT,
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
          paddingHorizontal: 10,
          paddingBottom: 6,
        }}
      >
        <Text variant="silk" tone="ink3" numberOfLines={1}>
          {row.label}
        </Text>
        {row.count ? (
          <Text variant="num" tone="ink3" style={{ fontSize: 11 }}>
            {row.count}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", paddingHorizontal: SIDE }}>
      {row.cells.map((cell) => (
        <EmojiKey
          key={cell.key}
          cell={cell}
          size={size}
          onPick={onPick}
          onHold={onHold}
        />
      ))}
    </View>
  );
});

/** The foot rail: one key per section; the one on top is lit. */
function SectionRail({
  layout,
  active,
  onJump,
  surface,
}: {
  layout: GridLayout;
  active: string | null;
  onJump: (section: string) => void;
  surface: string;
}) {
  const theme = useTheme();
  const sections = [...layout.sectionTops.keys()].filter((id) =>
    SECTION_ICON.has(id),
  );
  return (
    <View
      accessibilityRole="tablist"
      style={{
        height: RAIL_HEIGHT,
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "stretch",
        borderTopWidth: 1,
        borderTopColor: theme.line,
        backgroundColor: surface,
        paddingHorizontal: 4,
      }}
    >
      {sections.map((id) => {
        const on = id === active;
        const glyph = SECTION_ICON.get(id);
        if (!glyph) return null;
        const label = sectionLabel(layout, id);
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            onPress={() => onJump(id)}
            style={({ pressed }) => ({
              flex: 1,
              maxWidth: 48,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? theme.tint2 : "transparent",
            })}
          >
            <View
              style={{
                paddingBottom: 6,
                paddingTop: 8,
                borderBottomWidth: 2,
                borderBottomColor: on ? theme.ink1 : "transparent",
              }}
            >
              <Icon
                icon={glyph}
                active={on}
                size={19}
                color={on ? theme.ink1 : theme.ink3}
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function sectionLabel(layout: GridLayout, id: string): string {
  for (const row of layout.rows)
    if (row.kind === "label" && row.section === id) return row.label;
  return id;
}

/** The six tones of the held emoji, over the rail; picking one keeps it. */
function TonePicker({
  cell,
  tone,
  onChoose,
  onDismiss,
}: {
  cell: EmojiCell;
  tone: SkinTone;
  onChoose: (tone: SkinTone, value: string) => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  return (
    <>
      <Pressable
        accessibilityLabel="Close skin tones"
        onPress={onDismiss}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
      <View
        accessibilityViewIsModal
        style={{
          position: "absolute",
          left: 8,
          right: 8,
          bottom: RAIL_HEIGHT + 8,
          paddingHorizontal: 8,
          paddingTop: 8,
          paddingBottom: 6,
          gap: 4,
          borderRadius: RADIUS,
          borderWidth: 1,
          borderColor: theme.lineStrong,
          borderTopWidth: 2,
          borderTopColor: theme.ink1,
          backgroundColor: theme.ply3,
          shadowColor: theme.shadow,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 1,
          shadowRadius: 24,
          elevation: 16,
        }}
      >
        <Text variant="silk" tone="ink3" style={{ paddingHorizontal: 4 }}>
          Skin tone · {cell.label}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {SKIN_TONES.map((option) => {
            const glyph = cell.tones?.[option] ?? cell.value;
            const on = option === tone;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={
                  option === 0 ? "Default tone" : `Tone ${option}`
                }
                onPress={() => onChoose(option, glyph)}
                style={({ pressed }) => ({
                  width: 48,
                  height: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: RADIUS,
                  borderWidth: on ? 2 : 0,
                  borderColor: theme.ink1,
                  backgroundColor: pressed ? theme.tint2 : "transparent",
                })}
              >
                <EmojiGlyph value={glyph} size={26} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

interface EmojiGridProps {
  query: string;
  width: number;
  /** An emoji was chosen (already remembered as recent). */
  onPick: (value: string) => void;
  /** The rail's ground: the surface the grid sits on. */
  surface: string;
  /** Space under the rail (the gesture bar). */
  bottomInset: number;
  /**
   * On screen. Recently used is read as each showing starts and then held,
   * so picking never shuffles the grid under the next tap (as Gboard does).
   */
  open?: boolean;
}

/**
 * The emoji grid both pickers share: Recently used, Your creations, then
 * the Unicode categories, virtualised as fixed-height rows (it is nearly
 * two thousand cells). The foot rail jumps between sections and follows
 * the scroll. Long-press an emoji that takes skin tones to choose one; the
 * choice sticks for every emoji after it. A search shows matches only.
 */
export function EmojiGrid({
  query,
  width,
  onPick,
  surface,
  bottomInset,
  open = true,
}: EmojiGridProps) {
  const liveRecents = useRecents();
  const [recents, setRecents] = useState(liveRecents);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRecents(liveRecents);
  }
  const creations = useCreations();
  const tone = useSkinTone();
  const list = useRef<RNFlatList<GridRow>>(null);
  // In the react picker the native sheet drives the grid's scrolling.
  const sheetScroll = useSheetScroll();
  const listRef = useCallback(
    (node: RNFlatList<GridRow> | null) => {
      list.current = node;
      sheetScroll?.(node);
    },
    [sheetScroll],
  );
  const [toning, setToning] = useState<EmojiCell | null>(null);
  const searching = query.trim().length > 0;

  const columns = gridColumns(width - SIDE * 2, MIN_CELL);
  const cell = Math.floor((width - SIDE * 2) / columns);
  const layout = useMemo(
    () =>
      layoutGrid(
        searching
          ? searchSection(query, creations, tone)
          : buildSections(recents, creations, tone),
        columns,
        cell,
        LABEL_HEIGHT,
      ),
    [searching, query, creations, tone, recents, columns, cell],
  );
  const [active, setActive] = useState<string | null>(null);
  const shownActive = active ?? layout.rows[0]?.section ?? null;

  const pick = useCallback(
    (value: string) => {
      tapHaptic();
      rememberEmoji(value);
      onPick(value);
    },
    [onPick],
  );
  const hold = useCallback((held: EmojiCell) => {
    tapHaptic();
    setToning(held);
  }, []);

  const renderItem: ListRenderItem<GridRow> = useCallback(
    ({ item }) => <Row row={item} size={cell} onPick={pick} onHold={hold} />,
    [cell, pick, hold],
  );
  const getItemLayout = useCallback(
    (_: ArrayLike<GridRow> | null | undefined, index: number) => ({
      length: layout.heights[index] ?? 0,
      offset: layout.offsets[index] ?? 0,
      index,
    }),
    [layout],
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (searching) return;
      const next = sectionAt(layout, event.nativeEvent.contentOffset.y);
      setActive((current) => (current === next ? current : next));
    },
    [layout, searching],
  );
  const jump = useCallback(
    (section: string) => {
      const top = layout.sectionTops.get(section);
      if (top === undefined) return;
      setActive(section);
      list.current?.scrollToOffset({ offset: top, animated: false });
    },
    [layout],
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        data={layout.rows}
        renderItem={renderItem}
        keyExtractor={(row) => row.key}
        getItemLayout={getItemLayout}
        onScroll={onScroll}
        scrollEventThrottle={32}
        // A tap on an emoji lands while the search keyboard is up.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={7}
        // Fabric's view clipping crashes ("child already has a parent") when
        // a clipped list sits under display:none, as the hidden tab does.
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
        ListEmptyComponent={
          searching ? (
            <View style={{ padding: 20, alignItems: "center" }}>
              <Text variant="row" tone="ink3">
                No emoji match “{query.trim()}”
              </Text>
            </View>
          ) : undefined
        }
      />
      {searching ? null : (
        <SectionRail
          layout={layout}
          active={shownActive}
          onJump={jump}
          surface={surface}
        />
      )}
      <View style={{ height: bottomInset, backgroundColor: surface }} />
      {toning ? (
        <TonePicker
          cell={toning}
          tone={tone}
          onDismiss={() => setToning(null)}
          onChoose={(next, value) => {
            setSkinTone(next);
            setToning(null);
            pick(value);
          }}
        />
      ) : null}
    </View>
  );
}
