/**
 * Voice rosters: who is in which voice channel. The channel's room
 * MeetingRoom (one per room slug) is the authority; the global gateway
 * MeetingRoom only mirrors it for the sidebar (VOICE_CHANNEL_STATES and
 * VOICE_CHANNEL_STATE_UPDATE). See VOICE_ROSTER.md next to this file.
 *
 * - The room pushes its whole roster to the global gateway whenever it
 *   changes (VOICE_ROSTER_PATH). Each snapshot carries `seq`, strictly
 *   increasing per room: the gateway applies a snapshot only when its seq is
 *   above the last one it applied for that channel, so duplicates and
 *   reordered deliveries are no-ops.
 * - Pushes from one room go out one at a time (VoiceRosterPusher) and are
 *   retried with backoff; each retry carries the room's current roster.
 * - The gateway pulls a roster from the room (VOICE_ROSTER_PULL_PATH) after
 *   it starts and whenever a channel has gone unconfirmed for a while, so a
 *   lost push or a reset room cannot leave a sidebar entry behind.
 */

/** Room -> global gateway: apply this roster snapshot. */
export const VOICE_ROSTER_PATH = "/voice-roster";
/** Global gateway -> room: answer with the current roster snapshot. */
export const VOICE_ROSTER_PULL_PATH = "/voice-roster-pull";
/** The object every room pushes to. */
export const VOICE_ROSTER_GATEWAY = "global-gateway";

/** Retry delays after a failed push; then the room's alarm takes over. */
export const VOICE_ROSTER_PUSH_BACKOFF_MS = [250, 1_000, 4_000, 10_000];
/** The room's alarm retries a push that ran out of backoff this soon. */
export const VOICE_ROSTER_PUSH_ALARM_RETRY_MS = 30_000;
/** A channel no push or pull confirmed for this long is pulled again. */
export const VOICE_ROSTER_REVALIDATE_MS = 60_000;
/** A legacy (op 33) hint pulls the room only if the channel is this stale. */
export const VOICE_ROSTER_HINT_MIN_AGE_MS = 30_000;

export interface VoiceRosterMember {
  user_id: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
  stream_preview_url?: string | null;
  connected: boolean;
  connection_state: "connected" | "reconnecting";
  disconnected_at: number | null;
  reconnect_expires_at: number | null;
  self_mute: boolean;
  self_deaf: boolean;
  self_video: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
  spatial_audio_enabled?: boolean;
  spatial_audio_high_fidelity?: boolean;
  joined_at: number;
}

export interface VoiceRosterSnapshot {
  channel_id: string;
  room_slug: string;
  /** Strictly increasing per room (nextVoiceRosterSeq). */
  seq: number;
  /**
   * When the roster last went from empty to non-empty; null when empty. A
   * room reset does not empty it while the members it dropped are held.
   */
  started_at: number | null;
  members: VoiceRosterMember[];
}

/** The parts of a room session the roster is built from. */
export interface VoiceRosterSession {
  id: string;
  user_id?: string;
  standby?: boolean;
  admission?: { accessMode: "authenticated" | "public-demo" };
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
  stream_preview_url?: string | null;
  self_mute: boolean;
  self_deaf: boolean;
  self_video: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
  spatial_audio_enabled?: boolean;
  spatial_audio_high_fidelity?: boolean;
  /** When this session joined voice (Identify or standby promotion). */
  voice_joined_at?: number;
  /** Arrival order of the join; the newest join wins (one per user). */
  voice_join_order?: number;
}

/**
 * The next roster seq: above the previous one, and above the clock (in
 * microseconds) so a room that lost its stored seq still counts upwards.
 */
export function nextVoiceRosterSeq(previous: number, now = Date.now()): number {
  return Math.max(previous + 1, now * 1000);
}

/** Whether a snapshot with `seq` supersedes the last applied one. */
export function isNewerVoiceRoster(
  lastAppliedSeq: number | undefined,
  seq: number,
): boolean {
  return lastAppliedSeq === undefined || seq > lastAppliedSeq;
}

