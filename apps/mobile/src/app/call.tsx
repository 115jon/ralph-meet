import { useIsFocused, useRouter } from "expo-router";
import {
  ArrowsIn,
  CaretDown,
  ChatCircle,
  DotsThreeVertical,
  Monitor,
  Waveform,
} from "phosphor-react-native";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { openDmWith } from "@/features/dms/actions";
import { callLed, callStatusLabel } from "@/features/panel/call-row";
import { SoundboardSheet } from "@/features/soundboard/SoundboardSheet";
import { stopScreenShare } from "@/features/voice/actions";
import { CallChatDrawer } from "@/features/voice/CallChatDrawer";
import { CallDock } from "@/features/voice/CallDock";
import { CallSettingsSheet } from "@/features/voice/CallSettingsSheet";
import { ParticipantTile } from "@/features/voice/ParticipantTile";
import { PersonSheet } from "@/features/voice/PersonSheet";
import {
  closePip,
  inPip,
  useArmPip,
  usePipActive,
  useRotationUnlocked,
} from "@/features/voice/pip";
import {
  type CallSummary,
  type CallTile,
  useCallSummary,
  useCallTiles,
  useIsSelf,
  useIsSpeaking,
  useParticipant,
  usePipTile,
  useTileMirrored,
  useTileStream,
} from "@/features/voice/store";
import { useWatchCallVideo } from "@/features/voice/use-watch-video";
import { useVideoSize } from "@/features/voice/video-size";
import { ZoomableVideo } from "@/features/voice/ZoomableVideo";
import { RADIUS, useTheme } from "@/theme";
import { Icon, IconButton, Led, Text } from "@/ui";

const VideoView = lazy(() => import("@/features/voice/VideoView"));

/** `perRow` tiles a row; an odd one out spans the first row. */
function rowsOf<T>(items: readonly T[], perRow: number): T[][] {
  const rows: T[][] = [];
  const lead = items.length % perRow;
  let index = 0;
  if (lead > 0) {
    rows.push(items.slice(0, lead));
    index = lead;
  }
  for (; index < items.length; index += perRow) {
    rows.push(items.slice(index, index + perRow));
  }
  return rows;
}

const FILMSTRIP_HEIGHT = 96;
const HEADER_HEIGHT = 56;
/** Landscape controls hide again this long after the last touch. */
const CONTROLS_HIDE_MS = 3000;

type CallSheet = "soundboard" | "settings";

/**
 * While our screen is shared: a live LED, the plain fact, and Stop. Android
 * adds its own status bar chip; this one is where the call is.
 */
function SharingBanner() {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: 12,
        marginTop: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 6,
        paddingLeft: 12,
        paddingRight: 6,
        borderRadius: RADIUS,
        backgroundColor: theme.ply2,
        borderWidth: 1,
        borderColor: theme.line,
      }}
    >
      <Led state="live" />
      <Text variant="row" numberOfLines={1} style={{ flex: 1 }}>
        You&apos;re sharing your screen
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop sharing your screen"
        onPress={stopScreenShare}
        style={({ pressed }) => ({
          height: 36,
          paddingHorizontal: 14,
          borderRadius: RADIUS,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? theme.tint3 : theme.tint1,
        })}
      >
        <Text variant="control">Stop</Text>
      </Pressable>
    </View>
  );
}

