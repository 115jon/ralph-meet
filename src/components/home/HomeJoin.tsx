import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FieldPlate, Input } from "@/components/ui/input";
import { useId } from "react";
import { DitherRule } from "@/components/ui/dither";
import { CONTAINER, DISPLAY_H2, INLINE_LINK, KICKER, LEDE } from "./ui";

export interface HomeJoinProps {
  room: string;
  onRoomChange: (value: string) => void;
  onJoin: (event: React.FormEvent) => void;
  onStartRoom: () => void;
}

/**
 * The close: the poster's dithered rule again, a Bricolage head and lede
 * on the left, and a legend-plate code field with the notched Join key on
 * the right.
 */
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
      className="scroll-mt-16 pb-20 lg:pb-32"
    >
      <div className={CONTAINER}>
        <DitherRule cell={3} className="h-3 md:h-5" />
      </div>
      <div
        className={`${CONTAINER} grid gap-10 pt-14 md:grid-cols-12 md:items-end md:gap-8 lg:pt-20`}
      >
        <div className="md:col-span-6">
          <p className={KICKER}>Join a room</p>
          <h2
            id="home-join-title"
            className={`${DISPLAY_H2} mt-3 max-w-[12ch]`}
          >
            Got a code?
          </h2>
          <p id={helpId} className={`${LEDE} mt-6 max-w-[36ch]`}>
            Paste the code or link someone sent you. No account needed.
          </p>
        </div>

        <div className="md:col-span-5 md:col-start-8">
          <form
            onSubmit={onJoin}
            className="flex w-full flex-col gap-3 sm:flex-row sm:items-end"
          >
            <FieldPlate
              label="Room code or link"
              htmlFor={fieldId}
              className="min-w-0 sm:flex-1"
            >
              <Input
                id={fieldId}
                type="text"
                name="room"
                inputSize="lg"
                value={room}
                onChange={(event) => onRoomChange(event.target.value)}
                placeholder="hazy-river-4k2"
                aria-describedby={helpId}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="none"
                inputMode="text"
                enterKeyHint="go"
              />
            </FieldPlate>
            <Button type="submit" size="lg" disabled={!canJoin}>
              Join room
              <Icon name="arrowRight" size="sm" />
            </Button>
          </form>

          <p className="mt-5 text-ui-sm text-ink-2">
            No code?{" "}
            <button type="button" onClick={onStartRoom} className={INLINE_LINK}>
              Start a new room
            </button>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
