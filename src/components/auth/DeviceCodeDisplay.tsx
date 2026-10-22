import { Copy } from "lucide-react";
import { CopyMorphIcon } from "./CopyMorphIcon";
import { useCopyFeedback } from "./use-copy-feedback";
import { splitUserCode, spellUserCode } from "./user-code";
import { iconButton } from "./device-login-styles";

export function DeviceCodeDisplay({ userCode }: { userCode: string }) {
  const groups = splitUserCode(userCode);
  const { status, copy } = useCopyFeedback();
  const copied = status === "copied";

  return (
    <div className="flex w-full items-center gap-2 rounded-2xl border border-rm-border bg-rm-bg-elevated py-3 pl-5 pr-2">
      <p className="flex-1 text-center">
        <span className="sr-only">Your code is {spellUserCode(userCode)}</span>
        <span
          aria-hidden="true"
          data-testid="device-user-code"
          className="inline-flex select-text items-center gap-3 font-mono text-[28px] font-semibold leading-none tracking-[0.16em] text-rm-text tabular-nums"
        >
          {groups.map((group, index) => (
            <span key={index} className="inline-flex items-center gap-3">
              {index > 0 && (
                <span className="h-[2px] w-3 rounded-full bg-rm-text-ghost" />
              )}
              <span>{group}</span>
            </span>
          ))}
        </span>
      </p>
      <button
        type="button"
        onClick={() => void copy(userCode)}
        className={iconButton}
        aria-label={copied ? "Code copied" : "Copy code"}
        title={copied ? "Copied" : "Copy code"}
      >
        <CopyMorphIcon copied={copied} icon={Copy} />
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Code copied" : status === "failed" ? "Couldn't copy" : ""}
      </span>
    </div>
  );
}
