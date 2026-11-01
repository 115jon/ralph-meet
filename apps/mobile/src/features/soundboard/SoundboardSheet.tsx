import { Waveform, X } from "phosphor-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { PickerSearch } from "@/features/chat/picker/PickerSearch";
import { useServersStore } from "@/features/servers/store";
import { sendVoiceAppEvent } from "@/features/voice/actions";
import { SheetTitle } from "@/features/voice/CallSheetRows";
import { tapHaptic } from "@/lib/haptics";
import { RADIUS, useTheme } from "@/theme";
import { Icon, IconButton, Led, Sheet, Text } from "@/ui";

import {
  DEFAULT_PLAYABLE,
  fetchFavoriteSounds,
  fetchServerSounds,
} from "./api";
import {
  DM_CALL_SERVER_KEY,
  playableIn,
  playPayload,
  soundboardServerKey,
  type PlayableSound,
} from "./events";
import { previewSound, useSoundPlaying } from "./playback";

interface Catalog {
  readonly favorites: readonly PlayableSound[];
  readonly server: readonly PlayableSound[];
  readonly status: "loading" | "ready" | "error";
}

interface Loaded {
  readonly serverId: string;
  readonly favorites: readonly PlayableSound[];
  readonly server: readonly PlayableSound[];
  readonly failed: boolean;
}

/**
 * Favorites and the server's clips, fetched each time the sheet opens; the
 * last answer for this server shows meanwhile.
 */
function useCatalog(serverId: string, open: boolean): Catalog {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!open) return;
    let current = true;
    Promise.all([
      fetchFavoriteSounds(),
      serverId ? fetchServerSounds(serverId) : Promise.resolve([]),
    ])
      .then(([favorites, server]) => {
        if (current) setLoaded({ serverId, favorites, server, failed: false });
      })
      .catch((error: unknown) => {
        console.warn("[Soundboard] Could not load sounds", error);
        if (!current) return;
        setLoaded((previous) => {
          const same = previous?.serverId === serverId;
          return {
            serverId,
            favorites: same ? previous.favorites : [],
            server: same ? previous.server : [],
            failed: true,
          };
        });
      });
    return () => {
      current = false;
    };
  }, [serverId, open]);
  if (!loaded || loaded.serverId !== serverId) {
    return { favorites: [], server: [], status: "loading" };
  }
  return {
    favorites: loaded.favorites,
    server: loaded.server,
    status: loaded.failed ? "error" : "ready",
  };
}

function SoundKey({
  sound,
  onPlay,
}: {
  sound: PlayableSound;
  onPlay: (sound: PlayableSound) => void;
}) {
  const theme = useTheme();
  const playing = useSoundPlaying(sound);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${sound.name}`}
      accessibilityHint="Plays it for everyone in the call. Long-press to hear it yourself."
      accessibilityState={{ busy: playing }}
      onPress={() => onPlay(sound)}
      onLongPress={() => {
        tapHaptic();
        previewSound(sound);
      }}
      style={({ pressed }) => ({
        width: "31.5%",
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        borderRadius: RADIUS,
        borderWidth: playing ? 2 : 1,
        borderColor: playing ? theme.talk : theme.line,
        backgroundColor: pressed ? theme.tint2 : theme.tint1,
      })}
    >
      {sound.emoji ? (
        <Text style={{ fontSize: 18, lineHeight: 22 }}>{sound.emoji}</Text>
      ) : (
        <Icon icon={Waveform} size={18} color={theme.ink2} />
      )}
      <Text
        variant="row"
        numberOfLines={2}
        style={{ flex: 1, fontSize: 13, lineHeight: 16 }}
      >
        {sound.name}
      </Text>
      {playing ? <Led state="talk" /> : null}
    </Pressable>
  );
}

function Section({
  title,
  sounds,
  onPlay,
}: {
  title: string;
  sounds: readonly PlayableSound[];
  onPlay: (sound: PlayableSound) => void;
}) {
  if (sounds.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
        }}
      >
        <Text variant="silk" tone="ink3" accessibilityRole="header">
          {title}
        </Text>
        <Text variant="num" tone="ink3">
          {sounds.length}
        </Text>
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
          paddingHorizontal: 12,
        }}
      >
        {sounds.map((sound) => (
          <SoundKey
            key={`${sound.kind}:${sound.id}`}
            sound={sound}
            onPlay={onPlay}
          />
        ))}
      </View>
    </View>
  );
}

interface SoundboardSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The call's server; empty in a DM call. */
  serverId: string;
}

/**
 * The call's soundboard: your favorites, the server's clips and the four
 * defaults. Tapping plays a clip for everyone (the LED stays lit until it
 * ends); a long-press plays it only for you. In a DM call only defaults and
 * uploads from your servers can be played, as on the web.
 */
export function SoundboardSheet({
  visible,
  onClose,
  serverId,
}: SoundboardSheetProps) {
  const { height } = useWindowDimensions();
  const userId = useSession((s) => s.user?.id ?? null);
  const serverName = useServersStore(
    (s) => s.servers.find((server) => server.id === serverId)?.name ?? null,
  );
  const catalog = useCatalog(serverId, visible);
  const [query, setQuery] = useState("");
  const serverKey = soundboardServerKey(serverId);

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const keep = (sound: PlayableSound) =>
      playableIn(sound, serverKey) &&
      (!needle || sound.name.toLowerCase().includes(needle));
    return {
      favorites: catalog.favorites.filter(keep),
      server: catalog.server.filter(keep),
      defaults: DEFAULT_PLAYABLE.filter(keep),
    };
  }, [catalog, query, serverKey]);

  const play = (sound: PlayableSound) => {
    if (!userId) return;
    tapHaptic();
    sendVoiceAppEvent(playPayload(sound, serverKey, userId));
  };

  const nothing =
    sections.favorites.length +
      sections.server.length +
      sections.defaults.length ===
    0;

  return (
    <Sheet visible={visible} onClose={onClose} label="Soundboard">
      <SheetTitle
        title="Soundboard"
        trailing={<IconButton icon={X} label="Close" onPress={onClose} />}
      />
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 12,
          paddingBottom: 10,
        }}
      >
        <PickerSearch
          value={query}
          onChange={setQuery}
          placeholder="Search sounds"
          height={40}
        />
      </View>
      <ScrollView
        style={{ maxHeight: height * 0.55 }}
        contentContainerStyle={{ gap: 14, paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        <Section title="Favorites" sounds={sections.favorites} onPlay={play} />
        {serverKey !== DM_CALL_SERVER_KEY ? (
          <Section
            title={serverName ?? "This server"}
            sounds={sections.server}
            onPlay={play}
          />
        ) : null}
        <Section title="Defaults" sounds={sections.defaults} onPlay={play} />
        {catalog.status === "loading" && catalog.favorites.length === 0 ? (
          <Text variant="row" tone="ink3" style={{ paddingHorizontal: 16 }}>
            Loading sounds…
          </Text>
        ) : null}
        {catalog.status === "error" ? (
          <Text variant="row" tone="ink3" style={{ paddingHorizontal: 16 }}>
            Your favorites and this server&apos;s sounds didn&apos;t load.
          </Text>
        ) : null}
        {nothing && query ? (
          <Text variant="row" tone="ink3" style={{ paddingHorizontal: 16 }}>
            No sounds match &ldquo;{query.trim()}&rdquo;.
          </Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
