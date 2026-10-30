import { apiUrl, getAuthAssetUrl } from "@/lib/platform";
import { describeApiError } from "@/lib/api-errors";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/IconButton";
import { PRESS } from "@/components/ui/interaction";
import { Num } from "@/components/ui/num";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Switch } from "@/components/ui/switch";
import { useAppActive } from "@/hooks/useAppActive";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import { getNewYorkDateKey } from "@/lib/wordle";
import {
  evaluateWordleGuess,
  getCompletionStatus,
  getHardModeViolation,
  getHintDetails,
  getRevealDuration,
  isValidWordleGuess,
  shouldShowCompletionResult,
} from "@/lib/wordle-game";
import { Icon } from "@/components/ui/icon";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

interface WordleActivityStageProps {
  sfu: SFUClient | null;
  channelId: string;
  localUserId?: string | null;
  participants: Array<{ userId: string; name: string; avatar?: string | null }>;
}

interface Progress {
  userId: string;
  name: string;
  avatar?: string | null;
  guesses: string[];
  streak: number;
  finished: boolean;
  missed: boolean;
}

interface Puzzle {
  id: number | null;
  print_date: string;
  solution: string;
  editor: string | null;
  source: "nyt";
}

function isWordlePuzzle(value: unknown, puzzleDate: string): value is Puzzle {
  if (!isRecord(value)) return false;
  const candidate = value;
  return (
    (typeof candidate.id === "number" || candidate.id === null) &&
    candidate.print_date === puzzleDate &&
    typeof candidate.solution === "string" &&
    /^[a-zA-Z]{5}$/.test(candidate.solution) &&
    (typeof candidate.editor === "string" || candidate.editor === null) &&
    candidate.source === "nyt"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

interface WordleSettings {
  hardMode: boolean;
  darkTheme: boolean;
  highContrast: boolean;
  keyboardOnly: boolean;
  remindersMuted: boolean;
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const SETTINGS_KEY = "voice-wordle:settings";
const HOW_TO_PLAY_SEEN_KEY = "voice-wordle:how-to-play-seen";
const HINT_NOTICE_SEEN_KEY = "voice-wordle:hint-notice-seen";
const DEFAULT_SETTINGS: WordleSettings = {
  hardMode: false,
  darkTheme: false,
  highContrast: false,
  keyboardOnly: false,
  remindersMuted: false,
};
const SETTING_ROWS: Array<[keyof WordleSettings, string, string]> = [
  [
    "hardMode",
    "Hard mode",
    "Any revealed hints must be used in subsequent guesses",
  ],
  [
    "highContrast",
    "High contrast mode",
    "Contrast and colorblindness improvements",
  ],
  [
    "keyboardOnly",
    "Onscreen keyboard input only",
    "Ignore key input except from the onscreen keyboard.",
  ],
  [
    "remindersMuted",
    "Mute daily reminders",
    "Don't send a notification when new puzzles are available.",
  ],
];

type Mark = "correct" | "present" | "absent";
type Palette = "default" | "contrast";

/**
 * Tile, key and mini-grid colours, all on LED tokens. `on-talk` is the ink
 * for every lit fill: it is black on the dark LEDs and white on the darker
 * light-theme LEDs, so it follows the fill it sits on. High contrast swaps
 * green/amber for amber/azure (the orange/blue pair people with colour
 * blindness already know from the classic game).
 */
const MARK_TILE: Record<Palette, Record<Mark, string>> = {
  default: {
    correct: "border-transparent bg-talk text-on-talk",
    present: "border-transparent bg-idle text-on-talk",
    absent: "border-transparent bg-tint-3 text-ink-1",
  },
  contrast: {
    correct: "border-transparent bg-idle text-on-talk",
    present: "border-transparent bg-live text-on-talk",
    absent: "border-transparent bg-tint-3 text-ink-1",
  },
};

const MARK_KEY: Record<Palette, Record<Mark, string>> = {
  default: {
    correct: "bg-talk text-on-talk",
    present: "bg-idle text-on-talk",
    absent: "bg-tint-1 text-ink-3",
  },
  contrast: {
    correct: "bg-idle text-on-talk",
    present: "bg-live text-on-talk",
    absent: "bg-tint-1 text-ink-3",
  },
};

const MARK_CELL: Record<Palette, Record<Mark, string>> = {
  default: {
    correct: "bg-talk",
    present: "bg-idle",
    absent: "bg-ink-off",
  },
  contrast: {
    correct: "bg-idle",
    present: "bg-live",
    absent: "bg-ink-off",
  },
};

/** The activity's name, in one place so the header and the dialogs agree. */
const TITLE = "Daily Word";

function readStoredFlag(key: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeStoredFlag(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, "true");
  } catch {
    // First-run notices are best-effort when storage is unavailable.
  }
}

function todayKey(date = new Date()) {
  return getNewYorkDateKey(date);
}

function getMillisecondsUntilReset(now = Date.now()) {
  const currentDateKey = todayKey(new Date(now));
  let low = now;
  let high = now + 36 * 60 * 60 * 1000;

  while (todayKey(new Date(high)) === currentDateKey) {
    high += 24 * 60 * 60 * 1000;
  }

  for (let attempt = 0; attempt < 42; attempt++) {
    const middle = Math.floor((low + high) / 2);
    if (todayKey(new Date(middle)) === currentDateKey) low = middle;
    else high = middle;
  }

  return Math.max(0, high - now);
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function readStoredProgress(key: string): {
  guesses: string[];
  localProgress: Progress | null;
  hints: number[];
} {
  if (typeof window === "undefined")
    return { guesses: [], localProgress: null, hints: [] };
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(key) ||
        '{"guesses":[],"localProgress":null,"hints":[]}',
    );
    const record =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    return {
      guesses: normalizeGuesses(record.guesses),
      localProgress: normalizeLocalProgress(record.localProgress),
      hints: normalizeHints(record.hints),
    };
  } catch {
    return { guesses: [], localProgress: null, hints: [] };
  }
}

function writeStoredProgress(
  key: string,
  value: {
    guesses: string[];
    localProgress: Progress | null;
    hints: number[];
  },
) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or privacy-mode errors; live SFU progress still works.
  }
}

