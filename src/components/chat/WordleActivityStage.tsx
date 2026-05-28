import { getAuthAssetUrl } from "@/lib/platform";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import { BarChart3, CircleHelp, Delete, Lightbulb, Settings, Share2, UserPlus, X } from "lucide-react";
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
  source: "nyt" | "fallback";
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const FALLBACK: Puzzle = {
  id: null,
  print_date: new Date().toISOString().slice(0, 10),
  solution: "crane",
  editor: "Ralph Meet",
  source: "fallback",
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readStoredProgress(key: string): { guesses: string[]; progress: Record<string, Progress> } {
  if (typeof window === "undefined") return { guesses: [], progress: {} };
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{\"guesses\":[],\"progress\":{}}");
    return {
      guesses: normalizeGuesses(parsed.guesses),
      progress: normalizeProgress(parsed.progress),
    };
  } catch {
    return { guesses: [], progress: {} };
  }
}

function normalizeGuesses(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((guess): guess is string => typeof guess === "string") : [];
}

function normalizeProgress(value: unknown): Record<string, Progress> {
  if (!value || typeof value !== "object") return {};
  const normalized: Record<string, Progress> = {};
  for (const [userId, raw] of Object.entries(value as Record<string, any>)) {
    normalized[userId] = {
      userId,
      name: typeof raw?.name === "string" ? raw.name : "Player",
      avatar: typeof raw?.avatar === "string" ? raw.avatar : null,
      guesses: normalizeGuesses(raw?.guesses),
      streak: typeof raw?.streak === "number" ? raw.streak : 0,
      finished: typeof raw?.finished === "boolean" ? raw.finished : raw?.status === "solved" || raw?.status === "missed",
      missed: typeof raw?.missed === "boolean" ? raw.missed : raw?.status === "missed",
    };
  }
  return normalized;
}

function evaluateGuess(guess: string, answer: string) {
  const result = Array(5).fill("absent") as Array<"correct" | "present" | "absent">;
  const remaining = answer.split("");
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) {
      result[i] = "correct";
      remaining[i] = "";
    }
  }
  for (let i = 0; i < 5; i++) {
    if (result[i] === "correct") continue;
    const found = remaining.indexOf(guess[i]);
    if (found >= 0) {
      result[i] = "present";
      remaining[found] = "";
    }
  }
  return result;
}

