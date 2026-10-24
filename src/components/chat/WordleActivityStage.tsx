import { apiUrl, getAuthAssetUrl } from "@/lib/platform";
import { describeApiError } from "@/lib/api-errors";
import { Button, Spinner } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
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
import { useEffect, useMemo, useRef, useState } from "react";

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

const WORDLE_THEME = {
  page: "bg-rm-bg-primary text-rm-text",
  border: "border-rm-border",
  icon: "text-rm-text-secondary",
  key: "bg-rm-bg-elevated text-rm-text",
  emptyTile: "border-rm-border",
  exampleTile: "border-rm-text-secondary/70",
  link: "text-rm-accent-ink underline underline-offset-2",
} as const;

type WordleTheme = typeof WORDLE_THEME;

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

function getMarkLabel(mark: "correct" | "present" | "absent") {
  if (mark === "correct") return "correct position";
  if (mark === "present") return "present elsewhere";
  return "not in the word";
}

function MiniBoard({
  guesses,
  answer,
  colors,
}: {
  guesses: string[];
  answer: string;
  colors: Record<"correct" | "present" | "absent", string>;
}) {
  return (
    <div className="grid grid-cols-5 gap-0.5">
      {Array.from({ length: 30 }).map((_, index) => {
        const row = Math.floor(index / 5);
        const col = index % 5;
        const guess = guesses[row] ?? "";
        const mark = guess ? evaluateWordleGuess(guess, answer)[col] : null;
        return (
          <div
            key={index}
            role="img"
            aria-label={`Row ${row + 1}, column ${col + 1}: ${mark ? getMarkLabel(mark) : "empty"}`}
            title={mark ? getMarkLabel(mark) : "Empty"}
            style={
              mark
                ? { borderColor: colors[mark], backgroundColor: colors[mark] }
                : undefined
            }
            className={cn(
              "h-2.5 w-2.5 border border-rm-activity-wordle-tile",
              mark && "border-current bg-current",
            )}
          />
        );
      })}
    </div>
  );
}

function ExampleRow({
  letters,
  highlightedIndex,
  mark,
  colors,
  theme,
}: {
  letters: string;
  highlightedIndex: number;
  mark: "correct" | "present" | "absent";
  colors: Record<"correct" | "present" | "absent", string>;
  theme: WordleTheme;
}) {
  return (
    <div className="mt-2 flex gap-1">
      {letters.split("").map((letter, index) => {
        const highlighted = index === highlightedIndex;
        return (
          <div
            key={`${letters}-${index}`}
            className={cn(
              "flex h-8 w-8 items-center justify-center border-2 text-ui-xl font-black uppercase md:h-9 md:w-9",
              theme.exampleTile,
              highlighted && "text-rm-activity-wordle-ink",
            )}
            style={
              highlighted
                ? {
                    borderColor: colors[mark],
                    backgroundColor: colors[mark],
                  }
                : undefined
            }
          >
            {letter}
          </div>
        );
      })}
    </div>
  );
}

