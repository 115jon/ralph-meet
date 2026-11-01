import { describeCallRecord, type CallRecord } from "@ralph/protocol";

import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
import { getDisplayName } from "@/lib/display-name";
import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";

import { useMessageTimeFormat } from "./message-time";

/**
 * A DM call record (`type: "call"`): a system row in the timeline, not a
 * bubble. Missed calls take the danger glyph; ended calls show their length
 * in the number face.
 */
export function CallRecordRow({
  message,
  call,
  currentUserId,
}: {
  message: Message;
  call: CallRecord;
  currentUserId?: string;
}) {
  const time = useMessageTimeFormat();
  const recipient = useChatStore(
    (s) => s.dmChannels.find((dm) => dm.id === message.channel_id)?.recipient,
  );
  const callerName = getDisplayName(message.author, "Someone");
  const calleeName =
    call.callee_id === recipient?.id
      ? getDisplayName(recipient, "them")
      : "them";
  const line = describeCallRecord(call, currentUserId, {
    callerName,
    calleeName,
  });

  return (
    <div
      id={`message-${message.id}`}
      data-call-outcome={call.outcome}
      className="mt-2 flex items-center gap-3 px-4 py-1.5 text-ui-sm text-ink-2"
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center",
          line.tone === "missed" ? "text-danger-ink" : "text-ink-3",
        )}
      >
        <Icon name="call" size="sm" />
      </span>
      <span className="min-w-0 truncate">{line.text}</span>
      {line.duration ? <Num className="text-ink-3">{line.duration}</Num> : null}
      <Num className="ml-1 shrink-0 text-ink-3">
        {time.time(message.created_at)}
      </Num>
    </div>
  );
}
