import { Icon } from "@/components/ui/icon";
import { DISABLED } from "@/components/ui/interaction";
import { useId } from "react";
import { CONTAINER, CTA_PRIMARY, INLINE_LINK } from "./ui";

export interface HomeJoinProps {
  room: string;
  onRoomChange: (value: string) => void;
  onJoin: (event: React.FormEvent) => void;
  onStartRoom: () => void;
}

/** The close: a code field at poster scale. */
export function HomeJoin({
  room,
  onRoomChange,
  onJoin,
  onStartRoom,
}: HomeJoinProps) {
  const fieldId = useId();
  const helpId = useId();
  const canJoin = room.trim().length > 0;

  return (
    <section
      id="join"
      aria-labelledby="home-join-title"
      className="scroll-mt-16 border-t border-rm-border py-24 lg:py-40"
    >
      <div className={`${CONTAINER} flex flex-col items-center text-center`}>
        <h2
          id="home-join-title"
          data-reveal
          className="rm-home-h1 max-w-[12ch] text-balance font-display text-rm-text"
        >
          Got a code?
        </h2>
        <p
          id={helpId}
          data-reveal
          data-reveal-delay="60"
          className="rm-home-lede mt-6 max-w-[36ch] text-pretty text-rm-text-secondary"
        >
          Paste the code or link someone sent you. No account needed.
        </p>

        <form
          data-reveal
          data-reveal-delay="120"
          onSubmit={onJoin}
          className="mt-10 flex w-full max-w-[520px] flex-col gap-2 md:flex-row"
        >
          <label htmlFor={fieldId} className="sr-only">
            Room code or link
          </label>
          <input
            id={fieldId}
            type="text"
            name="room"
            value={room}
            onChange={(event) => onRoomChange(event.target.value)}
            placeholder="hazy-river-4k2"
            aria-describedby={helpId}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
            inputMode="text"
            enterKeyHint="go"
            className="h-12 min-w-0 flex-1 rounded-md border border-rm-field-edge bg-rm-bg-surface px-4 text-ui-md text-rm-text outline-none transition-colors duration-150 ease-(--rm-ease-out) placeholder:text-rm-text-muted focus-visible:border-rm-accent-ink"
          />
          <button
            type="submit"
            disabled={!canJoin}
            className={`${CTA_PRIMARY} ${DISABLED} h-12`}
          >
            Join room
            <Icon name="arrowRight" size="sm" />
          </button>
        </form>

        <p
          data-reveal
          data-reveal-delay="180"
          className="mt-6 text-ui-sm text-rm-text-secondary"
        >
          No code?{" "}
          <button type="button" onClick={onStartRoom} className={INLINE_LINK}>
            Start a new room
          </button>
          .
        </p>
      </div>
    </section>
  );
}
