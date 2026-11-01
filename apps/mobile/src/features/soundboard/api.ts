import { Schema } from "effect";

import { apiJson } from "@/lib/api";

import {
  DEFAULT_SOUNDS,
  isDefaultSoundId,
  isMyInstantsUrl,
  isUploadUrl,
  type PlayableSound,
} from "./events";

// The sheet's catalog: your favorites, the server's clips and the defaults.
// Only what the sheet shows; uploading and editing stay on the web.

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

/** GET /api/servers/:id/soundboard: a bare array, newest first. */
const ServerSound = Schema.Struct({
  id: Schema.String,
  server_id: Schema.String,
  name: Schema.String,
  file_url: Schema.String,
  emoji: OptionalText,
  volume: Schema.optional(Schema.NullOr(Schema.Finite)),
});
const ServerSounds = Schema.Array(ServerSound);

/** GET /api/myinstants/favorites. */
const Favorite = Schema.Struct({
  id: Schema.String,
  title: OptionalText,
  url: OptionalText,
  soundType: OptionalText,
  emoji: OptionalText,
  serverId: OptionalText,
  source_server_id: OptionalText,
});
const Favorites = Schema.Struct({ favorites: Schema.Array(Favorite) });

function serverSound(sound: typeof ServerSound.Type): PlayableSound {
  return {
    id: sound.id,
    name: sound.name,
    emoji: sound.emoji || null,
    kind: "server",
    url: sound.file_url,
    volume: sound.volume ?? 1,
    serverId: sound.server_id,
  };
}

/** A favorite the phone can play: uploads, MyInstants clips, defaults (no radio). */
function favoriteSound(favorite: typeof Favorite.Type): PlayableSound | null {
  const name = favorite.title?.trim() || "Sound";
  const emoji = favorite.emoji || null;
  const url = favorite.url ?? "";
  if (favorite.soundType === "server" && isUploadUrl(url)) {
    return {
      id: favorite.id,
      name,
      emoji,
      kind: "server",
      url,
      volume: 1,
      serverId: favorite.source_server_id ?? favorite.serverId ?? null,
    };
  }
  if (favorite.soundType === "default" && isDefaultSoundId(favorite.id)) {
    return defaultSound(favorite.id, emoji);
  }
  if (isMyInstantsUrl(url) && favorite.soundType !== "radio") {
    return {
      id: favorite.id,
      name,
      emoji,
      kind: "myinstants",
      url,
      volume: 1,
      serverId: null,
    };
  }
  return null;
}

function defaultSound(id: string, emoji: string | null = null): PlayableSound {
  const known = DEFAULT_SOUNDS.find((sound) => sound.id === id);
  return {
    id,
    name: known?.name ?? id,
    emoji,
    kind: "default",
    url: null,
    volume: 1,
    serverId: null,
  };
}

export const DEFAULT_PLAYABLE: readonly PlayableSound[] = DEFAULT_SOUNDS.map(
  (sound) => defaultSound(sound.id),
);

export async function fetchServerSounds(
  serverId: string,
): Promise<PlayableSound[]> {
  const sounds = await apiJson(
    `/api/servers/${encodeURIComponent(serverId)}/soundboard`,
    ServerSounds,
  );
  return sounds.map(serverSound);
}

export async function fetchFavoriteSounds(): Promise<PlayableSound[]> {
  const { favorites } = await apiJson("/api/myinstants/favorites", Favorites);
  return favorites.flatMap((favorite) => favoriteSound(favorite) ?? []);
}