/** Whether a room session counts for the roster (in voice, signed in). */
export function isVoiceRosterSession(
  session: VoiceRosterSession,
): session is VoiceRosterSession & { user_id: string } {
  return (
    !!session.user_id &&
    session.standby !== true &&
    session.admission?.accessMode !== "public-demo"
  );
}

function joinOrder(session: VoiceRosterSession): number {
  return session.voice_join_order ?? session.voice_joined_at ?? 0;
}

function memberOf(
  session: VoiceRosterSession & { user_id: string },
  held: { disconnectedAt: number; graceMs: number } | null,
  fallbackJoinedAt: number,
): VoiceRosterMember {
  return {
    user_id: session.user_id,
    name: session.name,
    username: session.username,
    display_name: session.display_name ?? null,
    avatar_url: session.avatar_url ?? null,
    avatar_display: session.avatar_display ?? null,
    stream_preview_url: session.stream_preview_url ?? null,
    connected: held === null,
    connection_state: held === null ? "connected" : "reconnecting",
    disconnected_at: held?.disconnectedAt ?? null,
    reconnect_expires_at: held ? held.disconnectedAt + held.graceMs : null,
    self_mute: session.self_mute,
    self_deaf: session.self_deaf,
    self_video: session.self_video,
    self_stream: session.self_stream,
    self_stream_audio: session.self_stream_audio ?? false,
    spatial_audio_enabled: session.spatial_audio_enabled ?? false,
    spatial_audio_high_fidelity: session.spatial_audio_high_fidelity ?? false,
    joined_at: session.voice_joined_at ?? fallbackJoinedAt,
  };
}

/**
 * The roster of one room: one member per user, from the live non-standby
 * sessions and those held for resume within the grace period (shown as
 * reconnecting). A user's live session beats a held one; between two of
 * the same kind the newest join wins.
 */
export function buildVoiceRosterMembers(
  live: Iterable<VoiceRosterSession>,
  held: Iterable<{ session: VoiceRosterSession; disconnectedAt: number }>,
  options: { graceMs: number; now: number; fallbackJoinedAt: number },
): VoiceRosterMember[] {
  const chosen = new Map<
    string,
    { session: VoiceRosterSession & { user_id: string }; held: number | null }
  >();
  for (const session of live) {
    if (!isVoiceRosterSession(session)) continue;
    const current = chosen.get(session.user_id);
    if (
      !current ||
      current.held !== null ||
      joinOrder(session) > joinOrder(current.session)
    ) {
      chosen.set(session.user_id, { session, held: null });
    }
  }
  for (const { session, disconnectedAt } of held) {
    if (!isVoiceRosterSession(session)) continue;
    if (options.now - disconnectedAt >= options.graceMs) continue;
    const current = chosen.get(session.user_id);
    if (current?.held === null) continue;
    if (!current || joinOrder(session) > joinOrder(current.session)) {
      chosen.set(session.user_id, { session, held: disconnectedAt });
    }
  }
  return [...chosen.values()]
    .map(({ session, held: disconnectedAt }) =>
      memberOf(
        session,
        disconnectedAt === null
          ? null
          : { disconnectedAt, graceMs: options.graceMs },
        options.fallbackJoinedAt,
      ),
    )
    .sort(
      (a, b) =>
        a.joined_at - b.joined_at ||
        (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0),
    );
}

/**
 * A member a room reset dropped, as a held session for
 * buildVoiceRosterMembers: same profile, state and join time. It never wins
 * over a real session of the user.
 */
export function voiceRosterSessionOf(
  member: VoiceRosterMember,
): VoiceRosterSession {
  return {
    id: `reset:${member.user_id}`,
    user_id: member.user_id,
    admission: { accessMode: "authenticated" },
    name: member.name,
    username: member.username,
    display_name: member.display_name ?? null,
    avatar_url: member.avatar_url ?? null,
    avatar_display: member.avatar_display ?? null,
    stream_preview_url: member.stream_preview_url ?? null,
    self_mute: member.self_mute,
    self_deaf: member.self_deaf,
    self_video: member.self_video,
    self_stream: member.self_stream,
    self_stream_audio: member.self_stream_audio,
    spatial_audio_enabled: member.spatial_audio_enabled,
    spatial_audio_high_fidelity: member.spatial_audio_high_fidelity,
    voice_joined_at: member.joined_at,
    voice_join_order: 0,
  };
}

