import { apiUrl, getAuthAssetUrl } from "@/lib/platform";
import { BaseModal } from "@/components/ui/BaseModal";
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
import { BarChart3, Delete, Lightbulb, Settings, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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

interface WordleSettings {
  hardMode: boolean;
  darkTheme: boolean;
  highContrast: boolean;
  keyboardOnly: boolean;
  remindersMuted: boolean;
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const SETTINGS_KEY = "voice-wordle:settings";
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
    "Hard Mode",
    "Any revealed hints must be used in subsequent guesses",
  ],
  [
    "highContrast",
    "High Contrast Mode",
    "Contrast and colorblindness improvements",
  ],
  [
    "keyboardOnly",
    "Onscreen Keyboard Input Only",
    "Ignore key input except from the onscreen keyboard.",
  ],
  [
    "remindersMuted",
    "Mute Daily Reminders",
    "Don't send a notification when new puzzles are available.",
  ],
];

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
    <div className="grid grid-cols-5 gap-[2px]">
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
              "h-2.5 w-2.5 border border-[#d3d6da]",
              mark && "border-current bg-current",
            )}
          />
        );
      })}
    </div>
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
  const [answerRevealPending, setAnswerRevealPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
        if (
          typeof data?.solution === "string" &&
          /^[a-zA-Z]{5}$/.test(data.solution) &&
          data.print_date === puzzleDate &&
          data.source === "nyt"
        ) {
          setPuzzle(data as Puzzle);
          return;
        }
        throw new Error("Today's Wordle response was invalid.");
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setPuzzleError(
            error instanceof Error
              ? error.message
              : "Unable to load today's Wordle.",
          );
      });
    return () => controller.abort();
  }, [puzzleDate]);

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
      setNotice("Not enough letters.");
      return;
    }
    if (!isValidWordleGuess(guess, answer)) {
      setNotice("Not in word list.");
      return;
    }
    const hardModeViolation = settings.hardMode
      ? getHardModeViolation(guess, activeGuesses, answer)
      : null;
    if (hardModeViolation) {
      setNotice(hardModeViolation);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (hintsOpen) setHintsOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
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
        correct: "#b45309",
        present: "#1d4ed8",
        absent: "#4b5563",
      }
    : {
        correct: "#2f6f35",
        present: "#7a5f00",
        absent: "#4b5563",
      };
  const theme = {
    page: "bg-rm-bg-primary text-rm-text",
    border: "border-rm-border",
    icon: "text-rm-text-secondary",
    key: "bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white",
    emptyTile: "border-slate-300 dark:border-slate-700",
    modal:
      "bg-slate-50/95 dark:bg-rm-bg-surface text-slate-900 dark:text-white backdrop-blur-2xl border border-slate-200 dark:border-white/10",
    overlay: "bg-slate-900/40 backdrop-blur-sm",
  };

  if (!puzzle) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center px-6 text-center",
          theme.page,
        )}
      >
        <div
          className="text-lg font-black"
          style={{ fontFamily: "Georgia, serif" }}
        >
          The New York Times <span className="font-sans">Games</span>
        </div>
        <h2 className="mt-5 text-2xl font-black">
          {puzzleError ? "Wordle unavailable" : "Loading today's Wordle"}
        </h2>
        <p className="mt-3 max-w-sm text-sm opacity-75">
          {puzzleError ??
            "Fetching the current New York Times puzzle for the New York calendar date."}
        </p>
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
        <div className="mt-2 text-sm font-bold">Wordle</div>
        <h2 className="mt-4 text-center text-3xl font-black sm:text-4xl">
          {finishedStatus === "solved"
            ? `Solved in ${completedGuessCount}`
            : "Round complete"}
        </h2>
        <p className="mt-3 max-w-sm text-center text-base leading-relaxed sm:text-lg">
          {finishedStatus === "solved"
            ? "Nice work. Your channel can see how everyone did."
            : `The answer was ${answer.toUpperCase()}. A new Wordle is on the way.`}
        </p>
        <div className="mt-5 rounded-xl border border-current/15 px-5 py-3 text-center font-sans shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.12em] opacity-65">
            Next Wordle in
          </div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
            {formatCountdown(nextPuzzleIn)}
          </div>
          <div className="mt-1 text-xs opacity-65">midnight Eastern time</div>
        </div>
        <button
          type="button"
          onClick={() => setView("stats")}
          className="mt-6 rounded-full bg-black px-10 py-3 text-base font-bold text-white transition-transform active:scale-[0.96]"
        >
          Channel Stats
        </button>
        <div className="mt-9 text-center text-base">
          <div>
            {new Date(`${puzzle.print_date}T00:00:00`).toLocaleDateString(
              undefined,
              { month: "long", day: "numeric", year: "numeric" },
            )}
          </div>
          <div>No. {puzzle.id ?? "----"}</div>
          <div className="text-sm">
            Edited by {puzzle.editor ?? "The New York Times"}
          </div>
        </div>
        <div className="mt-20 text-2xl font-black">
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
        <button
          type="button"
          onClick={() => {
            setCompletedBoardOpen(true);
            setView("puzzle");
          }}
          className="absolute right-5 top-5 flex items-center gap-2 text-base"
        >
          Back to puzzle <X size={18} />
        </button>
        <div className="w-full max-w-[380px] text-center">
          <div className="mx-auto flex w-[102px] flex-col items-center rounded-xl border-2 border-current p-3">
            <div className="h-16 w-16 overflow-hidden rounded-full bg-[#d9d9d9]">
              {local?.avatar ? (
                <img
                  src={getAuthAssetUrl(local.avatar)}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-[#6aaa64]" />
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
          <h2 className="mt-8 text-base uppercase">General Statistics</h2>
          <div className="mt-3 flex justify-center divide-x divide-[#d3d6da]">
            <div className="px-4 sm:px-6">
              <div className="text-2xl font-bold">{winRate}%</div>
              <div className="text-xs">Win Rate</div>
            </div>
            <div className="px-4 sm:px-6">
              <div className="text-2xl font-bold">{currentStreak} Day</div>
              <div className="text-xs">Current Streak</div>
            </div>
            <div className="px-4 sm:px-6">
              <div className="text-2xl font-bold">{currentStreak} Days</div>
              <div className="text-xs">Best Streak</div>
            </div>
          </div>
          <p className="mt-8 text-base">
            For personal statistics,{" "}
            <a
              className="text-blue-600"
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
        @media (prefers-reduced-motion: reduce) { .rm-wordle-tile { animation: none !important; } }
      `}</style>
      <div
        className={cn(
          "flex h-[52px] shrink-0 items-center justify-between border-b px-3 sm:px-5",
          theme.border,
        )}
      >
        <div
          className="min-w-0 truncate text-lg font-black sm:text-2xl"
          style={{ fontFamily: "Georgia, serif" }}
        >
          The New York Times <span className="font-sans">Games</span>
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-3 sm:gap-6",
            theme.icon,
          )}
        >
          <button
            type="button"
            onClick={() => setHintsOpen(true)}
            aria-label="Open hints"
            title="Hints"
          >
            <Lightbulb size={26} />
          </button>
          <button
            type="button"
            onClick={() => setView("stats")}
            aria-label="Open channel stats"
            title="Stats"
          >
            <BarChart3 size={28} />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open Wordle settings"
            title="Settings"
          >
            <Settings size={30} />
          </button>
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
                    className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
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
          <div className="grid w-[min(300px,calc(100vw-32px))] grid-cols-5 gap-[5px]">
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
              return (
                <div
                  key={index}
                  role="img"
                  aria-label={`Row ${row + 1}, column ${col + 1}: ${letter || "empty"}${mark ? `, ${getMarkLabel(mark)}` : ""}`}
                  title={mark ? getMarkLabel(mark) : undefined}
                  style={{
                    animation: activeGuesses[row]
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
                    "rm-wordle-tile flex aspect-square w-full items-center justify-center border-2 text-3xl font-black uppercase [backface-visibility:hidden]",
                    !mark && theme.emptyTile,
                    mark && "text-white",
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
              className="text-center text-sm font-bold uppercase tracking-wide text-[#cf2e2e]"
            >
              {notice}
            </div>
          )}

          {completionReveal && revealingRow !== null && (
            <div
              className="text-center text-sm font-bold"
              role="status"
              aria-live="polite"
            >
              {completionReveal.status === "solved"
                ? "Revealing your solve..."
                : "Revealing the final row..."}
            </div>
          )}

          <div className="w-full max-w-[470px] space-y-2 px-1">
            {KEY_ROWS.map((row, rowIndex) => (
              <div key={row} className="flex justify-center gap-1.5">
                {rowIndex === 2 && (
                  <button
                    type="button"
                    onClick={submitGuess}
                    disabled={!answer || localFinished || revealingRow !== null}
                    className={cn(
                      "h-12 rounded px-3 text-xs font-bold sm:h-[52px]",
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
                        "h-12 min-w-0 flex-1 rounded px-1 text-sm font-bold uppercase sm:h-[52px] sm:min-w-10 sm:flex-none sm:px-2",
                        theme.key,
                        mark && "text-white",
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
                      "flex h-12 items-center rounded px-3 text-xs font-bold sm:h-[52px]",
                      theme.key,
                    )}
                  >
                    <Delete size={20} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </main>
      </div>

      {hintsOpen && (
        <BaseModal
          onClose={() => {
            setHintsOpen(false);
            setAnswerRevealPending(false);
          }}
          aria-labelledby="wordle-hints-title"
        >
          <div
            className={cn(
              "fixed inset-0 z-10 flex items-center justify-center p-4",
              theme.overlay,
            )}
          >
            <div
              className={cn(
                "w-full max-w-md rounded-2xl p-5 shadow-2xl",
                theme.modal,
              )}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2
                  id="wordle-hints-title"
                  className="text-base font-black uppercase"
                >
                  Hints
                </h2>
                <button
                  type="button"
                  onClick={() => setHintsOpen(false)}
                  aria-label="Close hints"
                >
                  <X size={26} />
                </button>
              </div>
              <div className="space-y-3 text-sm">
                <p className="text-xs opacity-70">
                  Optional clues. They never use a guess.
                </p>
                {[1, 2, 3].map((level) => {
                  const hint = getHintDetails(answer, level);
                  const isUnlocked = hintLevels.includes(level);
                  const isNext = level === hintLevels.length + 1;
                  return (
                    <div
                      key={level}
                      className={cn("rounded-md border p-3", theme.border)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-bold">Clue {level}</div>
                          {isUnlocked && hint ? (
                            <div className="mt-1">
                              {hint.kind === "position"
                                ? `${hint.value} is in position ${hint.position}.`
                                : `${hint.title}: ${hint.value}.`}
                            </div>
                          ) : (
                            <div className="mt-1 opacity-60">
                              {isNext
                                ? "Ready to reveal"
                                : "Unlock the previous clue first"}
                            </div>
                          )}
                        </div>
                        {!isUnlocked && (
                          <button
                            type="button"
                            disabled={!isNext}
                            onClick={unlockNextHint}
                            className={cn(
                              "shrink-0 rounded-full px-3 py-2 text-xs font-bold transition-transform active:scale-[0.96]",
                              isNext
                                ? "bg-black text-white"
                                : "bg-slate-200 text-slate-500 dark:bg-slate-800",
                            )}
                          >
                            Unlock
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className={cn("rounded-md border p-3", theme.border)}>
                  {answerRevealPending ? (
                    <div>
                      <div className="font-bold">Give up this round?</div>
                      <p className="mt-1 text-xs opacity-70">
                        The answer will be shown and this round will count as
                        missed.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAnswerRevealPending(false)}
                          className="rounded-full border px-3 py-2 text-xs font-bold"
                        >
                          Keep playing
                        </button>
                        <button
                          type="button"
                          onClick={revealAnswer}
                          className="rounded-full bg-black px-3 py-2 text-xs font-bold text-white"
                        >
                          Reveal answer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAnswerRevealPending(true)}
                      className="font-bold"
                    >
                      I&apos;m stuck - reveal the answer
                    </button>
                  )}
                </div>
                <div className="text-xs opacity-60">
                  Puzzle {puzzle.id ?? "----"} - {puzzle.print_date}
                </div>
              </div>
            </div>
          </div>
        </BaseModal>
      )}

      {settingsOpen && (
        <BaseModal
          onClose={() => setSettingsOpen(false)}
          aria-labelledby="wordle-settings-title"
        >
          <div
            className={cn(
              "fixed inset-0 z-10 flex items-center justify-center p-4",
              theme.overlay,
            )}
          >
            <div
              className={cn(
                "w-full max-w-[500px] rounded-2xl p-4 shadow-2xl",
                theme.modal,
              )}
            >
              <div className="mb-5 flex items-center justify-between">
                <h2
                  id="wordle-settings-title"
                  className="flex-1 text-center text-base font-black uppercase"
                >
                  Settings
                </h2>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                >
                  <X size={28} />
                </button>
              </div>
              {SETTING_ROWS.map(([key, label, description]) => (
                <div
                  key={key}
                  className={cn(
                    "flex items-center justify-between border-b py-4",
                    theme.border,
                  )}
                >
                  <div>
                    <div className="text-lg">{label}</div>
                    {description && (
                      <div className="text-xs opacity-75">{description}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`${label}: ${settings[key] ? "On" : "Off"}`}
                    aria-pressed={settings[key]}
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        [key]: !current[key],
                      }))
                    }
                    className={cn(
                      "h-5 w-9 rounded-full bg-[#878a8c] p-0.5",
                      settings[key] && "bg-[#6aaa64]",
                    )}
                  >
                    <span
                      className={cn(
                        "block h-4 w-4 rounded-full bg-white transition-transform",
                        settings[key] && "translate-x-4",
                      )}
                    />
                  </button>
                </div>
              ))}
              <div className="pt-4 text-right text-sm">
                #{puzzle.id ?? "----"}
              </div>
            </div>
          </div>
        </BaseModal>
      )}
    </div>
  );
}
