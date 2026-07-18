import { WORDLE_ALLOWED_WORDS } from "./wordle-allowed-words";

export type WordleCompletionStatus = "playing" | "solved" | "missed";

export interface WordleCompletion {
  status: WordleCompletionStatus;
  finalGuessIndex: number | null;
}

export interface WordleHint {
  kind: "first-letter" | "vowels" | "position";
  title: string;
  value: string;
  position?: number;
}

export type WordleMark = "correct" | "present" | "absent";

const WORD_LENGTH = 5;
const FLIP_DURATION_MS = 520;
const TILE_STAGGER_MS = 120;
const COMPLETION_PAUSE_MS = 120;

export function isValidWordleGuess(guess: string, answer?: string): boolean {
  if (!/^[a-z]{5}$/.test(guess)) return false;
  return guess === answer || WORDLE_ALLOWED_WORDS.has(guess);
}

export function evaluateWordleGuess(
  guess: string,
  answer: string,
): WordleMark[] {
  const result: WordleMark[] = Array(WORD_LENGTH).fill("absent");
  const remainingCounts = new Map<string, number>();
  const normalizedGuess = guess.toLowerCase();
  const normalizedAnswer = answer.toLowerCase();

  for (let index = 0; index < WORD_LENGTH; index++) {
    if (normalizedGuess[index] === normalizedAnswer[index]) {
      result[index] = "correct";
    } else {
      const letter = normalizedAnswer[index];
      if (letter) {
        remainingCounts.set(letter, (remainingCounts.get(letter) ?? 0) + 1);
      }
    }
  }

  for (let index = 0; index < WORD_LENGTH; index++) {
    if (result[index] === "correct") continue;
    const letter = normalizedGuess[index];
    if (!letter) continue;
    const remainingCount = remainingCounts.get(letter) ?? 0;
    if (remainingCount > 0) {
      result[index] = "present";
      remainingCounts.set(letter, remainingCount - 1);
    }
  }

  return result;
}

export function getHardModeViolation(
  guess: string,
  guesses: string[],
  answer: string,
): string | null {
  const requiredCounts = new Map<string, number>();
  const forbiddenPositions = new Map<string, Set<number>>();

  for (const previousGuess of guesses) {
    const marks = evaluateWordleGuess(previousGuess, answer);
    const revealedCounts = new Map<string, number>();

    for (let index = 0; index < marks.length; index++) {
      const letter = previousGuess[index]?.toLowerCase();
      if (!letter) continue;

      if (marks[index] === "correct") {
        if (guess[index]?.toLowerCase() !== letter) {
          return `${letter.toUpperCase()} must stay in position ${index + 1}.`;
        }
        revealedCounts.set(letter, (revealedCounts.get(letter) ?? 0) + 1);
      } else if (marks[index] === "present") {
        revealedCounts.set(letter, (revealedCounts.get(letter) ?? 0) + 1);
        const positions = forbiddenPositions.get(letter) ?? new Set<number>();
        positions.add(index);
        forbiddenPositions.set(letter, positions);
      }
    }

    for (const [letter, count] of revealedCounts) {
      requiredCounts.set(
        letter,
        Math.max(requiredCounts.get(letter) ?? 0, count),
      );
    }
  }

  const guessCounts = new Map<string, number>();
  for (const letter of guess.toLowerCase()) {
    guessCounts.set(letter, (guessCounts.get(letter) ?? 0) + 1);
  }

  for (const [letter, requiredCount] of requiredCounts) {
    const actualCount = guessCounts.get(letter) ?? 0;
    if (actualCount < requiredCount) {
      return requiredCount === 1
        ? `${letter.toUpperCase()} must be used.`
        : `${letter.toUpperCase()} must be used ${requiredCount} times.`;
    }
  }

  for (const [letter, positions] of forbiddenPositions) {
    for (const position of positions) {
      if (guess[position]?.toLowerCase() === letter) {
        return `${letter.toUpperCase()} cannot be used in position ${position + 1}.`;
      }
    }
  }

  return null;
}

export function getCompletionStatus(
  guesses: string[],
  answer: string,
): WordleCompletion {
  const normalizedAnswer = answer.toLowerCase();
  const solvedIndex = guesses.findIndex(
    (guess) => guess.toLowerCase() === normalizedAnswer,
  );

  if (solvedIndex >= 0) {
    return { status: "solved", finalGuessIndex: solvedIndex };
  }

  if (guesses.length >= 6) {
    return { status: "missed", finalGuessIndex: 5 };
  }

  return { status: "playing", finalGuessIndex: null };
}

export function shouldShowCompletionResult(input: {
  status: WordleCompletionStatus;
  revealing: boolean;
}): boolean {
  return input.status !== "playing" && !input.revealing;
}

export function getRevealDuration(
  wordLength = WORD_LENGTH,
  flipDuration = FLIP_DURATION_MS,
  tileStagger = TILE_STAGGER_MS,
): number {
  return (
    flipDuration +
    Math.max(0, wordLength - 1) * tileStagger +
    COMPLETION_PAUSE_MS
  );
}

export function getHintDetails(
  answer: string,
  level: number,
): WordleHint | null {
  const normalizedAnswer = answer.toLowerCase();
  if (!normalizedAnswer || level < 1 || level > 3) return null;

  if (level === 1) {
    return {
      kind: "first-letter",
      title: "Start here",
      value: normalizedAnswer[0]?.toUpperCase() ?? "",
    };
  }

  if (level === 2) {
    const vowelCount = normalizedAnswer
      .split("")
      .filter((letter) => "aeiou".includes(letter)).length;
    return {
      kind: "vowels",
      title: "Vowel count",
      value: String(vowelCount),
    };
  }

  const position = Math.min(1, normalizedAnswer.length - 1);
  return {
    kind: "position",
    title: "A letter in place",
    value: normalizedAnswer[position]?.toUpperCase() ?? "",
    position: position + 1,
  };
}