function readStoredSettings(): WordleSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      hardMode:
        typeof parsed.hardMode === "boolean"
          ? parsed.hardMode
          : DEFAULT_SETTINGS.hardMode,
      darkTheme:
        typeof parsed.darkTheme === "boolean"
          ? parsed.darkTheme
          : DEFAULT_SETTINGS.darkTheme,
      highContrast:
        typeof parsed.highContrast === "boolean"
          ? parsed.highContrast
          : DEFAULT_SETTINGS.highContrast,
      keyboardOnly:
        typeof parsed.keyboardOnly === "boolean"
          ? parsed.keyboardOnly
          : DEFAULT_SETTINGS.keyboardOnly,
      remindersMuted:
        typeof parsed.remindersMuted === "boolean"
          ? parsed.remindersMuted
          : DEFAULT_SETTINGS.remindersMuted,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeStoredSettings(settings: WordleSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings are non-critical; unavailable localStorage should not break play.
  }
}

function normalizeGuesses(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (guess): guess is string =>
          typeof guess === "string" && /^[a-z]{5}$/.test(guess),
      )
    : [];
}

function normalizeHydratedGuesses(value: unknown, answer: string): string[] {
  return normalizeGuesses(value)
    .filter((guess) => isValidWordleGuess(guess, answer))
    .slice(0, 6);
}

function normalizeHints(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (hint): hint is number =>
          typeof hint === "number" && hint >= 1 && hint <= 3,
      ),
    ),
  ).sort((left, right) => left - right);
}

function normalizeProgress(
  value: unknown,
  capGuesses = true,
): Record<string, Progress> {
  if (!value || typeof value !== "object") return {};
  if ("userId" in value && typeof value.userId === "string") {
    const userId = value.userId;
    const record = value as Record<string, unknown>;
    return {
      [userId]: {
        userId,
        name: typeof record.name === "string" ? record.name : "Player",
        avatar: typeof record.avatar === "string" ? record.avatar : null,
        guesses: capGuesses
          ? normalizeGuesses(record.guesses).slice(0, 6)
          : normalizeGuesses(record.guesses),
        streak: typeof record.streak === "number" ? record.streak : 0,
        finished:
          typeof record.finished === "boolean"
            ? record.finished
            : record.status === "solved" || record.status === "missed",
        missed:
          typeof record.missed === "boolean"
            ? record.missed
            : record.status === "missed",
      },
    };
  }
  const normalized: Record<string, Progress> = {};
  for (const [userId, raw] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const record =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    normalized[userId] = {
      userId,
      name: typeof record.name === "string" ? record.name : "Player",
      avatar: typeof record.avatar === "string" ? record.avatar : null,
      guesses: capGuesses
        ? normalizeGuesses(record.guesses).slice(0, 6)
        : normalizeGuesses(record.guesses),
      streak: typeof record.streak === "number" ? record.streak : 0,
      finished:
        typeof record.finished === "boolean"
          ? record.finished
          : record.status === "solved" || record.status === "missed",
      missed:
        typeof record.missed === "boolean"
          ? record.missed
          : record.status === "missed",
    };
  }
  return normalized;
}

function normalizeLocalProgress(value: unknown): Progress | null {
  return Object.values(normalizeProgress(value, false))[0] ?? null;
}

function hydrateLocalProgress(
  value: Progress | null,
  userId: string,
  answer: string,
): Progress | null {
  if (!value) return null;
  const rawGuesses = normalizeGuesses(value.guesses);
  const guesses = normalizeHydratedGuesses(rawGuesses, answer);
  const completion = getCompletionStatus(guesses, answer);
  const preservedReveal =
    rawGuesses.length === guesses.length &&
    value.finished &&
    value.missed &&
    completion.status === "playing";
  return {
    ...value,
    userId,
    guesses,
    finished: completion.status !== "playing" || preservedReveal,
    missed: completion.status === "missed" || preservedReveal,
  };
}

function getMarkLabel(mark: Mark) {
  if (mark === "correct") return "correct position";
  if (mark === "present") return "present elsewhere";
  return "not in the word";
}

/**
 * A finished-or-in-progress board as one picture: 5 x 6 cells, colour only
 * (never letters). It is a single image to assistive tech, named by `label`;
 * thirty "Row 1, column 1" cells per player would bury the call.
 */
function MiniBoard({
  guesses,
  answer,
  palette,
  size = "sm",
  label,
}: {
  guesses: string[];
  answer: string;
  palette: Palette;
  /** `sm` is the rail's 4px cell, `md` the result card's 10px cell. */
  size?: "sm" | "md";
  label: string;
}) {
  const rows = guesses.slice(0, 6).map((guess) => ({
    marks: evaluateWordleGuess(guess, answer),
  }));
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "grid shrink-0 grid-cols-5",
        size === "sm" ? "gap-px" : "gap-0.5",
      )}
    >
      {Array.from({ length: 30 }).map((_, index) => {
        const mark = rows[Math.floor(index / 5)]?.marks[index % 5] ?? null;
        return (
          <div
            key={index}
            aria-hidden="true"
            className={cn(
              size === "sm" ? "size-1" : "size-2.5",
              mark ? MARK_CELL[palette][mark] : "bg-tint-1",
            )}
          />
        );
      })}
    </div>
  );
}

