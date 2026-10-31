import {
  PublicBody,
  PublicFrame,
  PublicKicker,
  PublicTitle,
} from "@/components/auth/PublicFrame";
import { RoomConnecting } from "@/components/RoomConnecting";
import {
  LazyRoomVoiceView,
  preloadRoomVoiceView,
} from "@/components/lazy-room-voice";
import { Button } from "@/components/ui/button";
import { FieldPlate, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { getRoomPreflightWarnings } from "@/lib/room-preflight";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Suspense, useEffect, useId, useRef, useState } from "react";

export { RoomConnecting };

export default function RoomPageClient() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate();

  // Guest name state — stored in sessionStorage for persistence across refreshes
  const [guestState, setGuestState] = useState({
    name: "",
    submitted: false,
  });
  const [preflightWarnings, setPreflightWarnings] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let t: NodeJS.Timeout;
    const stored = sessionStorage.getItem("room-guest-name");
    if (stored) {
      preloadRoomVoiceView();
      t = setTimeout(() => {
        setGuestState({ name: stored, submitted: true });
      }, 0);
    } else {
      inputRef.current?.focus();
    }
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkRoomDevices() {
      try {
        const devices = await navigator.mediaDevices?.enumerateDevices?.();
        if (!cancelled && devices) {
          setPreflightWarnings(getRoomPreflightWarnings(devices));
        }
      } catch {
        if (!cancelled) {
          setPreflightWarnings(["No microphone detected"]);
        }
      }
    }

    if (!guestState.submitted) {
      void checkRoomDevices();
    }

    return () => {
      cancelled = true;
    };
  }, [guestState.submitted]);

  const handleNameSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    const trimmed = guestState.name.trim();
    if (!trimmed) return;
    sessionStorage.setItem("room-guest-name", trimmed);
    setGuestState({ name: trimmed, submitted: true });
  };

  // ── Name entry screen ──────────────────────────────────────────────────

  if (!guestState.submitted) {
    return (
      <RoomJoinForm
        slug={slug}
        name={guestState.name}
        onNameChange={(name) => {
          if (name.trim()) preloadRoomVoiceView();
          setGuestState({ ...guestState, name });
        }}
        onSubmit={handleNameSubmit}
        warnings={preflightWarnings}
        inputRef={inputRef}
      />
    );
  }

  // ── Voice room (after name submitted) ──────────────────────────────────

  return (
    <Suspense fallback={<RoomConnecting slug={slug} />}>
      <LazyRoomVoiceView
        slug={slug}
        guestName={guestState.name}
        onLeaveToHome={() => navigate({ to: "/" })}
        onSignIn={() => navigate({ to: "/sign-in" })}
      />
    </Suspense>
  );
}

/** Guest name entry before joining a room (exported for the UI fixtures). */
export function RoomJoinForm({
  slug,
  name,
  onNameChange,
  onSubmit,
  warnings,
  inputRef,
}: {
  slug: string;
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: (e: React.SubmitEvent) => void;
  warnings: string[];
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const nameId = useId();
  return (
    <PublicFrame>
      <PublicKicker>Meeting room</PublicKicker>
      <PublicTitle size="display" className="break-words">
        Join {slug}
      </PublicTitle>
      <PublicBody size="lead">Pick the name the room will see.</PublicBody>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        {warnings.length > 0 && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-[2px] bg-warning-tint px-3 py-3 text-ui-sm text-warning-ink"
          >
            <Icon name="warning" size="sm" className="mt-0.5 shrink-0" />
            <span className="text-pretty">
              {warnings[0]}. You can still join, then check input settings from
              the call controls.
            </span>
          </div>
        )}
        <FieldPlate label="Your name" htmlFor={nameId}>
          <Input
            ref={inputRef}
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Ada Lovelace"
            inputSize="lg"
            className="pointer-coarse:min-h-11"
            autoComplete="name"
            required
          />
        </FieldPlate>
        <Button
          type="submit"
          size="lg"
          disabled={!name.trim()}
          className="w-full"
        >
          Join
        </Button>
      </form>
    </PublicFrame>
  );
}
