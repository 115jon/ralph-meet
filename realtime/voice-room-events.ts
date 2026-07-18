const MAX_ACTIVITY_CHANNEL_ID_LENGTH = 200;
const MAX_PROGRESS_NAME_LENGTH = 80;
const MAX_PROGRESS_AVATAR_LENGTH = 2_048;
const MAX_PROGRESS_GUESSES = 6;
const MAX_PROGRESS_STREAK = 10_000;
const MAX_ACTIVITY_TIME_SKEW_MS = 5 * 60 * 1000;

interface ActivityStartEvent {
  type: "activity.start";
  userId: string;
  participant_id: string;
  channelId: string;
  activity: "wordle" | "warp-rush";
  startedAt: number;
}

interface ActivityLeaveEvent {
  type: "activity.leave";
  userId: string;
  participant_id: string;
  channelId: string;
}

interface WordleProgressEvent {
  type: "wordle.progress";
  channel_id: string;
  puzzle_date: string;
  progress: {
    userId: string;
    participant_id: string;
    name: null;
    avatar: null;
    guesses: string[];
    streak: number;
    finished: boolean;
    missed: boolean;
  };
}

export type SanitizedVoiceAppEventResult =
  | { kind: "activity.start"; event: ActivityStartEvent }
  | { kind: "activity.leave"; event: ActivityLeaveEvent }
  | { kind: "wordle.progress"; event: WordleProgressEvent }
  | { kind: "invalid"; message: string };

export function sanitizeVoiceAppEvent(
  input: Record<string, unknown>,
  senderUserId: string,
  participantId: string,
  now = Date.now(),
): SanitizedVoiceAppEventResult | null {
  if (input.type === "activity.start") {
    const channelId = input.channelId;
    const activity = input.activity;
    const startedAt = input.startedAt;
    if (
      typeof channelId !== "string" ||
      channelId.trim().length === 0 ||
      channelId.length > MAX_ACTIVITY_CHANNEL_ID_LENGTH ||
      (activity !== "wordle" && activity !== "warp-rush") ||
      typeof startedAt !== "number" ||
      !Number.isFinite(startedAt)
    ) {
      return { kind: "invalid", message: "Invalid activity.start payload" };
    }

    return {
      kind: "activity.start",
      event: {
        type: "activity.start",
        userId: senderUserId,
        participant_id: participantId,
        channelId: channelId.trim(),
        activity,
        startedAt: Math.min(
          Math.max(Math.trunc(startedAt), now - MAX_ACTIVITY_TIME_SKEW_MS),
          now + MAX_ACTIVITY_TIME_SKEW_MS,
        ),
      },
    };
  }

  if (input.type === "activity.leave") {
    const channelId = input.channelId;
    if (
      typeof channelId !== "string" ||
      channelId.trim().length === 0 ||
      channelId.length > MAX_ACTIVITY_CHANNEL_ID_LENGTH
    ) {
      return { kind: "invalid", message: "Invalid activity.leave payload" };
    }

    return {
      kind: "activity.leave",
      event: {
        type: "activity.leave",
        userId: senderUserId,
        participant_id: participantId,
        channelId: channelId.trim(),
      },
    };
  }

  if (input.type !== "wordle.progress") return null;

  const channelId = input.channel_id;
  const puzzleDate = input.puzzle_date;
  const progress = input.progress;
  if (
    typeof channelId !== "string" ||
    channelId.trim().length === 0 ||
    channelId.length > MAX_ACTIVITY_CHANNEL_ID_LENGTH ||
    typeof puzzleDate !== "string" ||
    !isValidDateKey(puzzleDate) ||
    !isPlainObject(progress)
  ) {
    return { kind: "invalid", message: "Invalid wordle.progress payload" };
  }

  const guesses = progress.guesses;
  const name = progress.name;
  const avatar = progress.avatar;
  const streak = progress.streak;
  const finished = progress.finished;
  const missed = progress.missed;
  if (
    !Array.isArray(guesses) ||
    guesses.length > MAX_PROGRESS_GUESSES ||
    !guesses.every(
      (guess): guess is string =>
        typeof guess === "string" && /^[a-zA-Z]{5}$/.test(guess),
    ) ||
    (name !== undefined &&
      (typeof name !== "string" || name.length > MAX_PROGRESS_NAME_LENGTH)) ||
    (avatar !== undefined &&
      avatar !== null &&
      (typeof avatar !== "string" ||
        avatar.length > MAX_PROGRESS_AVATAR_LENGTH)) ||
    typeof streak !== "number" ||
    !Number.isInteger(streak) ||
    streak < 0 ||
    streak > MAX_PROGRESS_STREAK ||
    typeof finished !== "boolean" ||
    typeof missed !== "boolean"
  ) {
    return { kind: "invalid", message: "Invalid wordle.progress payload" };
  }

  return {
    kind: "wordle.progress",
    event: {
      type: "wordle.progress",
      channel_id: channelId.trim(),
      puzzle_date: puzzleDate,
      progress: {
        userId: senderUserId,
        participant_id: participantId,
        name: null,
        avatar: null,
        guesses: guesses.map((guess) => guess.toLowerCase()),
        streak,
        finished,
        missed,
      },
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}