/** The call's title and status: name, LED, the status line and the count. */
function CallTitle({ call }: { call: CallSummary }) {
  const theme = useTheme();
  const led = callLed(call);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text
        variant="title"
        numberOfLines={1}
        accessibilityRole="header"
        style={{ fontSize: 18, lineHeight: 22 }}
      >
        {call.channelName}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Led state={led} />
        <Text
          variant="silk"
          numberOfLines={1}
          style={{ color: led === "talk" ? theme.talk : theme.ink2 }}
        >
          {callStatusLabel(call)}
        </Text>
        {call.count > 0 ? (
          <Text variant="num" tone="ink3">
            {call.count}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

interface TileHandlers {
  onPress: (tile: CallTile) => void;
  onLongPress: (tile: CallTile) => void;
}

/** A staged tile: video zooms; an avatar is just the tile, large. */
function StagedTile({
  tile,
  handlers,
  bare = false,
  onTap,
}: {
  tile: CallTile;
  handlers: TileHandlers;
  bare?: boolean;
  /** A tap at fit, instead of unstaging (landscape shows its controls). */
  onTap?: () => void;
}) {
  const stream = useTileStream(tile);
  if (!stream) {
    return (
      <ParticipantTile
        tile={tile}
        staged
        onPress={handlers.onPress}
        onLongPress={handlers.onLongPress}
      />
    );
  }
  return (
    <ZoomableVideo
      tile={tile}
      bare={bare}
      onTap={onTap ?? (() => handlers.onPress(tile))}
      onLongPress={handlers.onLongPress}
    />
  );
}

function Filmstrip({
  tiles,
  handlers,
}: {
  tiles: readonly CallTile[];
  handlers: TileHandlers;
}) {
  if (tiles.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, height: FILMSTRIP_HEIGHT }}
      contentContainerStyle={{ gap: 8 }}
    >
      {tiles.map((tile) => (
        <ParticipantTile
          key={tile.key}
          tile={tile}
          compact
          onPress={handlers.onPress}
          onLongPress={handlers.onLongPress}
          style={{ flex: 0, width: 128, height: FILMSTRIP_HEIGHT }}
        />
      ))}
    </ScrollView>
  );
}

function TileGrid({
  tiles,
  perRow,
  handlers,
  emptyText,
}: {
  tiles: readonly CallTile[];
  perRow: number;
  handlers: TileHandlers;
  emptyText: string;
}) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        flexGrow: 1,
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 12,
      }}
    >
      {tiles.length === 0 ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Text variant="body" tone="ink3">
            {emptyText}
          </Text>
        </View>
      ) : null}
      {rowsOf(tiles, perRow).map((row) => (
        <View
          key={row.map((tile) => tile.key).join("|")}
          style={{ flex: 1, minHeight: 140, flexDirection: "row", gap: 8 }}
        >
          {row.map((tile) => (
            <ParticipantTile
              key={tile.key}
              tile={tile}
              onPress={handlers.onPress}
              onLongPress={handlers.onLongPress}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * Inside the PiP window: the one tile, edge to edge, with its plate. Android
 * draws the window and its Mute and Leave; there is nothing to touch here.
 */
function PipLayout({ tile }: { tile: CallTile | null }) {
  const theme = useTheme();
  const stream = useTileStream(tile ?? NO_TILE);
  const mirrored = useTileMirrored(tile ?? NO_TILE);
  const participant = useParticipant(tile?.participantId ?? "");
  const speaking = useIsSpeaking(tile?.participantId ?? "");
  const screen = tile?.kind === "screen";
  return (
    <View style={{ flex: 1, backgroundColor: "#000000" }}>
      {stream ? (
        <Suspense fallback={null}>
          <VideoView
            streamURL={stream}
            fit={screen ? "contain" : "cover"}
            mirror={mirrored}
          />
        </Suspense>
      ) : null}
      {participant ? (
        <View
          style={{
            position: "absolute",
            left: 6,
            bottom: 6,
            height: 20,
            maxWidth: "80%",
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: 6,
            borderRadius: RADIUS,
            backgroundColor: theme.ply4,
          }}
        >
          {screen ? (
            <Icon icon={Monitor} size={12} color={theme.ink2} />
          ) : (
            <Led state={speaking ? "talk" : "off"} size={6} />
          )}
          <Text
            variant="name"
            numberOfLines={1}
            style={{ fontSize: 11, lineHeight: 14, flexShrink: 1 }}
          >
            {participant.name}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const NO_TILE: CallTile = { key: "", participantId: "", kind: "person" };

/** The PiP window's shape: the video's own, else a guess from its kind. */
function usePipAspect(tile: CallTile | null) {
  const stream = useTileStream(tile ?? NO_TILE);
  const size = useVideoSize(stream);
  const self = useIsSelf(tile?.participantId ?? "");
  if (size && size.width > 0 && size.height > 0) {
    return { width: size.width, height: size.height };
  }
  // A phone's own camera is upright; shares and desktop cameras are wide.
  return tile?.kind === "person" && self
    ? { width: 9, height: 16 }
    : { width: 16, height: 9 };
}

/** Who is speaking now, for the landscape bar's chips. */
function SpeakerChips({ tiles }: { tiles: readonly CallTile[] }) {
  return tiles
    .filter((tile) => tile.kind === "person")
    .map((tile) => (
      <SpeakingName key={tile.key} participantId={tile.participantId} />
    ));
}

function SpeakingName({ participantId }: { participantId: string }) {
  const theme = useTheme();
  const speaking = useIsSpeaking(participantId);
  const participant = useParticipant(participantId);
  if (!speaking || !participant) return null;
  return (
    <View
      style={{
        height: 28,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 8,
        borderRadius: RADIUS,
        backgroundColor: theme.ply4,
      }}
    >
      <Led state="talk" />
      <Text variant="silk" numberOfLines={1} style={{ maxWidth: 140 }}>
        {participant.name}
      </Text>
    </View>
  );
}

/**
 * Landscape with a staged video (mockup 04, A): the video edge to edge. A
 * tap shows a top bar and the dock, which hide again 3 s after the last
 * touch (a timeout, not a loop); zoom still works.
 */
function FullBleed({
  call,
  staged,
  tiles,
  handlers,
  onMinimise,
  onUnstage,
}: {
  call: CallSummary;
  staged: CallTile;
  tiles: readonly CallTile[];
  handlers: TileHandlers;
  onMinimise: () => void;
  onUnstage: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [controls, setControls] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const participant = useParticipant(staged.participantId);

  const show = useCallback(() => {
    setControls(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setControls(false), CONTROLS_HIDE_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const toggle = () => {
    if (controls) {
      if (timer.current) clearTimeout(timer.current);
      setControls(false);
    } else {
      show();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000000" }}>
      <StagedTile tile={staged} handlers={handlers} bare onTap={toggle} />
      {controls ? (
        <>
          <View
            onTouchStart={show}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: HEADER_HEIGHT + insets.top,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingTop: insets.top,
              paddingLeft: Math.max(insets.left, 4),
              paddingRight: Math.max(insets.right, 12),
              backgroundColor: "rgba(0, 0, 0, 0.6)",
            }}
          >
            <IconButton
              icon={CaretDown}
              label="Minimise the call"
              onPress={onMinimise}
            />
            <Text
              variant="title"
              numberOfLines={1}
              style={{ fontSize: 16, lineHeight: 20, flexShrink: 1 }}
            >
              {call.channelName}
            </Text>
            <Led state={staged.kind === "screen" ? "live" : "talk"} />
            <Text
              variant="silk"
              numberOfLines={1}
              style={{
                flexShrink: 1,
                color: staged.kind === "screen" ? theme.live : theme.ink2,
              }}
            >
              {participant?.name ?? ""}
              {staged.kind === "screen" ? " · screen" : ""}
            </Text>
            <View style={{ flex: 1 }} />
            <SpeakerChips tiles={tiles} />
            <IconButton
              icon={ArrowsIn}
              label="Back to everyone"
              onPress={onUnstage}
            />
          </View>
          <View
            onTouchStart={show}
            style={{
              position: "absolute",
              bottom: 0,
              alignSelf: "center",
              width: Math.min(560, 96 * 6),
            }}
          >
            <CallDock
              muted={call.muted}
              deafened={call.deafened}
              camera={call.camera}
              sharing={call.sharing}
              bottomInset={Math.max(insets.bottom - 14, 0)}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

/** The header's keys: Chat, Soundboard and the call settings. */
function HeaderKey({
  icon,
  label,
  on,
  onPress,
}: {
  icon: typeof ChatCircle;
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: on }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on
          ? theme.tint3
          : pressed
            ? theme.tint2
            : "transparent",
      })}
    >
      <Icon icon={icon} active={on} size={22} />
    </Pressable>
  );
}

/**
 * The call: tiles fill the height between the header and the dock. Tapping a
 * tile puts it on the stage (a staged video zooms); tapping it again returns
 * to the grid; a long-press opens the person's sheet. The header holds the
 * chat drawer, the soundboard and call settings. Video is pulled only while
 * this screen is visible (or in its PiP window, which leaving the app opens
 * while video is on screen). The screen alone may rotate: a staged video
 * goes edge to edge in landscape.
 */
export default function CallScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const focused = useIsFocused();
  const call = useCallSummary();
  const tiles = useCallTiles();
  const inCall = call !== null;
  const pip = usePipActive();
  const landscape = width > height;
  const [stagedKey, setStagedKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState<CallSheet | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [drawerHeight, setDrawerHeight] = useState(0);
  // PiP shows only the call: what was drawn over it is put away.
  const [wasPip, setWasPip] = useState(pip);
  if (pip !== wasPip) {
    setWasPip(pip);
    if (pip) {
      setSheet(null);
      setPersonId(null);
    }
  }
  // A staged tile that went away (they left, the share ended) leaves the grid.
  const staged = tiles.find((tile) => tile.key === stagedKey) ?? null;
  const pipTile = usePipTile(tiles, stagedKey);
  const pipAspect = usePipAspect(pipTile);
  useWatchCallVideo();
  useRotationUnlocked(focused && !pip);

  const handlers: TileHandlers = {
    onPress: useCallback(
      (tile: CallTile) =>
        setStagedKey((current) => (current === tile.key ? null : tile.key)),
      [],
    ),
    onLongPress: useCallback((tile: CallTile) => {
      setPersonId(tile.participantId);
    }, []),
  };

  const minimise = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, [router]);

  // PiP while video is on screen and nothing is drawn over the call.
  const pipReady =
    focused && pipTile !== null && sheet === null && personId === null;
  useArmPip(
    pipReady && call
      ? {
          aspectWidth: pipAspect.width,
          aspectHeight: pipAspect.height,
          muted: call.muted,
        }
      : null,
  );
  // In PiP with no video left (or the call over), there is nothing to show.
  useEffect(() => {
    if (pip && (!inCall || pipTile === null)) closePip();
  }, [pip, inCall, pipTile]);

  // Leaving (here or from the panel) or a failed join closes the screen.
  useEffect(() => {
    if (inCall) return;
    if (inPip()) closePip();
    minimise();
  }, [inCall, minimise]);

  // Back closes the chat drawer before it minimises the call.
  useEffect(() => {
    if (!chatOpen) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setChatOpen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [chatOpen]);

  const message = useCallback(
    (userId: string) => {
      void openDmWith(userId).then((opened) => {
        if (opened) minimise();
      });
    },
    [minimise],
  );
  const voiceSettings = useCallback(
    () => router.push({ pathname: "/settings", params: { tab: "calls" } }),
    [router],
  );

  if (!call) return null;
  if (pip) return <PipLayout tile={pipTile} />;

  const sheets: ReactNode = (
    <>
      <SoundboardSheet
        visible={sheet === "soundboard"}
        onClose={() => setSheet(null)}
        serverId={call.serverId}
      />
      <CallSettingsSheet
        visible={sheet === "settings"}
        onClose={() => setSheet(null)}
        onVoiceSettings={voiceSettings}
      />
      <PersonSheet
        participantId={personId}
        onClose={() => setPersonId(null)}
        onMessage={message}
      />
    </>
  );

  if (landscape && staged) {
    return (
      <>
        <FullBleed
          call={call}
          staged={staged}
          tiles={tiles}
          handlers={handlers}
          onMinimise={minimise}
          onUnstage={() => setStagedKey(null)}
        />
        {sheets}
      </>
    );
  }

  const others = staged ? tiles.filter((tile) => tile !== staged) : tiles;
  const chatUp = chatOpen && !landscape;
  const drawerMax = height - insets.top - HEADER_HEIGHT;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.ply0,
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <View
        style={{
          height: HEADER_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingLeft: 4,
          paddingRight: 8,
        }}
      >
        <IconButton
          icon={CaretDown}
          label="Minimise the call"
          onPress={minimise}
        />
        <View style={{ flex: 1, minWidth: 0, paddingLeft: 4 }}>
          <CallTitle call={call} />
        </View>
        {landscape ? null : (
          <HeaderKey
            icon={ChatCircle}
            label={chatOpen ? "Close the chat" : "Open the chat"}
            on={chatOpen}
            onPress={() => setChatOpen((open) => !open)}
          />
        )}
        <HeaderKey
          icon={Waveform}
          label="Soundboard"
          on={sheet === "soundboard"}
          onPress={() => setSheet("soundboard")}
        />
        <HeaderKey
          icon={DotsThreeVertical}
          label="Call settings"
          on={sheet === "settings"}
          onPress={() => setSheet("settings")}
        />
      </View>
      {call.sharing ? <SharingBanner /> : null}
      <View
        style={{
          flex: 1,
          marginBottom: chatUp ? Math.max(drawerHeight, 0) : 0,
        }}
      >
        {staged ? (
          <View
            style={{ flex: 1, gap: 8, paddingHorizontal: 12, paddingTop: 8 }}
          >
            <StagedTile tile={staged} handlers={handlers} />
            <Filmstrip tiles={others} handlers={handlers} />
            {chatUp ? <View style={{ height: 4 }} /> : null}
          </View>
        ) : chatUp ? (
          <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
            <Filmstrip tiles={tiles} handlers={handlers} />
          </View>
        ) : (
          <TileGrid
            tiles={tiles}
            perRow={landscape ? 3 : 2}
            handlers={handlers}
            emptyText={`Connecting to ${call.channelName}`}
          />
        )}
      </View>
      {chatUp ? null : (
        <CallDock
          muted={call.muted}
          deafened={call.deafened}
          camera={call.camera}
          sharing={call.sharing}
          bottomInset={landscape ? 0 : insets.bottom}
        />
      )}
      {landscape ? null : (
        <CallChatDrawer
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          call={call}
          maxHeight={drawerMax}
          onSettle={setDrawerHeight}
        />
      )}
      {sheets}
    </View>
  );
}