/** "Solved in 3", "Playing", "Out of tries" or "Not started". The board beside it is yours; the rail is everyone else. */
function getPlayerMeta(player: Progress, answer: string) {
  const solvedAt = answer ? player.guesses.indexOf(answer) : -1;
  if (solvedAt >= 0) return `Solved in ${solvedAt + 1}`;
  if (player.finished && player.missed) return "Out of tries";
  if (player.guesses.length > 0) return "Playing";
  return "Not started";
}

/**
 * Group progress as a right rail (spec §8, Voice): a 240px ply-1 column with
 * a 1px seam, one row per player. It only exists when the stage is wide
 * enough (`@[900px]` of the stage's own container); below that the same rows
 * collapse into `PlayerStrip` under the keyboard.
 */
function PlayerRail({
  players,
  answer,
  palette,
}: {
  players: Progress[];
  answer: string;
  palette: Palette;
}) {
  return (
    <aside
      aria-label="Other players"
      className="hidden w-60 shrink-0 flex-col overflow-y-auto border-l border-line bg-ply-1 @[900px]:flex"
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <h3 className="silkscreen text-ink-3">Others</h3>
        <Num className="text-ink-3">{players.length}</Num>
      </div>
      <ul className="flex flex-col pb-3">
        {players.map((player) => {
          const meta = getPlayerMeta(player, answer);
          return (
            <li
              key={player.userId}
              className="flex min-h-10 items-center gap-2.5 px-3 py-1.5"
            >
              <Avatar
                name={player.name}
                src={player.avatar ? getAuthAssetUrl(player.avatar) : null}
                size={24}
                ring="ply-1"
              />
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-ui-sm font-medium text-ink-1"
                  title={player.name}
                >
                  {player.name}
                </div>
                <div className="truncate text-ui-xs text-ink-3">{meta}</div>
              </div>
              <MiniBoard
                guesses={player.guesses}
                answer={answer}
                palette={palette}
                label={`${player.name}: ${meta}`}
              />
            </li>
          );
        })}
      </ul>
      {players.length < 1 ? (
        <p className="px-3 pb-3 text-ui-xs text-pretty text-ink-3">
          Friends who join the call show up here as they play.
        </p>
      ) : null}
    </aside>
  );
}