/** A stable string for "did the roster change" (seq excluded). */
export function voiceRosterFingerprint(
  snapshot: Pick<VoiceRosterSnapshot, "channel_id" | "started_at" | "members">,
): string {
  return JSON.stringify([
    snapshot.channel_id,
    snapshot.started_at,
    snapshot.members,
  ]);
}

// ── Wire (DO to DO only) ────────────────────────────────────────────────────

const MAX_ID_LENGTH = 512;
const MAX_TEXT_LENGTH = 4_096;
const MAX_MEMBERS = 1_000;

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function isSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalText(value: unknown): string | null | undefined | false {
  if (value === undefined || value === null) return value;
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH
    ? value
    : false;
}

function optionalBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? value : null;
}

function parseMember(value: unknown): VoiceRosterMember | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  const username = optionalText(m.username);
  const displayName = optionalText(m.display_name);
  const avatarUrl = optionalText(m.avatar_url);
  const avatarDisplay = optionalText(m.avatar_display);
  const preview = optionalText(m.stream_preview_url);
  const streamAudio = optionalBoolean(m.self_stream_audio);
  const spatial = optionalBoolean(m.spatial_audio_enabled);
  const spatialHiFi = optionalBoolean(m.spatial_audio_high_fidelity);
  if (
    !isId(m.user_id) ||
    typeof m.name !== "string" ||
    m.name.length > MAX_TEXT_LENGTH ||
    username === false ||
    username === null ||
    displayName === false ||
    avatarUrl === false ||
    avatarDisplay === false ||
    preview === false ||
    typeof m.connected !== "boolean" ||
    (m.connection_state !== "connected" &&
      m.connection_state !== "reconnecting") ||
    (m.disconnected_at !== null && !isTimestamp(m.disconnected_at)) ||
    (m.reconnect_expires_at !== null && !isTimestamp(m.reconnect_expires_at)) ||
    typeof m.self_mute !== "boolean" ||
    typeof m.self_deaf !== "boolean" ||
    typeof m.self_video !== "boolean" ||
    typeof m.self_stream !== "boolean" ||
    streamAudio === null ||
    spatial === null ||
    spatialHiFi === null ||
    !isTimestamp(m.joined_at)
  ) {
    return null;
  }
  return {
    user_id: m.user_id,
    name: m.name,
    username,
    display_name: displayName ?? null,
    avatar_url: avatarUrl ?? null,
    avatar_display: avatarDisplay ?? null,
    stream_preview_url: preview ?? null,
    connected: m.connected,
    connection_state: m.connection_state,
    disconnected_at: m.disconnected_at,
    reconnect_expires_at: m.reconnect_expires_at,
    self_mute: m.self_mute,
    self_deaf: m.self_deaf,
    self_video: m.self_video,
    self_stream: m.self_stream,
    self_stream_audio: streamAudio ?? false,
    spatial_audio_enabled: spatial ?? false,
    spatial_audio_high_fidelity: spatialHiFi ?? false,
    joined_at: m.joined_at,
  };
}

/** A member list (a snapshot's, or a room's stored one); null if invalid. */
export function parseVoiceRosterMembers(
  value: unknown,
): VoiceRosterMember[] | null {
  if (!Array.isArray(value) || value.length > MAX_MEMBERS) return null;
  const members: VoiceRosterMember[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const member = parseMember(raw);
    if (!member || seen.has(member.user_id)) return null;
    seen.add(member.user_id);
    members.push(member);
  }
  return members;
}

export function parseVoiceRosterSnapshot(
  value: unknown,
): VoiceRosterSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (
    !isId(body.channel_id) ||
    !isId(body.room_slug) ||
    !isSeq(body.seq) ||
    (body.started_at !== null && !isTimestamp(body.started_at))
  ) {
    return null;
  }
  const members = parseVoiceRosterMembers(body.members);
  if (!members) return null;
  return {
    channel_id: body.channel_id,
    room_slug: body.room_slug,
    seq: body.seq,
    started_at: body.started_at,
    members,
  };
}

