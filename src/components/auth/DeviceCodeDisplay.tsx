import { HIT, PRESS, DISABLED } from "@/components/ui/interaction";
import { CopyMorphIcon } from "./CopyMorphIcon";
import { useCopyFeedback } from "./use-copy-feedback";
import { splitUserCode, spellUserCode } from "./user-code";

export function DeviceCodeDisplay({ userCode }: { userCode: string }) {
  const groups = splitUserCode(userCode);
  const { status, copy } = useCopyFeedback();
  const copied = status === "copied";

  return (
    <div className="flex w-full items-center gap-2 rounded-lg border border-rm-border bg-rm-bg-surface py-3 pr-2 pl-4">
      <p className="flex-1 text-center">
        <span className="sr-only">Your code is {spellUserCode(userCode)}</span>
        <span
          aria-hidden="true"
          data-testid="device-user-code"
          className="inline-flex select-text items-center gap-3 font-mono text-ui-2xl font-semibold tracking-[0.16em] text-rm-text tabular-nums"
        >
          {groups.map((group, index) => (
            <span key={index} className="inline-flex items-center gap-3">
              {index > 0 && (
                <span className="h-0.5 w-3 rounded-full bg-rm-text-muted" />
              )}
              <span>{group}</span>
            </span>
          ))}
        </span>
      </p>
      {/* An IconButton can't host the check morph, so this is the same
          recipe by hand: 40px, ghost ink, PRESS + HIT. */}
      <button
        type="button"
        onClick={() => void copy(userCode)}
        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-md text-rm-text-secondary outline-none pointer-fine:hover:text-rm-text ${PRESS} ${HIT} ${DISABLED}`}
        aria-label={copied ? "Code copied" : "Copy code"}
        title={copied ? "Copied" : "Copy code"}
      >
        <CopyMorphIcon copied={copied} icon="copy" size="lg" />
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Code copied" : status === "failed" ? "Couldn't copy" : ""}
      </span>
    </div>
  );
}