/** The rail's narrow-stage form: avatar plus board per player, one scrolling row. */
function PlayerStrip({
  players,
  answer,
  palette,
}: {
  players: Progress[];
  answer: string;
  palette: Palette;
}) {
  if (players.length < 1) return null;
  return (
    <ul
      aria-label="Other players"
      className="flex w-full max-w-[480px] gap-2 overflow-x-auto p-0.5 @[900px]:hidden"
    >
      {players.map((player) => {
        const meta = getPlayerMeta(player, answer);
        return (
          <li
            key={player.userId}
            title={`${player.name}: ${meta}`}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-line bg-ply-2 p-1.5"
          >
            <Avatar
              name={player.name}
              src={player.avatar ? getAuthAssetUrl(player.avatar) : null}
              size={24}
              ring="ply-2"
            />
            <MiniBoard
              guesses={player.guesses}
              answer={answer}
              palette={palette}
              label={`${player.name}: ${meta}`}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** Counts down to the next puzzle in its own leaf, so the stage never re-renders on the tick. */
function NextPuzzleCountdown() {
  const active = useAppActive();
  const [remaining, setRemaining] = useState(() => getMillisecondsUntilReset());

  useEffect(() => {
    if (!active) return;
    const tick = () => setRemaining(getMillisecondsUntilReset());
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  return (
    <div className="font-mono text-ui-2xl font-semibold tabular-nums">
      {formatCountdown(remaining)}
    </div>
  );
}

function ExampleRow({
  letters,
  highlightedIndex,
  mark,
  palette,
}: {
  letters: string;
  highlightedIndex: number;
  mark: Mark;
  palette: Palette;
}) {
  return (
    <div className="flex gap-1">
      {letters.split("").map((letter, index) => (
        <div
          key={`${letters}-${index}`}
          className={cn(
            "flex size-9 items-center justify-center rounded-sm border-2 text-ui-lg font-semibold uppercase",
            index === highlightedIndex
              ? MARK_TILE[palette][mark]
              : "border-line-strong bg-ply-2",
          )}
        >
          {letter}
        </div>
      ))}
    </div>
  );
}

function HowToPlayModal({
  open,
  onClose,
  palette,
}: {
  open: boolean;
  onClose: () => void;
  palette: Palette;
}) {
  const examples: Array<{
    letters: string;
    index: number;
    mark: Mark;
    text: string;
  }> = [
    {
      letters: "wordy",
      index: 0,
      mark: "correct",
      text: "is in the word and in the correct spot.",
    },
    {
      letters: "light",
      index: 1,
      mark: "present",
      text: "is in the word but in the wrong spot.",
    },
    {
      letters: "rogue",
      index: 3,
      mark: "absent",
      text: "is not in the word in any spot.",
    },
  ];
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent
        aria-modal="true"
        className="gap-4"
        dialogClassName="max-h-[min(640px,calc(100dvh-2rem))] overflow-y-auto md:max-w-md"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>How to play</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Guess the word in 6 tries.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-ui-sm text-ink-2">
          <li>Each guess must be a valid 5-letter word.</li>
          <li>
            The color of the tiles will change to show how close your guess was
            to the word.
          </li>
        </ul>

        <div className="space-y-3">
          <h3 className="text-ui-row font-semibold">Examples</h3>
          {examples.map((example) => (
            <div key={example.letters} className="space-y-1.5">
              <ExampleRow
                letters={example.letters}
                highlightedIndex={example.index}
                mark={example.mark}
                palette={palette}
              />
              <p className="text-ui-sm text-ink-2">
                <strong className="font-semibold text-ink-1 uppercase">
                  {example.letters[example.index]}
                </strong>{" "}
                {example.text}
              </p>
            </div>
          ))}
        </div>

        <p className="border-t border-line pt-4 text-ui-sm text-pretty text-ink-2">
          A new puzzle arrives every day at midnight Eastern time. Everyone in
          the call plays the same word.
        </p>

        <ResponsiveDialogFooter>
          <Button onClick={onClose}>Start playing</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function WordleActivityStage({
  sfu,
  channelId,
  localUserId,
  participants,
}: WordleActivityStageProps) {
  const [dateKey, setDateKey] = useState(todayKey);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const nextDateKey = todayKey();
      setDateKey((currentDateKey) =>
        currentDateKey === nextDateKey ? currentDateKey : nextDateKey,
      );
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const storageUserKey = localUserId?.trim() || "anonymous";
  const storageKey = `voice-wordle:${channelId}:${storageUserKey}:${dateKey}`;
  return (
    <WordleActivityStageContent
      key={storageKey}
      sfu={sfu}
      channelId={channelId}
      localUserId={localUserId}
      participants={participants}
      storageKey={storageKey}
    />
  );
}

function WordleActivityStageContent({
  sfu,
  channelId,
  localUserId,
  participants,
  storageKey,
}: WordleActivityStageProps & { storageKey: string }) {
  const puzzleDate = storageKey.slice(storageKey.lastIndexOf(":") + 1);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [puzzleError, setPuzzleError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const initialStored = useMemo(
    () => readStoredProgress(storageKey),
    [storageKey],
  );
  const [guesses, setGuesses] = useState<string[]>(() => initialStored.guesses);
  const [draft, setDraft] = useState("");
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [hintLevels, setHintLevels] = useState<number[]>(
    () => initialStored.hints,
  );
  const [view, setView] = useState<"puzzle" | "done" | "stats">("puzzle");
  const [completedBoardOpen, setCompletedBoardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const hintsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const previousHintsOpenRef = useRef(false);
  const previousSettingsOpenRef = useRef(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(
    () => !readStoredFlag(HOW_TO_PLAY_SEEN_KEY),
  );
  const [hintNoticeOpen, setHintNoticeOpen] = useState(
    () => !readStoredFlag(HINT_NOTICE_SEEN_KEY),
  );

  useEffect(() => {
    if (previousHintsOpenRef.current && !hintsOpen) {
      hintsTriggerRef.current?.focus();
    }
    previousHintsOpenRef.current = hintsOpen;
  }, [hintsOpen]);

  useEffect(() => {
    if (previousSettingsOpenRef.current && !settingsOpen) {
      settingsTriggerRef.current?.focus();
    }
    previousSettingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);
  const [answerRevealPending, setAnswerRevealPending] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    kind: "invalid-word" | "other";
  } | null>(null);
  const [invalidGuessAttempt, setInvalidGuessAttempt] = useState(0);
  const [revealingRow, setRevealingRow] = useState<number | null>(null);
  const [completionReveal, setCompletionReveal] = useState<{
    status: "solved" | "missed";
    guessIndex: number;
  } | null>(null);
  const [settings, setSettings] = useState<WordleSettings>(() =>
    readStoredSettings(),
  );
  const guess = draft.toLowerCase();

  useEffect(() => {
    writeStoredSettings(settings);
  }, [settings]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl(`/api/wordle/today?date=${puzzleDate}`), {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.headers.get("Content-Type")?.toLowerCase().includes("json")) {
          throw new Error(
            "The puzzle API returned HTML instead of JSON. Check the API base URL for this environment.",
          );
        }
        if (!res.ok) throw new Error("Unable to load today's puzzle.");
        return res.json();
      })
      .then((data) => {
        if (isWordlePuzzle(data, puzzleDate)) {
          setPuzzle(data);
          return;
        }
        throw new Error("Today's puzzle response was invalid.");
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          console.warn("Daily Word load failed", error);
        if (!controller.signal.aborted)
          setPuzzleError(describeApiError(error, "load today's puzzle"));
      });
    return () => controller.abort();
  }, [puzzleDate, loadAttempt]);

  // `sfu.on(...)` returns the unsubscribe function from EventEmitter.on.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!sfu) return;
    return sfu.on("app-event", (event) => {
      if (
        event.type !== "wordle.progress" ||
        event.channel_id !== channelId ||
        event.puzzle_date !== puzzleDate
      )
        return;
      const incoming = normalizeProgress(event.progress);
      setProgress((current) => {
        const merged = { ...current };
        for (const [userId, record] of Object.entries(incoming)) {
          const participant = participants.find(
            (item) => item.userId === userId,
          );
          merged[userId] = {
            ...record,
            name: participant?.name ?? record.name,
            avatar: participant?.avatar ?? null,
          };
        }
        return merged;
      });
    });
  }, [sfu, channelId, participants, puzzleDate]);

  const answer = puzzle?.solution.toLowerCase() ?? "";
  const activeGuesses = answer
    ? normalizeHydratedGuesses(guesses, answer)
    : guesses;

  useEffect(() => {
    if (!answer) return;
    const hydratedGuesses = normalizeHydratedGuesses(
      initialStored.guesses,
      answer,
    );
    const hydratedLocalProgress = localUserId
      ? hydrateLocalProgress(initialStored.localProgress, localUserId, answer)
      : null;
    if (
      initialStored.guesses.length > 0 ||
      initialStored.localProgress !== null ||
      initialStored.hints.length > 0
    ) {
      writeStoredProgress(storageKey, {
        guesses: hydratedGuesses,
        localProgress: hydratedLocalProgress,
        hints: initialStored.hints,
      });
    }
  }, [answer, initialStored, localUserId, storageKey]);

  const completionStatus = getCompletionStatus(activeGuesses, answer);
  const hydratedLocalProgress = localUserId
    ? hydrateLocalProgress(initialStored.localProgress, localUserId, answer)
    : null;
  const localStoredProgress = localUserId
    ? (progress[localUserId] ?? hydratedLocalProgress)
    : undefined;
  const persistedLocalMiss =
    !!localUserId &&
    localStoredProgress?.finished === true &&
    localStoredProgress.missed === true;
  const localFinished =
    !!answer &&
    (completionStatus.status !== "playing" ||
      completionReveal !== null ||
      persistedLocalMiss);
  const shouldShowDone =
    shouldShowCompletionResult({
      status: completionStatus.status,
      revealing: revealingRow !== null,
    }) ||
    (revealingRow === null &&
      (completionReveal !== null || persistedLocalMiss));
  const activeView =
    answer && shouldShowDone && view === "puzzle" && !completedBoardOpen
      ? "done"
      : view;

  useEffect(() => {
    if (revealingRow === null) return;
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(
      () => {
        setRevealingRow(null);
        if (completionReveal?.guessIndex === revealingRow) setView("done");
      },
      reducedMotion ? 0 : getRevealDuration(),
    );
    return () => window.clearTimeout(timer);
  }, [completionReveal, revealingRow]);
  const rowProgress = useMemo(() => {
    const nextRowProgress: Progress[] = [];
    for (const participant of participants) {
      if (participant.userId === localUserId) continue;
      nextRowProgress.push(
        progress[participant.userId] ?? {
          userId: participant.userId,
          name: participant.name,
          avatar: participant.avatar,
          guesses: [],
          streak: 0,
          finished: false,
          missed: false,
        },
      );
    }
    return nextRowProgress;
  }, [participants, progress, localUserId]);

  const keyMarks = useMemo(() => {
    const marks: Record<string, "correct" | "present" | "absent"> = {};
    const rank = { absent: 0, present: 1, correct: 2 };
    for (const guess of activeGuesses) {
      evaluateWordleGuess(guess, answer).forEach((mark, index) => {
        const letter = guess[index];
        if (!marks[letter] || rank[mark] > rank[marks[letter]])
          marks[letter] = mark;
      });
    }
    return marks;
  }, [activeGuesses, answer]);

  const commitProgress = (nextGuesses: string[]) => {
    if (!answer) return;
    const completion = getCompletionStatus(nextGuesses, answer);
    if (!localUserId) {
      writeStoredProgress(storageKey, {
        guesses: nextGuesses,
        localProgress: null,
        hints: hintLevels,
      });
      if (
        completion.status !== "playing" &&
        completion.finalGuessIndex !== null
      ) {
        setCompletionReveal({
          status: completion.status,
          guessIndex: completion.finalGuessIndex,
        });
      }
      return;
    }
    const solved = nextGuesses.includes(answer);
    const missed = !solved && nextGuesses.length >= 6;
    const current = localStoredProgress;
    const local = participants.find((p) => p.userId === localUserId);
    const localProgress = {
      userId: localUserId,
      name: local?.name ?? "You",
      avatar: local?.avatar,
      guesses: nextGuesses,
      streak: solved
        ? Math.max(
            1,
            current?.finished ? current.streak : (current?.streak ?? 0) + 1,
          )
        : missed
          ? 0
          : (current?.streak ?? 0),
      finished: solved || missed,
      missed,
    };
    setProgress((currentProgress) => ({
      ...currentProgress,
      [localUserId]: localProgress,
    }));
    writeStoredProgress(storageKey, {
      guesses: nextGuesses,
      localProgress,
      hints: hintLevels,
    });
    sfu?.voiceGW.sendAppEvent({
      type: "wordle.progress",
      channel_id: channelId,
      puzzle_date: puzzleDate,
      progress: localProgress,
    });
    if (
      completion.status !== "playing" &&
      completion.finalGuessIndex !== null
    ) {
      setCompletionReveal({
        status: completion.status,
        guessIndex: completion.finalGuessIndex,
      });
    }
  };

  const submitGuess = () => {
    if (
      !answer ||
      activeGuesses.length >= 6 ||
      localFinished ||
      revealingRow !== null
    )
      return;
    if (guess.length !== 5) {
      setNotice({ message: "Not enough letters.", kind: "other" });
      return;
    }
    if (!isValidWordleGuess(guess, answer)) {
      setNotice({ message: "Not in word list.", kind: "invalid-word" });
      setInvalidGuessAttempt((attempt) => attempt + 1);
      return;
    }
    const hardModeViolation = settings.hardMode
      ? getHardModeViolation(guess, activeGuesses, answer)
      : null;
    if (hardModeViolation) {
      setNotice({ message: hardModeViolation, kind: "other" });
      return;
    }
    const nextGuesses = [...activeGuesses, guess];
    setGuesses(nextGuesses);
    setRevealingRow(nextGuesses.length - 1);
    setDraft("");
    setNotice(null);
    commitProgress(nextGuesses);
  };

  const addLetter = (letter: string) => {
    if (!answer || localFinished || revealingRow !== null) return;
    setNotice(null);
    setDraft((value) => `${value}${letter}`.slice(0, 5));
  };

  const deleteLetter = () => {
    if (!answer || localFinished || revealingRow !== null) return;
    setNotice(null);
    setDraft((value) => value.slice(0, -1));
  };

  const unlockNextHint = () => {
    const nextLevel = hintLevels.length + 1;
    if (!answer || nextLevel > 3 || hintLevels.includes(nextLevel)) return;
    const nextHintLevels = [...hintLevels, nextLevel];
    setHintLevels(nextHintLevels);
    writeStoredProgress(storageKey, {
      guesses: activeGuesses,
      localProgress: localUserId ? (localStoredProgress ?? null) : null,
      hints: nextHintLevels,
    });
  };

  const revealAnswer = () => {
    if (!answer || localFinished) return;
    const local = participants.find((p) => p.userId === localUserId);
    const localProgress = localUserId
      ? {
          userId: localUserId,
          name: local?.name ?? "You",
          avatar: local?.avatar,
          guesses: activeGuesses,
          streak: 0,
          finished: true,
          missed: true,
        }
      : null;
    if (localUserId && localProgress) {
      setProgress((currentProgress) => ({
        ...currentProgress,
        [localUserId]: localProgress,
      }));
    }
    writeStoredProgress(storageKey, {
      guesses: activeGuesses,
      localProgress,
      hints: hintLevels,
    });
    if (localUserId && localProgress) {
      sfu?.voiceGW.sendAppEvent({
        type: "wordle.progress",
        channel_id: channelId,
        puzzle_date: puzzleDate,
        progress: localProgress,
      });
    }
    setAnswerRevealPending(false);
    setHintsOpen(false);
    setCompletionReveal({
      status: "missed",
      guessIndex: Math.max(0, activeGuesses.length - 1),
    });
    setRevealingRow(Math.max(0, activeGuesses.length - 1));
  };

  const dismissHowToPlay = () => {
    setHowToPlayOpen(false);
    writeStoredFlag(HOW_TO_PLAY_SEEN_KEY);
  };

  const dismissHintNotice = () => {
    setHintNoticeOpen(false);
    writeStoredFlag(HINT_NOTICE_SEEN_KEY);
  };

  const closeHints = () => {
    setHintsOpen(false);
    hintsTriggerRef.current?.focus();
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    settingsTriggerRef.current?.focus();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (hintsOpen) closeHints();
        else if (settingsOpen) closeSettings();
        return;
      }
      if (
        settings.keyboardOnly ||
        hintsOpen ||
        settingsOpen ||
        activeView !== "puzzle"
      )
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (/^[a-z]$/i.test(event.key)) {
        event.preventDefault();
        if (!answer || localFinished || revealingRow !== null) return;
        setNotice(null);
        setDraft((value) => `${value}${event.key.toLowerCase()}`.slice(0, 5));
      } else if (event.key === "Backspace") {
        event.preventDefault();
        if (!answer || localFinished || revealingRow !== null) return;
        setNotice(null);
        setDraft((value) => value.slice(0, -1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        submitGuess();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const solvedCount = rowProgress.filter((row) =>
    row.guesses.includes(answer),
  ).length;
  const winRate = rowProgress.length
    ? Math.round((solvedCount / rowProgress.length) * 100)
    : 0;
  const currentStreak = localStoredProgress?.streak ?? 0;
  const palette: Palette = settings.highContrast ? "contrast" : "default";
  const markTile = MARK_TILE[palette];
  const markKey = MARK_KEY[palette];

  if (!puzzle) {
    return (
      <StageFrame>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {puzzleError ? (
            <EmptyState
              title="Today's puzzle didn't load"
              description="Check your connection and try again."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPuzzleError(null);
                    setLoadAttempt((attempt) => attempt + 1);
                  }}
                >
                  Try again
                </Button>
              }
            />
          ) : (
            <EmptyState
              loading
              title="Loading today's puzzle"
              description="Fetching the current puzzle."
            />
          )}
        </div>
      </StageFrame>
    );
  }

  const keysLocked = !answer || localFinished || revealingRow !== null;
  let content: ReactNode;

  if (activeView === "done") {
    const finishedStatus =
      completionReveal?.status ??
      (completionStatus.status === "missed" || persistedLocalMiss
        ? "missed"
        : "solved");
    const completedGuessCount =
      (completionReveal?.guessIndex ?? completionStatus.finalGuessIndex ?? 0) +
      1;
    const resultTitle =
      finishedStatus === "solved"
        ? `Solved in ${completedGuessCount}`
        : "Round complete";
    content = (
      <div className="m-auto flex w-full max-w-sm flex-col items-center gap-5 px-4 py-8 text-center">
        <MiniBoard
          size="md"
          guesses={activeGuesses}
          answer={answer}
          palette={palette}
          label={`Your board: ${resultTitle.toLowerCase()}`}
        />
        <div className="flex flex-col gap-1.5">
          <h2 className="text-ui-xl font-semibold text-balance">
            {resultTitle}
          </h2>
          <p className="text-ui-sm text-pretty text-ink-2">
            {finishedStatus === "solved"
              ? "Nice work. Your channel can see how everyone did."
              : `The answer was ${answer.toUpperCase()}. A new puzzle is on the way.`}
          </p>
        </div>
        <div className="flex w-full flex-col items-center gap-0.5 rounded-lg border border-line bg-ply-2 px-5 py-3">
          <div className="text-ui-xs text-ink-3">Next puzzle in</div>
          <NextPuzzleCountdown />
          <div className="text-ui-xs text-ink-3">midnight Eastern time</div>
        </div>
        <Button size="lg" onClick={() => setView("stats")}>
          Channel stats
        </Button>
        <p className="text-ui-xs text-pretty text-ink-3">
          {new Date(`${puzzle.print_date}T00:00:00`).toLocaleDateString(
            undefined,
            { month: "long", day: "numeric", year: "numeric" },
          )}
          {puzzle.id !== null ? (
            <>
              {" · No. "}
              <Num>{puzzle.id}</Num>
            </>
          ) : null}
          {puzzle.editor ? ` · Edited by ${puzzle.editor}` : null}
        </p>
      </div>
    );
  } else if (activeView === "stats") {
    content = (
      <div className="m-auto flex w-full max-w-sm flex-col items-center gap-6 px-4 py-8 text-center">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            setCompletedBoardOpen(true);
            setView("puzzle");
          }}
        >
          <Icon name="back" size="sm" />
          Back to puzzle
        </Button>
        <h2 className="text-ui-lg font-semibold">Channel stats</h2>
        <div className="grid w-full grid-cols-3 divide-x divide-line rounded-lg border border-line bg-ply-2 py-4">
          <div className="px-2">
            <div className="text-ui-xl font-semibold tabular-nums">
              {winRate}%
            </div>
            <div className="mt-1 text-ui-xs text-ink-3">Win rate</div>
          </div>
          <div className="px-2">
            <div className="text-ui-xl font-semibold tabular-nums">
              {currentStreak} Day
            </div>
            <div className="mt-1 text-ui-xs text-ink-3">Current streak</div>
          </div>
          <div className="px-2">
            <div className="text-ui-xl font-semibold tabular-nums">
              {currentStreak} Days
            </div>
            <div className="mt-1 text-ui-xs text-ink-3">Best streak</div>
          </div>
        </div>
        <p className="text-ui-xs text-pretty text-ink-3">
          Win rate is the share of the other players in this call who solved
          today&apos;s puzzle.
        </p>
      </div>
    );
  } else {
    content = (
      <div className="m-auto flex w-full flex-col items-center gap-6 px-4 py-4">
        <div className="relative w-[min(300px,100%)]">
          <div className="grid grid-cols-5 gap-1.5">
            {Array.from({ length: 30 }).map((_, index) => {
              const row = Math.floor(index / 5);
              const col = index % 5;
              const guess =
                activeGuesses[row] ??
                (row === activeGuesses.length ? draft : "");
              const letter = guess[col] ?? "";
              const mark = activeGuesses[row]
                ? evaluateWordleGuess(activeGuesses[row], answer)[col]
                : null;
              const invalidWordRow =
                notice?.kind === "invalid-word" &&
                row === activeGuesses.length &&
                draft.length === 5;
              const animation = invalidWordRow
                ? `rm-wordle-shake 300ms var(--ease-in-out) both ${col * 30}ms`
                : activeGuesses[row] && revealingRow === row
                  ? `rm-wordle-flip 520ms var(--ease-in-out) both ${col * 120}ms`
                  : undefined;
              return (
                <div
                  key={`${index}-${invalidGuessAttempt}`}
                  role="img"
                  aria-label={`Row ${row + 1}, column ${col + 1}: ${letter || "empty"}${mark ? `, ${getMarkLabel(mark)}` : ""}`}
                  title={mark ? getMarkLabel(mark) : undefined}
                  style={animation ? { animation } : undefined}
                  className={cn(
                    "rm-wordle-tile flex aspect-square w-full items-center justify-center rounded-sm border-2 text-ui-2xl font-semibold uppercase [backface-visibility:hidden]",
                    mark
                      ? markTile[mark]
                      : letter
                        ? "border-ink-3 bg-ply-2"
                        : "border-line-strong bg-ply-2",
                    invalidWordRow &&
                      "rm-wordle-invalid-letter border-danger-ink text-danger-ink",
                  )}
                >
                  {letter}
                </div>
              );
            })}
          </div>

          {notice && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-md bg-ink-1 px-3 py-2 text-center text-ui-sm font-medium whitespace-nowrap text-ply-0"
            >
              {notice.message}
            </div>
          )}

          {completionReveal && revealingRow !== null && (
            <div
              className="absolute inset-x-0 top-full pt-1.5 text-center text-ui-sm font-medium text-ink-2"
              role="status"
              aria-live="polite"
            >
              {completionReveal.status === "solved"
                ? "Revealing your solve..."
                : "Revealing the final row..."}
            </div>
          )}
        </div>

        <div className="flex w-full max-w-[480px] flex-col gap-1.5">
          {KEY_ROWS.map((row, rowIndex) => (
            <div key={row} className="flex justify-center gap-1.5">
              {rowIndex === 2 && (
                <button
                  type="button"
                  onClick={submitGuess}
                  disabled={keysLocked}
                  className={cn(
                    "h-11 max-w-16 min-w-0 flex-[1.5] rounded-sm bg-tint-2 text-ui-xs font-semibold text-ink-1 outline-none",
                    PRESS,
                    localFinished && "opacity-45",
                  )}
                >
                  ENTER
                </button>
              )}
              {row.split("").map((letter) => {
                const mark = keyMarks[letter];
                return (
                  <button
                    key={letter}
                    type="button"
                    onClick={() => addLetter(letter)}
                    disabled={keysLocked}
                    className={cn(
                      "h-11 max-w-10 min-w-0 flex-1 rounded-sm text-ui-sm font-semibold uppercase outline-none",
                      PRESS,
                      mark ? markKey[mark] : "bg-tint-2 text-ink-1",
                      localFinished && "opacity-45",
                    )}
                  >
                    {letter}
                  </button>
                );
              })}
              {rowIndex === 2 && (
                <button
                  type="button"
                  onClick={deleteLetter}
                  disabled={keysLocked}
                  aria-label="Delete letter"
                  className={cn(
                    "flex h-11 max-w-16 min-w-0 flex-[1.5] items-center justify-center rounded-sm bg-tint-2 text-ink-1 outline-none",
                    PRESS,
                    localFinished && "opacity-45",
                  )}
                >
                  <Icon name="backspace" size="md" />
                </button>
              )}
            </div>
          ))}
        </div>

        <PlayerStrip players={rowProgress} answer={answer} palette={palette} />
      </div>
    );
  }

  return (
    <StageFrame
      puzzleId={puzzle.id}
      actions={
        <>
          {activeView === "puzzle" && !localFinished ? (
            <IconButton
              ref={hintsTriggerRef}
              icon="lightbulb"
              size={32}
              onClick={() => {
                dismissHintNotice();
                setHintsOpen(true);
              }}
              aria-label="Open hints"
            />
          ) : null}
          <IconButton
            icon="stats"
            size={32}
            onClick={() => setView("stats")}
            aria-label="Open channel stats"
          />
          <IconButton
            ref={settingsTriggerRef}
            icon="settings"
            size={32}
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          />
        </>
      }
    >
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 overflow-y-auto">{content}</main>
        <PlayerRail players={rowProgress} answer={answer} palette={palette} />
      </div>

      {hintNoticeOpen && !howToPlayOpen && !hintsOpen && (
        <aside
          className="absolute top-14 right-4 z-20 w-[min(20rem,calc(100%-2rem))] rounded-lg border border-line bg-ply-3 p-3 text-ink-1 shadow-float"
          aria-label="Hint notice"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-ui-row font-semibold">Want a hint?</h2>
              <p className="mt-0.5 text-ui-sm text-pretty text-ink-2">
                Click the lightbulb to reveal optional clues if you&apos;re
                stuck on this puzzle.
              </p>
            </div>
            <IconButton
              icon="close"
              size={24}
              variant="muted"
              onClick={dismissHintNotice}
              aria-label="Dismiss hint notice"
              className="-mt-0.5 -mr-1"
            />
          </div>
        </aside>
      )}

      {howToPlayOpen && (
        <HowToPlayModal
          open={howToPlayOpen}
          onClose={dismissHowToPlay}
          palette={palette}
        />
      )}

      <ResponsiveDialog
        open={hintsOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeHints();
            setAnswerRevealPending(false);
          }
        }}
      >
        <ResponsiveDialogContent
          aria-modal="true"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            hintsTriggerRef.current?.focus();
          }}
          dialogClassName="max-h-[min(640px,calc(100dvh-2rem))] overflow-y-auto md:max-w-md"
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Hints</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Optional clues. They never use a guess.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((level) => {
              const hint = getHintDetails(answer, level);
              const isUnlocked = hintLevels.includes(level);
              const isNext = level === hintLevels.length + 1;
              return (
                <div
                  key={level}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ply-2 p-3"
                >
                  <div className="min-w-0">
                    <div className="text-ui-row font-semibold">
                      Clue {level}
                    </div>
                    {isUnlocked && hint ? (
                      <div className="mt-0.5 text-ui-sm">
                        {hint.kind === "position"
                          ? `${hint.value} is in position ${hint.position}.`
                          : `${hint.title}: ${hint.value}.`}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-ui-sm text-ink-3">
                        {isNext
                          ? "Ready to reveal"
                          : "Unlock the previous clue first"}
                      </div>
                    )}
                  </div>
                  {!isUnlocked && (
                    <Button
                      size="sm"
                      variant={isNext ? "primary" : "secondary"}
                      disabled={!isNext}
                      onClick={unlockNextHint}
                    >
                      Unlock
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t border-line pt-3">
            {answerRevealPending ? (
              <div>
                <div className="text-ui-row font-semibold">
                  Give up this round?
                </div>
                <p className="mt-0.5 text-ui-sm text-pretty text-ink-2">
                  The answer will be shown and this round will count as missed.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAnswerRevealPending(false)}
                  >
                    Keep playing
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={revealAnswer}
                  >
                    Reveal answer
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2.5"
                onClick={() => setAnswerRevealPending(true)}
              >
                I&apos;m stuck, reveal the answer
              </Button>
            )}
          </div>
          <div className="text-ui-xs text-ink-3">
            Puzzle <Num>{puzzle.id ?? "----"}</Num> · {puzzle.print_date}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={settingsOpen}
        onOpenChange={(open) => !open && closeSettings()}
      >
        <ResponsiveDialogContent
          aria-modal="true"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            settingsTriggerRef.current?.focus();
          }}
          dialogClassName="md:max-w-md"
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Settings</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              These stay on this device.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="flex flex-col">
            {SETTING_ROWS.map(([key, label, description], index) => (
              <div
                key={key}
                className={cn(
                  "flex items-center justify-between gap-4 py-3",
                  index > 0 && "border-t border-line",
                )}
              >
                <div className="min-w-0">
                  <div className="text-ui-row font-medium">{label}</div>
                  <div
                    id={`wordle-setting-${key}`}
                    className="text-ui-sm text-pretty text-ink-2"
                  >
                    {description}
                  </div>
                </div>
                <Switch
                  checked={settings[key]}
                  aria-label={label}
                  aria-describedby={`wordle-setting-${key}`}
                  onCheckedChange={(checked) =>
                    setSettings((current) => ({
                      ...current,
                      [key]: checked,
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <div className="text-ui-xs text-ink-3">
            Puzzle <Num>{puzzle.id ?? "----"}</Num>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </StageFrame>
  );
}

/**
 * The activity's frame: a 48px header on ply-0 with a 1px seam, then the
 * body. The keyframes live here because they are the board's only motion:
 * transform only, no scale (a keyboard-typed letter must not pop), and the
 * reduced-motion rule covers rotate and translate, which the global rule
 * does not.
 */
function StageFrame({
  puzzleId,
  actions,
  children,
}: {
  puzzleId?: number | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="@container relative flex h-full w-full flex-col overflow-hidden bg-ply-0 text-ink-1">
      <style>{`
        @keyframes rm-wordle-flip { 0% { transform: rotateX(0); } 45% { transform: rotateX(90deg); } 55% { transform: rotateX(90deg); } 100% { transform: rotateX(0); } }
        @keyframes rm-wordle-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
        @media (prefers-reduced-motion: reduce) { .rm-wordle-tile, .rm-wordle-invalid-letter { animation: none !important; } }
      `}</style>
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-ui-md font-semibold">{TITLE}</h2>
          {puzzleId != null ? (
            <Num className="text-ink-3">#{puzzleId}</Num>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        ) : null}
      </header>
      {children}
    </div>
  );
}
