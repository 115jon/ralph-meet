import { HIT, PRESS, DISABLED } from "@/components/ui/interaction";
import { CopyMorphIcon } from "./CopyMorphIcon";
import { useCopyFeedback } from "./use-copy-feedback";
import { splitUserCode, spellUserCode } from "./user-code";

/**
 * The one device-code display. The desktop "Check your browser" screen and
 * the browser's approval screen render the same recipe (Geist Mono 28/32 at
 * 600, 0.12em tracking, a 12px dash between groups) so a person can match
 * them by eye. `readOnly` drops the copy button (the approval side).
 */
export function DeviceCodeDisplay({
  userCode,
  readOnly = false,
  srPrefix = "Your code is ",
}: {
  userCode: string;
  readOnly?: boolean;
  /** What the screen reader hears before the spelled code. */
  srPrefix?: string;
}) {
  const groups = splitUserCode(userCode);
  const { status, copy } = useCopyFeedback();
  const copied = status === "copied";

  return (
    <div
      className={`flex min-h-16 w-full items-center gap-2 rounded-[2px] border border-line-strong bg-ply-2 py-3 ${
        readOnly ? "px-4" : "pr-2 pl-4"
      }`}
    >
      <p className={`flex-1 text-center ${readOnly ? "" : "pl-10"}`}>
        <span className="sr-only">
          {srPrefix}
          {spellUserCode(userCode)}
        </span>
        <span
          aria-hidden="true"
          data-testid="device-user-code"
          className="inline-flex items-center gap-3 font-silk text-[28px] leading-none font-semibold tracking-[0.04em] text-ink-1 tabular-nums [font-stretch:100%] select-text"
        >
          {groups.map((group, index) => (
            <span key={index} className="inline-flex items-center gap-3">
              {index > 0 && <span className="h-0.5 w-3 bg-ink-3" />}
              <span>{group}</span>
            </span>
          ))}
        </span>
      </p>
      {readOnly ? null : (
        <>
          {/* An IconButton can't host the check morph, so this is the same
              recipe by hand: 40px, ghost ink, PRESS + HIT. */}
          <button
            type="button"
            onClick={() => void copy(userCode)}
            className={`inline-flex size-10 shrink-0 items-center justify-center rounded-[2px] text-ink-2 outline-none pointer-fine:hover:text-ink-1 ${PRESS} ${HIT} ${DISABLED}`}
            aria-label={copied ? "Code copied" : "Copy code"}
            title={copied ? "Copied" : "Copy code"}
          >
            <CopyMorphIcon copied={copied} icon="copy" size="lg" />
          </button>
          <span className="sr-only" role="status" aria-live="polite">
            {copied
              ? "Code copied"
              : status === "failed"
                ? "Couldn't copy"
                : ""}
          </span>
        </>
      )}
    </div>
  );
}