function HowToPlayModal({
  open,
  onClose,
  colors,
}: {
  open: boolean;
  onClose: () => void;
  colors: Record<"correct" | "present" | "absent", string>;
}) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent
        showCloseButton={false}
        aria-modal="true"
        dialogClassName="max-h-[min(640px,calc(100dvh-2rem))] overflow-y-auto md:max-w-lg md:p-8"
        className="block"
      >
        <IconButton
          icon="close"
          size="md"
          variant="muted"
          onClick={onClose}
          aria-label="Close how to play"
          className="absolute right-3 top-3 max-md:hidden"
        />
        <ResponsiveDialogTitle
          className="pr-10 text-ui-2xl font-black leading-tight"
          style={{ fontFamily: "Georgia, serif" }}
        >
          How to play
        </ResponsiveDialogTitle>
        <p className="mt-1 text-ui-lg leading-snug">
          Guess the Wordle in 6 tries.
        </p>
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-ui-sm leading-snug md:text-ui-md">
          <li>Each guess must be a valid 5-letter word.</li>
          <li>
            The color of the tiles will change to show how close your guess was
            to the word.
          </li>
        </ul>

        <h3 className="mt-5 text-ui-sm font-black">Examples</h3>
        <ExampleRow
          letters="wordy"
          highlightedIndex={0}
          mark="correct"
          colors={colors}
          theme={WORDLE_THEME}
        />
        <p className="mt-1 text-ui-sm">
          <strong style={{ color: colors.correct }}>W</strong> is in the word
          and in the correct spot.
        </p>
        <ExampleRow
          letters="light"
          highlightedIndex={1}
          mark="present"
          colors={colors}
          theme={WORDLE_THEME}
        />
        <p className="mt-1 text-ui-sm">
          <strong style={{ color: colors.present }}>I</strong> is in the word
          but in the wrong spot.
        </p>
        <ExampleRow
          letters="rogue"
          highlightedIndex={3}
          mark="absent"
          colors={colors}
          theme={WORDLE_THEME}
        />
        <p className="mt-1 text-ui-sm">
          <strong style={{ color: colors.absent }}>U</strong> is not in the word
          in any spot.
        </p>

        <div className={cn("my-5 border-t", WORDLE_THEME.border)} />
        <p className="text-ui-sm leading-snug md:text-ui-md">
          A new puzzle is released daily at midnight. If you haven&apos;t
          already, you can{" "}
          <a
            className={WORDLE_THEME.link}
            href="https://www.nytimes.com/games/wordle/index.html"
            target="_blank"
            rel="noreferrer"
          >
            play Wordle
          </a>{" "}
          for a daily puzzle.
        </p>
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
  const [nextPuzzleIn, setNextPuzzleIn] = useState(getMillisecondsUntilReset());
  const [settings, setSettings] = useState<WordleSettings>(() =>
    readStoredSettings(),
  );
  const guess = draft.toLowerCase();

  useEffect(() => {
    writeStoredSettings(settings);
  }, [settings]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNextPuzzleIn(getMillisecondsUntilReset());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl(`/api/wordle/today?date=${puzzleDate}`), {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.headers.get("Content-Type")?.toLowerCase().includes("json")) {
          throw new Error(
            "Wordle API returned HTML instead of JSON. Check the API base URL for this environment.",
          );
        }
        if (!res.ok) throw new Error("Unable to load today's Wordle from NYT.");
        return res.json();
      })
      .then((data) => {
        if (isWordlePuzzle(data, puzzleDate)) {
          setPuzzle(data);
          return;
        }
        throw new Error("Today's Wordle response was invalid.");
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          console.warn("Wordle load failed", error);
        if (!controller.signal.aborted)
          setPuzzleError(describeApiError(error, "load today's Wordle"));
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
  const colors = settings.highContrast
    ? {
        correct: "var(--rm-activity-wordle-hc-correct)",
        present: "var(--rm-activity-wordle-hc-present)",
        absent: "var(--rm-activity-wordle-absent)",
      }
    : {
        correct: "var(--rm-activity-wordle-correct)",
        present: "var(--rm-activity-wordle-present)",
        absent: "var(--rm-activity-wordle-absent)",
      };
  const theme = {
    ...WORDLE_THEME,
  };

  if (!puzzle) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-3 px-6 py-12 text-center",
          theme.page,
        )}
      >
        <div
          className="mb-3 text-ui-lg font-black"
          style={{ fontFamily: "Georgia, serif" }}
        >
          The New York Times <span className="font-sans">Games</span>
        </div>
        {puzzleError ? (
          <>
            <Icon
              name="warning"
              size="3xl"
              className="text-rm-text-muted max-md:size-8"
            />
            <h2 className="text-ui-md font-semibold text-rm-danger-ink">
              Wordle unavailable
            </h2>
            <p className="max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
              Today&apos;s puzzle didn&apos;t load. Check your connection and
              try again.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setPuzzleError(null);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              Try again
            </Button>
          </>
        ) : (
          <>
            <Spinner className="size-6 text-rm-text-secondary" />
            <h2 className="text-ui-md font-semibold">
              Loading today&apos;s Wordle
            </h2>
            <p className="max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
              Fetching the current New York Times puzzle.
            </p>
          </>
        )}
      </div>
    );
  }

  if (activeView === "done") {
    const finishedStatus =
      completionReveal?.status ??
      (completionStatus.status === "missed" || persistedLocalMiss
        ? "missed"
        : "solved");
    const completedGuessCount =
      (completionReveal?.guessIndex ?? completionStatus.finalGuessIndex ?? 0) +
      1;
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center overflow-y-auto px-4 py-8",
          theme.page,
        )}
        style={{ fontFamily: "Georgia, serif" }}
      >
        <MiniBoard guesses={activeGuesses} answer={answer} colors={colors} />
        <div className="mt-2 text-ui-sm font-semibold">Wordle</div>
        <h2 className="mt-4 text-balance text-center text-ui-2xl font-black">
          {finishedStatus === "solved"
            ? `Solved in ${completedGuessCount}`
            : "Round complete"}
        </h2>
        <p className="mt-3 max-w-[36ch] text-pretty text-center text-ui-md">
          {finishedStatus === "solved"
            ? "Nice work. Your channel can see how everyone did."
            : `The answer was ${answer.toUpperCase()}. A new Wordle is on the way.`}
        </p>
        <div className="mt-5 rounded-lg bg-rm-tint-1 px-5 py-3 text-center font-sans">
          <div className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-secondary">
            Next Wordle in
          </div>
          <div className="mt-1 font-mono text-ui-2xl font-semibold tabular-nums">
            {formatCountdown(nextPuzzleIn)}
          </div>
          <div className="mt-1 text-ui-xs text-rm-text-secondary">
            midnight Eastern time
          </div>
        </div>
        <Button
          size="lg"
          onClick={() => setView("stats")}
          className="mt-6 rounded-full px-8 font-sans"
        >
          Channel stats
        </Button>
        <div className="mt-9 text-center text-ui-md">
          <div>
            {new Date(`${puzzle.print_date}T00:00:00`).toLocaleDateString(
              undefined,
              { month: "long", day: "numeric", year: "numeric" },
            )}
          </div>
          <div>No. {puzzle.id ?? "----"}</div>
          <div className="text-ui-sm">
            Edited by {puzzle.editor ?? "The New York Times"}
          </div>
        </div>
        <div className="mt-20 text-ui-2xl font-black">
          The New York Times Games
        </div>
      </div>
    );
  }

  if (activeView === "stats") {
    const local = progress[localUserId || ""];
    return (
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center overflow-y-auto p-4",
          theme.page,
        )}
      >
        <Button
          variant="ghost"
          onClick={() => {
            setCompletedBoardOpen(true);
            setView("puzzle");
          }}
          className="absolute right-4 top-4"
        >
          Back to puzzle <Icon name="close" size="sm" />
        </Button>
        <div className="w-full max-w-[380px] text-center">
          <div className="mx-auto flex w-26 flex-col items-center rounded-xl border-2 border-current p-3">
            <div className="h-16 w-16 overflow-hidden rounded-full bg-rm-tint-2">
              {local?.avatar ? (
                <img
                  src={getAuthAssetUrl(local.avatar)}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-rm-activity-wordle-correct" />
              )}
            </div>
            <div className="mt-2">
              <MiniBoard
                guesses={activeGuesses}
                answer={answer}
                colors={colors}
              />
            </div>
          </div>
          <h2 className="mt-8 text-ui-md uppercase">General statistics</h2>
          <div className="mt-3 flex justify-center divide-x divide-rm-border">
            <div className="px-4 md:px-6">
              <div className="text-ui-2xl font-semibold">{winRate}%</div>
              <div className="text-ui-xs">Win rate</div>
            </div>
            <div className="px-4 md:px-6">
              <div className="text-ui-2xl font-semibold">
                {currentStreak} Day
              </div>
              <div className="text-ui-xs">Current streak</div>
            </div>
            <div className="px-4 md:px-6">
              <div className="text-ui-2xl font-semibold">
                {currentStreak} Days
              </div>
              <div className="text-ui-xs">Best streak</div>
            </div>
          </div>
          <p className="mt-8 text-ui-md">
            For personal statistics,{" "}
            <a
              className={theme.link}
              href="https://www.nytimes.com/games/wordle/index.html"
              target="_blank"
              rel="noreferrer"
            >
              play on NYTimes.com/Wordle
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden",
        theme.page,
      )}
    >
      <style>{`
        @keyframes rm-wordle-pop { 0% { transform: scale(.86); } 55% { transform: scale(1.08); } 100% { transform: scale(1); } }
        @keyframes rm-wordle-flip { 0% { transform: rotateX(0); } 45% { transform: rotateX(90deg); } 55% { transform: rotateX(90deg); } 100% { transform: rotateX(0); } }
        @keyframes rm-wordle-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
        @media (prefers-reduced-motion: reduce) { .rm-wordle-tile, .rm-wordle-invalid-letter { animation: none !important; } }
      `}</style>
      <div
        className={cn(
          "flex h-13 shrink-0 items-center justify-between border-b px-3 md:px-5",
          theme.border,
        )}
      >
        <div
          className="min-w-0 truncate text-ui-lg font-black md:text-ui-2xl"
          style={{ fontFamily: "Georgia, serif" }}
        >
          The New York Times <span className="font-sans">Games</span>
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 md:gap-3",
            theme.icon,
          )}
        >
          <IconButton
            ref={hintsTriggerRef}
            icon="lightbulb"
            size="md"
            iconSize="xl"
            onClick={() => {
              dismissHintNotice();
              setHintsOpen(true);
            }}
            aria-label="Open hints"
          />
          <IconButton
            icon="stats"
            size="md"
            iconSize="xl"
            onClick={() => setView("stats")}
            aria-label="Open channel stats"
          />
          <IconButton
            ref={settingsTriggerRef}
            icon="settings"
            size="md"
            iconSize="xl"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open Wordle settings"
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto px-3 py-3 md:grid-cols-[170px_minmax(0,1fr)] md:overflow-hidden md:px-4">
        <aside className="order-2 mt-3 flex max-h-28 gap-3 overflow-x-auto md:order-1 md:mt-0 md:max-h-none md:flex-col md:overflow-y-auto md:overflow-x-hidden">
          <div className="flex gap-3 md:mt-4 md:flex-col">
            {rowProgress.map((row) => (
              <div
                key={row.userId}
                className="flex shrink-0 items-center gap-2"
              >
                {row.avatar ? (
                  <img
                    src={getAuthAssetUrl(row.avatar)}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <div
                    style={{ backgroundColor: colors.correct }}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-ui-xs font-semibold text-rm-activity-wordle-ink"
                  >
                    {row.name[0]}
                  </div>
                )}
                <MiniBoard
                  guesses={row.guesses}
                  answer={answer}
                  colors={colors}
                />
              </div>
            ))}
          </div>
        </aside>

        <main className="order-1 flex min-h-[500px] min-w-0 flex-col items-center justify-center gap-4 md:order-2 md:min-h-0 md:gap-5">
          <div className="relative w-[min(300px,calc(100vw-32px))]">
            <div className="grid grid-cols-5 gap-1">
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
                return (
                  <div
                    key={`${index}-${invalidGuessAttempt}`}
                    role="img"
                    aria-label={`Row ${row + 1}, column ${col + 1}: ${letter || "empty"}${mark ? `, ${getMarkLabel(mark)}` : ""}`}
                    title={mark ? getMarkLabel(mark) : undefined}
                    style={{
                      animation: invalidWordRow
                        ? `rm-wordle-shake 420ms ease-in-out both ${col * 30}ms`
                        : activeGuesses[row]
                          ? revealingRow === row
                            ? `rm-wordle-flip 520ms ease both ${col * 120}ms`
                            : undefined
                          : letter
                            ? "rm-wordle-pop 110ms ease-out"
                            : undefined,
                      ...(mark
                        ? {
                            borderColor: colors[mark],
                            backgroundColor: colors[mark],
                          }
                        : {}),
                    }}
                    className={cn(
                      "rm-wordle-tile flex aspect-square w-full items-center justify-center border-2 text-ui-2xl font-black uppercase [backface-visibility:hidden]",
                      !mark && theme.emptyTile,
                      mark && "text-rm-activity-wordle-ink",
                      invalidWordRow && "rm-wordle-invalid-letter",
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
                className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-rm-text px-3 py-2 text-center text-ui-sm font-semibold text-rm-bg-primary"
              >
                {notice.message}
              </div>
            )}
          </div>

          {completionReveal && revealingRow !== null && (
            <div
              className="text-center text-ui-sm font-semibold"
              role="status"
              aria-live="polite"
            >
              {completionReveal.status === "solved"
                ? "Revealing your solve..."
                : "Revealing the final row..."}
            </div>
          )}

          <div className="w-full max-w-[472px] space-y-2 px-1">
            {KEY_ROWS.map((row, rowIndex) => (
              <div key={row} className="flex justify-center gap-1.5">
                {rowIndex === 2 && (
                  <button
                    type="button"
                    onClick={submitGuess}
                    disabled={!answer || localFinished || revealingRow !== null}
                    className={cn(
                      "h-12 rounded-sm px-3 text-ui-xs font-semibold md:h-13",
                      theme.key,
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
                      disabled={
                        !answer || localFinished || revealingRow !== null
                      }
                      style={
                        mark ? { backgroundColor: colors[mark] } : undefined
                      }
                      className={cn(
                        "h-12 min-w-0 flex-1 rounded-sm px-1 text-ui-sm font-bold uppercase md:h-13 md:min-w-10 md:flex-none md:px-2",
                        theme.key,
                        mark && "text-rm-activity-wordle-ink",
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
                    disabled={!answer || localFinished || revealingRow !== null}
                    aria-label="Delete letter"
                    className={cn(
                      "flex h-12 items-center rounded-sm px-3 text-ui-xs font-semibold md:h-13",
                      theme.key,
                    )}
                  >
                    <Icon name="backspace" size="lg" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </main>
      </div>

      {hintNoticeOpen && !howToPlayOpen && !hintsOpen && (
        <aside
          className="absolute right-4 top-15 z-20 w-[min(20rem,calc(100%-2rem))] rounded-lg border border-rm-border bg-rm-bg-surface p-4 text-rm-text shadow-lg dark:bg-rm-bg-elevated"
          aria-label="Hint notice"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center rounded-full bg-rm-accent-tint px-2 py-0.5 text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-accent-ink">
                ★ New
              </div>
              <h2 className="mt-2 text-ui-md font-semibold">Want a hint?</h2>
              <p className="mt-1 text-ui-sm leading-snug text-rm-text-secondary">
                Click the lightbulb to reveal optional clues if you&apos;re
                stuck on this puzzle.
              </p>
            </div>
            <IconButton
              icon="close"
              variant="muted"
              onClick={dismissHintNotice}
              aria-label="Dismiss hint notice"
            />
          </div>
        </aside>
      )}

      {howToPlayOpen && (
        <HowToPlayModal
          open={howToPlayOpen}
          onClose={dismissHowToPlay}
          colors={colors}
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
          showCloseButton={false}
          aria-modal="true"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            hintsTriggerRef.current?.focus();
          }}
          className="block"
          dialogClassName="md:max-w-md"
        >
          <div className="mb-4 flex items-center justify-between">
            <ResponsiveDialogTitle className="text-ui-lg font-semibold">
              Hints
            </ResponsiveDialogTitle>
            <IconButton
              icon="close"
              variant="muted"
              onClick={closeHints}
              aria-label="Close hints"
              className="-mr-1"
            />
          </div>
          <div className="space-y-3 text-ui-sm">
            <p className="text-ui-sm text-rm-text-secondary">
              Optional clues. They never use a guess.
            </p>
            {[1, 2, 3].map((level) => {
              const hint = getHintDetails(answer, level);
              const isUnlocked = hintLevels.includes(level);
              const isNext = level === hintLevels.length + 1;
              return (
                <div key={level} className="rounded-lg bg-rm-tint-1 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">Clue {level}</div>
                      {isUnlocked && hint ? (
                        <div className="mt-1">
                          {hint.kind === "position"
                            ? `${hint.value} is in position ${hint.position}.`
                            : `${hint.title}: ${hint.value}.`}
                        </div>
                      ) : (
                        <div className="mt-1 text-rm-text-secondary">
                          {isNext
                            ? "Ready to reveal"
                            : "Unlock the previous clue first"}
                        </div>
                      )}
                    </div>
                    {!isUnlocked && (
                      <Button
                        size="sm"
                        variant={isNext ? "default" : "secondary"}
                        disabled={!isNext}
                        onClick={unlockNextHint}
                      >
                        Unlock
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="rounded-lg border border-rm-border p-3">
              {answerRevealPending ? (
                <div>
                  <div className="font-semibold">Give up this round?</div>
                  <p className="mt-1 text-rm-text-secondary">
                    The answer will be shown and this round will count as
                    missed.
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
                  className="-mx-2"
                  onClick={() => setAnswerRevealPending(true)}
                >
                  I&apos;m stuck, reveal the answer
                </Button>
              )}
            </div>
            <div className="text-ui-xs text-rm-text-muted">
              Puzzle {puzzle.id ?? "----"} · {puzzle.print_date}
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={settingsOpen}
        onOpenChange={(open) => !open && closeSettings()}
      >
        <ResponsiveDialogContent
          showCloseButton={false}
          aria-modal="true"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            settingsTriggerRef.current?.focus();
          }}
          className="block"
          dialogClassName="md:max-w-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <ResponsiveDialogTitle className="text-ui-lg font-semibold">
              Settings
            </ResponsiveDialogTitle>
            <IconButton
              icon="close"
              variant="muted"
              onClick={closeSettings}
              aria-label="Close settings"
              className="-mr-1"
            />
          </div>
          {SETTING_ROWS.map(([key, label, description]) => (
            <div
              key={key}
              className={cn(
                "flex items-center justify-between gap-4 border-b py-4",
                theme.border,
              )}
            >
              <div>
                <div className="text-ui-base font-medium">{label}</div>
                {description && (
                  <div className="text-pretty text-ui-sm text-rm-text-secondary">
                    {description}
                  </div>
                )}
              </div>
              <SettingsSwitch
                checked={settings[key]}
                ariaLabel={label}
                onChange={() =>
                  setSettings((current) => ({
                    ...current,
                    [key]: !current[key],
                  }))
                }
              />
            </div>
          ))}
          <div className="pt-4 text-right text-ui-xs text-rm-text-muted">
            #{puzzle.id ?? "----"}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
