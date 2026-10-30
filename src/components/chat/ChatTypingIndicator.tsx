import { useEffect, useState } from "react";

import { TypingDots } from "./TypingDots";

/**
 * The dots stop animating this long after the last typing event, even if the
 * name stays (see TypingDots for the single-SVG, reduced-motion and
 * inactive-app handling).
 */
const TYPING_ANIMATION_MS = 6000;

export function ChatTypingIndicator({
  typingUsers,
}: {
  typingUsers: string[];
}) {
  // Each typing event yields a new array from the store; the dots run until
  // six seconds pass without one.
  const [stoppedFor, setStoppedFor] = useState<string[] | null>(null);
  useEffect(() => {
    if (typingUsers.length === 0) return;
    const timer = setTimeout(
      () => setStoppedFor(typingUsers),
      TYPING_ANIMATION_MS,
    );
    return () => clearTimeout(timer);
  }, [typingUsers]);

  if (typingUsers.length === 0) return null;
  const animate = stoppedFor !== typingUsers;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none flex h-6 min-w-0 items-center gap-2 transition-opacity duration-(--dur-2) ease-out starting:opacity-0"
    >
      <TypingDots animate={animate} />
      <p className="truncate text-ui-xs text-ink-3">
        <span className="font-semibold text-ink-2">
          {typingUsers.length <= 3
            ? typingUsers.join(", ")
            : `${typingUsers.length} people`}
        </span>
        {typingUsers.length === 1 ? " is typing…" : " are typing…"}
      </p>
    </div>
  );
}