/**
 * A pull: which channel, from which room, and the seq the gateway last
 * applied for it (`min_seq`, optional). A room whose seq is below that (it
 * lost its stored seq on a host whose clock is behind) answers above it.
 */
export function parseVoiceRosterPull(
  value: unknown,
): { channelId: string; roomSlug: string; minSeq: number } | null {
  if (!value || typeof value !== "object") return null;
  const {
    channel_id: channelId,
    room_slug: roomSlug,
    min_seq: minSeq,
  } = value as Record<string, unknown>;
  if (!isId(channelId) || !isId(roomSlug)) return null;
  if (minSeq === undefined) return { channelId, roomSlug, minSeq: 0 };
  return isSeq(minSeq) ? { channelId, roomSlug, minSeq } : null;
}

/**
 * The gateway's answer to a push: whether it applied the snapshot, and the
 * seq it holds for the channel (absent when the snapshot came from a room
 * that does not own the channel). A held seq above the pushed one means the
 * room must count from above it.
 */
export function parseVoiceRosterPushReply(
  value: unknown,
): { applied: boolean; seq?: number } | null {
  if (!value || typeof value !== "object") return null;
  const { applied, seq } = value as Record<string, unknown>;
  if (typeof applied !== "boolean") return null;
  if (seq === undefined) return { applied };
  return isSeq(seq) ? { applied, seq } : null;
}

/**
 * The channel a room serves: the ticket's channel id when it carries one,
 * else what the server voice slug (`voice-<serverId>-<channelId>`) encodes.
 * DM call rooms (`dm-call-...`) need the ticket's channel id.
 */
export function resolveRoomVoiceChannelId(
  roomSlug: string,
  admission: { channelId?: string; serverId?: string },
): string | null {
  if (admission.channelId && isId(admission.channelId)) {
    return admission.channelId;
  }
  if (admission.serverId) {
    const prefix = `voice-${admission.serverId}-`;
    if (roomSlug.startsWith(prefix) && roomSlug.length > prefix.length) {
      return roomSlug.slice(prefix.length);
    }
  }
  return null;
}

// ── Push queue ──────────────────────────────────────────────────────────────

/**
 * Sends a room's roster to the global gateway, one request at a time, so a
 * room's pushes arrive in seq order. `request()` marks the roster dirty; the
 * loop sends the current snapshot (built per attempt, so a retry never sends
 * an outdated roster) until nothing is dirty. A failed send backs off
 * (VOICE_ROSTER_PUSH_BACKOFF_MS) and tries again; after the last delay it
 * stops and calls `onGiveUp` (the room's alarm retries later).
 */
export class VoiceRosterPusher {
  private dirty = false;
  private running: Promise<void> | null = null;

  constructor(
    private readonly options: {
      send: () => Promise<boolean>;
      onGiveUp: () => void;
      onDelivered?: () => void;
      waitUntil: (promise: Promise<unknown>) => void;
      sleep?: (ms: number) => Promise<void>;
      backoffMs?: readonly number[];
    },
  ) {}

  /** Marks the roster changed; starts sending if nothing is in flight. */
  request(): void {
    this.dirty = true;
    if (this.running) return;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    this.options.waitUntil(this.running);
  }

  /** Resolves when the current send loop (if any) has finished. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private async run(): Promise<void> {
    const backoff = this.options.backoffMs ?? VOICE_ROSTER_PUSH_BACKOFF_MS;
    const sleep =
      this.options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let failures = 0;
    while (this.dirty) {
      this.dirty = false;
      let delivered = false;
      try {
        delivered = await this.options.send();
      } catch {
        delivered = false;
      }
      if (delivered) {
        failures = 0;
        this.options.onDelivered?.();
        continue;
      }
      if (failures >= backoff.length) {
        this.options.onGiveUp();
        return;
      }
      await sleep(backoff[failures]);
      failures += 1;
      this.dirty = true;
    }
  }
}