function MiniBoard({ guesses, answer }: { guesses: string[]; answer: string }) {
  return (
    <div className="grid grid-cols-5 gap-[2px]">
      {Array.from({ length: 30 }).map((_, index) => {
        const row = Math.floor(index / 5);
        const col = index % 5;
        const guess = guesses[row] ?? "";
        const mark = guess ? evaluateGuess(guess, answer)[col] : null;
        return (
          <div
            key={index}
            className={cn(
              "h-2.5 w-2.5 border border-[#d3d6da]",
              mark === "correct" && "border-[#6aaa64] bg-[#6aaa64]",
              mark === "present" && "border-[#c9b458] bg-[#c9b458]",
              mark === "absent" && "border-[#787c7e] bg-[#787c7e]"
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
  const [puzzle, setPuzzle] = useState<Puzzle>(FALLBACK);
  const storageKey = `voice-wordle:${channelId}:${todayKey()}`;
  const initialStored = useMemo(() => readStoredProgress(storageKey), [storageKey]);
  const [guesses, setGuesses] = useState<string[]>(() => initialStored.guesses);
  const [draft, setDraft] = useState("");
  const [progress, setProgress] = useState<Record<string, Progress>>(() => initialStored.progress);
  const [view, setView] = useState<"puzzle" | "done" | "stats">("puzzle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [settings, setSettings] = useState({
    hardMode: false,
    darkTheme: false,
    highContrast: false,
    keyboardOnly: false,
    remindersMuted: false,
  });

  useEffect(() => {
    fetch("/api/wordle/today")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (typeof data?.solution === "string" && data.solution.length === 5) {
          setPuzzle(data as Puzzle);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!sfu) return;
    return sfu.on("app-event", (event) => {
      if (event.type !== "wordle.progress" || event.channel_id !== channelId) return;
      setProgress(normalizeProgress(event.progress));
    });
  }, [sfu, channelId]);

  const answer = puzzle.solution.toLowerCase();
  const localFinished = guesses.includes(answer) || guesses.length >= 6;
  const rowProgress = useMemo(() => {
    return participants
      .filter((participant) => participant.userId !== localUserId)
      .map((participant) => progress[participant.userId] ?? {
        userId: participant.userId,
        name: participant.name,
        avatar: participant.avatar,
        guesses: [],
        streak: 0,
        finished: false,
        missed: false,
      });
  }, [participants, progress, localUserId]);

  const keyMarks = useMemo(() => {
    const marks: Record<string, "correct" | "present" | "absent"> = {};
    const rank = { absent: 0, present: 1, correct: 2 };
    for (const guess of guesses) {
      evaluateGuess(guess, answer).forEach((mark, index) => {
        const letter = guess[index];
        if (!marks[letter] || rank[mark] > rank[marks[letter]]) marks[letter] = mark;
      });
    }
    return marks;
  }, [guesses, answer]);

  const commitProgress = (nextGuesses: string[]) => {
    if (!localUserId) return;
    const solved = nextGuesses.includes(answer);
    const missed = !solved && nextGuesses.length >= 6;
    const current = progress[localUserId];
    const local = participants.find((p) => p.userId === localUserId);
    const nextProgress = {
      ...progress,
      [localUserId]: {
        userId: localUserId,
        name: local?.name ?? "You",
        avatar: local?.avatar,
        guesses: nextGuesses,
        streak: solved ? Math.max(1, current?.finished ? current.streak : (current?.streak ?? 0) + 1) : missed ? 0 : (current?.streak ?? 0),
        finished: solved || missed,
        missed,
      },
    };
    setProgress(nextProgress);
    localStorage.setItem(storageKey, JSON.stringify({ guesses: nextGuesses, progress: nextProgress }));
    sfu?.voiceGW.sendAppEvent({ type: "wordle.progress", channel_id: channelId, progress: nextProgress });
    if (solved || missed) setView("done");
  };

  const submitGuess = () => {
    const guess = draft.toLowerCase();
    if (guess.length !== 5 || guesses.length >= 6 || localFinished) return;
    const nextGuesses = [...guesses, guess];
    setGuesses(nextGuesses);
    setDraft("");
    commitProgress(nextGuesses);
  };

  const addLetter = (letter: string) => {
    if (localFinished) return;
    setDraft((value) => `${value}${letter}`.slice(0, 5));
  };

  const deleteLetter = () => setDraft((value) => value.slice(0, -1));

  const solvedCount = rowProgress.filter((row) => row.guesses.includes(answer)).length;
  const winRate = rowProgress.length ? Math.round((solvedCount / rowProgress.length) * 100) : 0;
  const currentStreak = progress[localUserId || ""]?.streak ?? 0;
  const firstLetterHint = answer[0]?.toUpperCase() ?? "";
  const vowelCount = answer.split("").filter((letter) => "aeiou".includes(letter)).length;
  const theme = settings.darkTheme ? {
    page: "bg-[#121213] text-white",
    border: "border-[#3a3a3c]",
    icon: "text-white/90",
    key: "bg-[#818384] text-white",
    emptyTile: "border-[#3a3a3c]",
    modal: "bg-[#121213] text-white",
    overlay: "bg-black/55",
  } : {
    page: "bg-white text-black",
    border: "border-[#d3d6da]",
    icon: "text-black/85",
    key: "bg-[#d3d6da] text-black",
    emptyTile: "border-[#d3d6da]",
    modal: "bg-white text-black",
    overlay: "bg-white/55",
  };

  if (view === "done") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#e6e4e1] px-4 text-black" style={{ fontFamily: "Georgia, serif" }}>
        <MiniBoard guesses={guesses} answer={answer} />
        <div className="mt-2 text-sm font-bold">Wordle</div>
        <h2 className="mt-4 text-4xl font-black">Hi Wordler</h2>
        <p className="mt-4 max-w-sm text-center text-3xl leading-tight">Great job on today's puzzle! Check out your channel's progress.</p>
        <button onClick={() => setView("stats")} className="mt-8 rounded-full bg-black px-16 py-4 text-base font-bold text-white">Channel Stats</button>
        <div className="mt-9 text-center text-base">
          <div>{new Date(`${puzzle.print_date}T00:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
          <div>No. {puzzle.id ?? "----"}</div>
          <div className="text-sm">Edited by {puzzle.editor ?? "The New York Times"}</div>
        </div>
        <div className="mt-20 text-2xl font-black">The New York Times Games</div>
      </div>
    );
  }

  if (view === "stats") {
    const local = progress[localUserId || ""];
    return (
      <div className={cn("relative flex h-full w-full items-center justify-center overflow-y-auto p-4", theme.page)}>
        <button onClick={() => setView("puzzle")} className="absolute right-5 top-5 flex items-center gap-2 text-base">Back to puzzle <X size={18} /></button>
        <div className="w-full max-w-[380px] text-center">
          <div className="mx-auto flex w-[102px] flex-col items-center rounded-xl border-2 border-current p-3">
            <div className="h-16 w-16 overflow-hidden rounded-full bg-[#d9d9d9]">
              {local?.avatar ? <img src={getAuthAssetUrl(local.avatar)} alt="" className="h-16 w-16 rounded-full object-cover" /> : <div className="h-16 w-16 rounded-full bg-[#6aaa64]" />}
            </div>
            <div className="mt-2"><MiniBoard guesses={guesses} answer={answer} /></div>
            <button className="mt-2 flex items-center gap-1 rounded-full bg-[#6aaa64] px-5 py-1 text-sm font-bold text-white">Share <Share2 size={13} /></button>
          </div>
          <h2 className="mt-8 text-base uppercase">General Statistics</h2>
          <div className="mt-3 flex justify-center divide-x divide-[#d3d6da]">
            <div className="px-4 sm:px-6"><div className="text-2xl font-bold">{winRate}%</div><div className="text-xs">Win Rate</div></div>
            <div className="px-4 sm:px-6"><div className="text-2xl font-bold">{currentStreak} Day</div><div className="text-xs">Current Streak</div></div>
            <div className="px-4 sm:px-6"><div className="text-2xl font-bold">{currentStreak} Days</div><div className="text-xs">Best Streak</div></div>
          </div>
          <p className="mt-8 text-base">For personal statistics, <a className="text-blue-600" href="https://www.nytimes.com/games/wordle/index.html" target="_blank" rel="noreferrer">play on NYTimes.com/Wordle</a></p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden", theme.page)}>
      <style>{`
        @keyframes rm-wordle-pop { 0% { transform: scale(.86); } 55% { transform: scale(1.08); } 100% { transform: scale(1); } }
        @keyframes rm-wordle-flip { 0% { transform: rotateX(0); } 45% { transform: rotateX(90deg); } 55% { transform: rotateX(90deg); } 100% { transform: rotateX(0); } }
      `}</style>
      <div className={cn("flex h-[52px] shrink-0 items-center justify-between border-b px-3 sm:px-5", theme.border)}>
        <div className="min-w-0 truncate text-lg font-black sm:text-2xl" style={{ fontFamily: "Georgia, serif" }}>The New York Times <span className="font-sans">Games</span></div>
        <div className={cn("flex shrink-0 items-center gap-3 sm:gap-6", theme.icon)}>
          <button onClick={() => setHintsOpen(true)} title="Hints"><Lightbulb size={26} /></button>
          <button onClick={() => setView("stats")} title="Stats"><BarChart3 size={28} /></button>
          <button onClick={() => setHintsOpen(true)} title="Answer"><CircleHelp size={28} /></button>
          <button onClick={() => setSettingsOpen(true)} title="Settings"><Settings size={30} /></button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto px-3 py-3 md:grid-cols-[170px_minmax(0,1fr)] md:overflow-hidden md:px-4">
        <aside className="order-2 mt-3 flex max-h-28 gap-3 overflow-x-auto md:order-1 md:mt-0 md:max-h-none md:flex-col md:overflow-y-auto md:overflow-x-hidden">
          <button className={cn("flex shrink-0 items-center gap-3 rounded-md border px-2 py-2 text-xs font-bold", theme.border)}>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#6aaa64] text-white"><UserPlus size={28} /></span>
            INVITE<br />FRIENDS
          </button>
          <div className="flex gap-3 md:mt-4 md:flex-col">
            {rowProgress.map((row) => (
              <div key={row.userId} className="flex shrink-0 items-center gap-2">
                {row.avatar ? <img src={getAuthAssetUrl(row.avatar)} alt="" className="h-9 w-9 rounded-full object-cover" /> : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#6aaa64] text-xs font-bold text-white">{row.name[0]}</div>}
                <MiniBoard guesses={row.guesses} answer={answer} />
              </div>
            ))}
          </div>
        </aside>

        <main className="order-1 flex min-h-[500px] min-w-0 flex-col items-center justify-center gap-4 md:order-2 md:min-h-0 md:gap-5">
          <div className="grid w-[min(300px,calc(100vw-32px))] grid-cols-5 gap-[5px]">
            {Array.from({ length: 30 }).map((_, index) => {
              const row = Math.floor(index / 5);
              const col = index % 5;
              const guess = guesses[row] ?? (row === guesses.length ? draft : "");
              const letter = guess[col] ?? "";
              const mark = guesses[row] ? evaluateGuess(guesses[row], answer)[col] : null;
              return (
                <div
                  key={index}
                  style={{
                    animation: guesses[row]
                      ? `rm-wordle-flip 520ms ease both ${col * 120}ms`
                      : letter
                        ? "rm-wordle-pop 110ms ease-out"
                        : undefined,
                  }}
                  className={cn(
                    "flex aspect-square w-full items-center justify-center border-2 text-3xl font-black uppercase [backface-visibility:hidden]",
                    !mark && theme.emptyTile,
                    mark === "correct" && "border-[#6aaa64] bg-[#6aaa64] text-white",
                    mark === "present" && "border-[#c9b458] bg-[#c9b458] text-white",
                    mark === "absent" && "border-[#787c7e] bg-[#787c7e] text-white"
                  )}
                >
                  {letter}
                </div>
              );
            })}
          </div>

          <div className="w-full max-w-[470px] space-y-2 px-1">
            {KEY_ROWS.map((row, rowIndex) => (
              <div key={row} className="flex justify-center gap-1.5">
                {rowIndex === 2 && <button onClick={submitGuess} className={cn("h-12 rounded px-3 text-xs font-bold sm:h-[52px]", theme.key)}>ENTER</button>}
                {row.split("").map((letter) => {
                  const mark = keyMarks[letter];
                  return (
                    <button
                      key={letter}
                      onClick={() => addLetter(letter)}
                      className={cn(
                        "h-12 min-w-0 flex-1 rounded px-1 text-sm font-bold uppercase sm:h-[52px] sm:min-w-10 sm:flex-none sm:px-2",
                        theme.key,
                        mark === "correct" && "bg-[#6aaa64] text-white",
                        mark === "present" && "bg-[#c9b458] text-white",
                        mark === "absent" && "bg-[#787c7e] text-white"
                      )}
                    >
                      {letter}
                    </button>
                  );
                })}
                {rowIndex === 2 && <button onClick={deleteLetter} className={cn("flex h-12 items-center rounded px-3 text-xs font-bold sm:h-[52px]", theme.key)}><Delete size={20} /></button>}
              </div>
            ))}
          </div>
        </main>
      </div>

      {hintsOpen && (
        <div className={cn("absolute inset-0 z-10 flex items-center justify-center p-4", theme.overlay)}>
          <div className={cn("w-full max-w-md rounded-lg p-5 shadow-2xl", theme.modal)}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-black uppercase">Today&apos;s Puzzle</h2>
              <button onClick={() => setHintsOpen(false)}><X size={26} /></button>
            </div>
            <div className="space-y-3 text-sm">
              <div className={cn("rounded-md border p-3", theme.border)}>No. {puzzle.id ?? "----"} for {puzzle.print_date}</div>
              <div className={cn("rounded-md border p-3", theme.border)}>First letter: <span className="font-black">{firstLetterHint}</span></div>
              <div className={cn("rounded-md border p-3", theme.border)}>Vowels: <span className="font-black">{vowelCount}</span></div>
              <details className={cn("rounded-md border p-3", theme.border)}>
                <summary className="cursor-pointer font-bold">Reveal answer</summary>
                <div className="mt-3 text-3xl font-black uppercase tracking-[0.2em]">{answer}</div>
              </details>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className={cn("absolute inset-0 z-10 flex items-center justify-center p-4", theme.overlay)}>
          <div className={cn("w-full max-w-[500px] rounded-lg p-4 shadow-2xl", theme.modal)}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex-1 text-center text-base font-black uppercase">Settings</h2>
              <button onClick={() => setSettingsOpen(false)}><X size={28} /></button>
            </div>
            {[
              ["hardMode", "Hard Mode", "Any revealed hints must be used in subsequent guesses"],
              ["darkTheme", "Dark Theme", ""],
              ["highContrast", "High Contrast Mode", "Contrast and colorblindness improvements"],
              ["keyboardOnly", "Onscreen Keyboard Input Only", "Ignore key input except from the onscreen keyboard."],
              ["remindersMuted", "Mute Daily Reminders", "Don't send a notification when new puzzles are available."],
            ].map(([key, label, description]) => (
              <div key={key} className={cn("flex items-center justify-between border-b py-4", theme.border)}>
                <div><div className="text-lg">{label}</div>{description && <div className="text-xs opacity-75">{description}</div>}</div>
                <button onClick={() => setSettings((current) => ({ ...current, [key]: !current[key as keyof typeof current] }))} className={cn("h-5 w-9 rounded-full bg-[#878a8c] p-0.5", settings[key as keyof typeof settings] && "bg-[#6aaa64]")}>
                  <span className={cn("block h-4 w-4 rounded-full bg-white transition-transform", settings[key as keyof typeof settings] && "translate-x-4")} />
                </button>
              </div>
            ))}
            <div className="pt-4 text-right text-sm">#{puzzle.id ?? "----"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
