/**
 * Mockups for the chat link's connection states (dev only).
 *
 *   /ui-fixtures?surface=connection-states&variant=a|b|c&state=<state>
 *
 * states: cold | brief | reconnecting | prolonged | offline | auth | back
 *
 *   A  Strip   one 32px LED strip under the column header for every state,
 *              cold load included (a still skeleton of the app behind it).
 *              Never blocks; the app stays readable and sends still go out.
 *   B  Plate   a floating LED plate over the composer. The cold load keeps
 *              a calm splash with a stepped readout; only an expired session
 *              blocks (a dialog plate).
 *   C  Poster  a quiet LED label in the column header while it retries; at
 *              30s, offline or signed out, a C poster covers the chat column
 *              (rail and tree stay usable) with a reason and one key.
 *
 * "brief" (a blip under 3s) shows nothing in every variant: that is the
 * point. Nothing here loops: LEDs are still, and B's cold load shows the
 * still, half-resolved dithered mark.
 */
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { GatewayConnectionBanner } from "@/components/chat/ConnectionBanner";
import { ConnectionOverlay } from "@/components/chat/ConnectionOverlay";
import { SplashScreen } from "@/components/SplashScreen";
import {
  ColdLoadScreen,
  type ColdError,
  type ColdStep,
} from "@/components/chat/ColdLoad";
import { useChatStore } from "@/stores/chat-store";

import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { Button } from "@/components/ui/button";
import { DitherRule, DitherWord } from "@/components/ui/dither";
import { Led, LedLabel, type LedState } from "@/components/ui/led";
import { Num } from "@/components/ui/num";
import { Skeleton } from "@/components/ui/skeleton";
import { DitherGlyph } from "@/components/ui/dither-glyph";
import { cn } from "@/lib/utils";

export type ConnectionVariant = "a" | "b" | "c";
export type ConnectionState =
  | "cold"
  | "brief"
  | "reconnecting"
  | "prolonged"
  | "offline"
  | "auth"
  | "back";

const STATES: ConnectionState[] = [
  "cold",
  "brief",
  "reconnecting",
  "prolonged",
  "offline",
  "auth",
  "back",
];

function param(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Desktop: under the 32px title bar and the 48px column header, right of rail + tree. */
const UNDER_HEADER = "absolute inset-x-0 top-12 md:top-20 md:left-[324px] z-30";
/** The chat column alone (rail and tree panel stay free). */
const CHAT_COLUMN =
  "absolute inset-x-0 bottom-0 top-12 md:top-20 md:left-[324px] z-30";

// ── Shared pieces ──────────────────────────────────────────────────────

/** The cold-load steps, as an instrument readout (no spinner, no tips). */
function StepReadout({ className }: { className?: string }) {
  const steps: { label: string; state: LedState; ink: string }[] = [
    { label: "Signed in", state: "talk", ink: "text-ink-2" },
    { label: "Opening chat", state: "idle", ink: "text-ink-1" },
    { label: "Loading messages", state: "off", ink: "text-ink-3" },
  ];
  return (
    <ol className={cn("flex flex-col gap-2", className)}>
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-3">
          <Num className="w-5 text-ink-3">{String(i + 1).padStart(2, "0")}</Num>
          <Led state={step.state} />
          <span className={cn("silkscreen", step.ink)}>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** A still skeleton of the app: what the cold load shows behind A's strip. */
function ColdShell({ children }: { children?: ReactNode }) {
  const rows = [72, 56, 64, 48, 80];
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-ply-0">
      <div className="hidden h-8 shrink-0 border-b border-line md:block" />
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[60px] shrink-0 flex-col items-center gap-2 pt-3 md:flex">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="size-10 rounded-[2px]" />
          ))}
        </div>
        <div className="hidden w-[264px] shrink-0 flex-col border-r border-line bg-ply-1 md:flex">
          <div className="flex h-12 items-center border-b border-line px-4">
            <Skeleton className="h-4 w-28 rounded-[2px]" />
          </div>
          <div className="flex flex-col gap-0.5 p-2 pt-4">
            <Skeleton className="mb-3 ml-2 h-3 w-24 rounded-[2px]" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex h-8 items-center gap-2 px-2">
                <Skeleton className="size-4 rounded-[2px]" />
                <Skeleton
                  className="h-3 rounded-[2px]"
                  style={{ width: rows[i]! + 24 }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
            <Skeleton className="size-5 rounded-[2px]" />
            <Skeleton className="h-4 w-32 rounded-[2px]" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-6 px-4 pb-4">
            {rows.map((w, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-10 shrink-0 rounded-[2px]" />
                <div className="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton className="h-3 w-24 rounded-[2px]" />
                  <Skeleton
                    className="h-3 rounded-[2px]"
                    style={{ width: `${w}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="shrink-0 px-4 pb-4">
            <div className="flex h-12 items-center rounded-[2px] border border-line bg-ply-2 px-4 text-ui-base text-ink-3">
              Message
            </div>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── A · Strip ──────────────────────────────────────────────────────────

type StripTone = "neutral" | "warning" | "danger" | "talk";

function Strip({
  tone,
  led,
  word,
  detail,
  readout,
  action,
}: {
  tone: StripTone;
  led: LedState;
  word: string;
  detail: string;
  readout?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-tone={tone}
      className={cn(
        "flex min-h-8 items-center gap-3 border-b border-line bg-ply-0 px-4 py-1",
        UNDER_HEADER,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0",
          tone === "danger"
            ? "bg-danger-tint"
            : tone === "warning"
              ? "bg-warning-tint"
              : tone === "talk"
                ? "bg-success-tint"
                : "bg-tint-1",
        )}
      />
      <LedLabel state={led} className="relative shrink-0">
        {word}
      </LedLabel>
      <span className="relative min-w-0 flex-1 truncate text-ui-xs text-ink-2 max-md:hidden">
        {detail}
      </span>
      <span className="relative min-w-0 flex-1 md:hidden" />
      {readout ? (
        <span className="relative shrink-0 text-ink-3 max-md:hidden">
          {readout}
        </span>
      ) : null}
      {action ? <span className="relative shrink-0">{action}</span> : null}
    </div>
  );
}

/** A's detail line moves under the strip on a phone (no room beside it). */
function StripDetailPhone({ children }: { children: ReactNode }) {
  return (
    <p className="absolute inset-x-0 top-20 z-30 border-b border-line bg-ply-0 px-4 py-2 text-ui-xs text-ink-2 md:hidden">
      {children}
    </p>
  );
}

function VariantA({
  state,
  shell,
}: {
  state: ConnectionState;
  shell: ReactNode;
}) {
  if (state === "cold") {
    return (
      <ColdShell>
        <Strip
          tone="neutral"
          led="idle"
          word="Connecting"
          detail="Opening the chat link. Your servers and messages load next."
          readout={
            <span className="silkscreen">
              Step <Num>2</Num>/<Num>3</Num>
            </span>
          }
        />
        <StripDetailPhone>
          Opening the chat link. Your servers and messages load next.
        </StripDetailPhone>
      </ColdShell>
    );
  }
  const strips: Partial<Record<ConnectionState, ReactNode>> = {
    reconnecting: (
      <Strip
        tone="warning"
        led="idle"
        word="Reconnecting"
        detail="The chat link dropped. You can keep reading and sending; new messages catch up when it's back."
        readout={
          <span className="silkscreen">
            Try <Num>3</Num> · next in <Num>4</Num>s
          </span>
        }
        action={
          <Button size="xs" variant="ghost">
            Retry now
          </Button>
        }
      />
    ),
    prolonged: (
      <Strip
        tone="danger"
        led="muted"
        word="No chat link"
        detail="No reply from the server for 42s. Messages you send are kept and go out when it's back."
        readout={
          <span className="silkscreen">
            Next try in <Num>30</Num>s
          </span>
        }
        action={
          <Button size="xs" variant="secondary">
            Retry
          </Button>
        }
      />
    ),
    offline: (
      <Strip
        tone="danger"
        led="off"
        word="Offline"
        detail="This device has no network. Ralph reconnects on its own when it's back."
      />
    ),
    auth: (
      <Strip
        tone="danger"
        led="muted"
        word="Signed out"
        detail="Your session expired, so chat can't connect. Everything you see is kept."
        action={
          <Button size="sm" variant="primary">
            Sign in
          </Button>
        }
      />
    ),
    back: (
      <Strip
        tone="talk"
        led="talk"
        word="Back online"
        detail="Caught up: 6 new messages."
      />
    ),
  };
  const phoneDetail: Partial<Record<ConnectionState, string>> = {
    reconnecting:
      "Try 3, next in 4s. Keep reading and sending; new messages catch up.",
    prolonged:
      "No reply for 42s; next try in 30s. Your messages are kept and go out later.",
    offline: "No network. Ralph reconnects on its own.",
    auth: "Your session expired. Everything you see is kept.",
  };
  return (
    <div className="relative h-full">
      {shell}
      {strips[state] ?? null}
      {phoneDetail[state] ? (
        <StripDetailPhone>{phoneDetail[state]}</StripDetailPhone>
      ) : null}
    </div>
  );
}

// ── B · Plate ──────────────────────────────────────────────────────────

function Plate({
  led,
  title,
  body,
  readout,
  action,
}: {
  led: LedState;
  title: string;
  body: string;
  readout?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[84px] z-30 flex justify-center px-3 md:left-[324px] md:px-4">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex w-full max-w-[520px] items-start gap-3 rounded-[2px] border border-line-strong bg-ply-3 p-3 pr-3 shadow-float"
      >
        <Led state={led} size={8} className="mt-1.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <p className="font-display text-[15px] leading-5 font-bold text-ink-1">
              {title}
            </p>
            {readout ? (
              <span className="silkscreen ml-auto shrink-0 text-ink-3">
                {readout}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-ui-sm text-pretty text-ink-2">{body}</p>
          {action ? <div className="mt-2.5 flex gap-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

function VariantB({
  state,
  shell,
}: {
  state: ConnectionState;
  shell: ReactNode;
}) {
  if (state === "cold") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-ply-0 px-6">
        <DitherGlyph motif="mark" size="md" pending />
        <div className="mt-8 flex items-center gap-2.5">
          <ThemeAwareSplashLogo alt="" className="size-7 object-contain" />
          <span className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-ink-1">
            Ralph Meet
          </span>
        </div>
        <StepReadout className="mt-8" />
        <p role="status" className="sr-only">
          Opening chat, step 2 of 3
        </p>
      </div>
    );
  }
  const plates: Partial<Record<ConnectionState, ReactNode>> = {
    reconnecting: (
      <Plate
        led="idle"
        title="Reconnecting"
        body="Keep reading and sending. New messages catch up when the link is back."
        readout={
          <>
            Try <Num>3</Num> · <Num>4</Num>s
          </>
        }
        action={
          <Button size="xs" variant="rule">
            Retry now
          </Button>
        }
      />
    ),
    prolonged: (
      <Plate
        led="muted"
        title="Can't reach chat"
        body="No reply from the server for 42s. What you send is kept and goes out when it's back."
        readout={
          <>
            Next <Num>30</Num>s
          </>
        }
        action={
          <Button size="sm" variant="secondary">
            Retry
          </Button>
        }
      />
    ),
    offline: (
      <Plate
        led="off"
        title="You're offline"
        body="Waiting for a network. Ralph reconnects on its own; nothing to do."
      />
    ),
    back: (
      <Plate led="talk" title="Back online" body="Caught up: 6 new messages." />
    ),
  };
  return (
    <div className="relative h-full">
      {shell}
      {plates[state] ?? null}
      {state === "auth" ? <AuthDialogPlate /> : null}
    </div>
  );
}

/** B's one blocking state: a C1 dialog plate (a bottom sheet on a phone). */
function AuthDialogPlate() {
  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center bg-scrim md:items-center">
      <div
        role="alertdialog"
        aria-labelledby="cs-auth-title"
        className="w-full rounded-t-[4px] border border-line-strong bg-ply-3 p-6 shadow-modal md:w-[440px] md:rounded-[2px]"
      >
        <p className="silkscreen text-ink-3">Session</p>
        <h2
          id="cs-auth-title"
          className="mt-3 font-display text-[28px] leading-8 font-extrabold tracking-[-0.03em] text-ink-1"
        >
          Sign in again
        </h2>
        <DitherRule className="mt-4" />
        <p className="mt-4 text-ui-base text-pretty text-ink-2">
          Your session on this device expired, so chat can't connect. Nothing is
          lost; sign in and you're back where you were.
        </p>
        <div className="mt-6 flex justify-end gap-2 max-md:flex-col-reverse">
          <Button size="lg" variant="ghost">
            Not now
          </Button>
          <Button size="lg" variant="primary">
            Sign in
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── C · Poster ─────────────────────────────────────────────────────────

/**
 * A quiet LED label in the column header while it retries: centred in the
 * desktop header, and in place of the "6 members" line on a phone.
 */
function HeaderLed({
  state,
  children,
}: {
  state: LedState;
  children: ReactNode;
}) {
  return (
    <>
      <div className="pointer-events-none absolute top-8 right-[256px] left-[324px] z-30 hidden h-12 items-center justify-center md:flex">
        <span
          role="status"
          className="inline-flex h-7 items-center rounded-[2px] border border-line-strong bg-ply-0 px-2.5"
        >
          <LedLabel state={state}>{children}</LedLabel>
        </span>
      </div>
      <div className="pointer-events-none absolute top-[29px] left-[84px] z-30 flex h-4 items-center bg-ply-0 pr-10 md:hidden">
        <LedLabel state={state}>{children}</LedLabel>
      </div>
    </>
  );
}

function Poster({
  kicker,
  title,
  last,
  body,
  reason,
  keys,
  cover = "column",
}: {
  kicker: string;
  title: string;
  last: string;
  body: string;
  reason?: ReactNode;
  keys: ReactNode;
  /** `column` leaves the rail and tree usable; `screen` is the cold load. */
  cover?: "column" | "screen";
}) {
  return (
    <section
      role="alert"
      className={cn(
        "flex flex-col justify-center bg-ply-0 px-6 md:px-16",
        cover === "screen" ? "absolute inset-0 z-40" : CHAT_COLUMN,
      )}
    >
      <div className="w-full max-w-[520px]">
        <p className="silkscreen text-ink-3">{kicker}</p>
        <h2 className="mt-4 font-display text-[40px] leading-[0.92] font-extrabold tracking-[-0.04em] text-balance text-ink-1 md:text-[56px]">
          {title}{" "}
          <DitherWord cell={3} ground="ply-0">
            {last}
          </DitherWord>
        </h2>
        <DitherRule className="mt-5 h-3" />
        <p className="mt-5 max-w-[44ch] text-ui-base text-pretty text-ink-2">
          {body}
        </p>
        {reason ? <div className="mt-5">{reason}</div> : null}
        <div className="mt-8 flex gap-2 max-md:flex-col">{keys}</div>
      </div>
    </section>
  );
}

function Reason({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid max-w-[360px] grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 border-t-2 border-ink-1 pt-3 leading-[14px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="silkscreen text-ink-3">{k}</dt>
          <dd className="text-right leading-[14px] text-ink-1">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function VariantC({
  state,
  shell,
}: {
  state: ConnectionState;
  shell: ReactNode;
}) {
  if (state === "cold") {
    return (
      <div className="relative h-full bg-ply-0">
        <Poster
          cover="screen"
          kicker="Ralph Meet · Connecting"
          title="Opening the"
          last="tree"
          body="Signing you in and opening the chat link. Your servers and messages load next."
          reason={<StepReadout />}
          keys={null}
        />
      </div>
    );
  }
  const layer: Partial<Record<ConnectionState, ReactNode>> = {
    reconnecting: <HeaderLed state="idle">Reconnecting</HeaderLed>,
    back: <HeaderLed state="talk">Back online</HeaderLed>,
    prolonged: (
      <Poster
        kicker="Chat · No link"
        title="Can't reach"
        last="chat"
        body="The server hasn't answered for 42 seconds. What's on screen is kept, and Ralph keeps trying in the background."
        reason={
          <Reason
            rows={[
              ["Last reply", <Num key="a">0:42 ago</Num>],
              ["Next try", <Num key="b">in 30s</Num>],
              ["Tries", <Num key="c">6</Num>],
            ]}
          />
        }
        keys={
          <>
            <Button size="lg" variant="primary">
              Retry now
            </Button>
            <Button size="lg" variant="secondary" paired>
              Keep reading
            </Button>
          </>
        }
      />
    ),
    offline: (
      <Poster
        kicker="Device · Offline"
        title="You're"
        last="offline"
        body="This device has no network. Ralph reconnects by itself as soon as it's back; there's nothing to retry."
        keys={
          <Button size="lg" variant="primary">
            Keep reading
          </Button>
        }
      />
    ),
    auth: (
      <Poster
        kicker="Session · Expired"
        title="Sign in"
        last="again"
        body="Your session on this device ended, so chat can't connect. Nothing is lost."
        keys={
          <>
            <Button size="lg" variant="primary">
              Sign in
            </Button>
            <Button size="lg" variant="secondary" paired>
              Not now
            </Button>
          </>
        }
      />
    ),
  };
  return (
    <div className="relative h-full">
      {shell}
      {layer[state] ?? null}
    </div>
  );
}

// ── Fixture ────────────────────────────────────────────────────────────

// ── Cold load: the shipped screen (ColdLoad), any step and error ───────

function ColdV3({ step, error }: { step: ColdStep; error: ColdError }) {
  return (
    <ColdLoadScreen
      step={step}
      error={error}
      onSignIn={() => {}}
      onReload={() => {}}
      className="absolute inset-0"
    />
  );
}

// ── Shipped (the real components, driven through the store) ────────────

function seedShipped(state: ConnectionState, step: ColdStep) {
  const offline = state === "offline";
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => !offline,
  });
  useChatStore.setState({
    connected: false,
    connectStep: state === "cold" ? step : 3,
    gatewayFailure: state === "auth" ? "auth" : null,
    reconnectAttempt:
      state === "prolonged" ? 7 : state === "reconnecting" ? 3 : 2,
  } as never);
}

/**
 * The real cold load. `&handoff=1` shows the route splash first and swaps
 * to the connection overlay at 3s, to check that nothing moves.
 */
function ColdShipped() {
  const [handoff] = useState(() => param("handoff") === "1");
  const [splash, setSplash] = useState(handoff);
  useEffect(() => {
    if (!handoff) return;
    const id = setTimeout(() => setSplash(false), 3000);
    return () => clearTimeout(id);
  }, [handoff]);
  return splash ? (
    <div className="absolute inset-0">
      <SplashScreen />
    </div>
  ) : (
    <ConnectionOverlay />
  );
}

function Shipped({
  state,
  shell,
  step,
}: {
  state: ConnectionState;
  shell: ReactNode;
  step: ColdStep;
}) {
  useState(() => seedShipped(state, step));
  useEffect(() => {
    if (state !== "back") return;
    const id = setTimeout(
      () => useChatStore.setState({ connected: true }),
      1500,
    );
    return () => clearTimeout(id);
  }, [state]);
  if (state === "cold") return <ColdShipped />;
  return (
    <div className="relative h-full">
      {state !== "brief" ? (
        <GatewayConnectionBanner initialHasConnected />
      ) : null}
      {shell}
    </div>
  );
}

/**
 * `shell` is the real app shell from UiFixtures, so every state is shown
 * over the app it interrupts.
 *
 *   &shipped=1          the shipped strip and cold screen, via the store
 *   &state=cold&cold=1&step=0..3&err=auth|offline|slow
 *                       the shipped cold-load screen at a given step/error
 */
export function ConnectionStatesFixture({ shell }: { shell: ReactNode }) {
  const [variant] = useState<ConnectionVariant>(() => {
    const v = param("variant");
    return v === "b" || v === "c" ? v : "a";
  });
  const [state] = useState<ConnectionState>(() => {
    const s = param("state") as ConnectionState | null;
    return s && STATES.includes(s) ? s : "reconnecting";
  });
  const [cold] = useState(() => param("cold") !== null);
  const [coldError] = useState<ColdError>(() => {
    const e = param("err");
    return e === "auth" || e === "offline" || e === "slow" ? e : null;
  });
  const [step] = useState<ColdStep>(() => {
    const n = Number(param("step") ?? "1");
    return (n >= 0 && n <= 3 ? Math.round(n) : 1) as ColdStep;
  });
  const shipped = param("shipped") === "1";
  const View =
    variant === "b" ? VariantB : variant === "c" ? VariantC : VariantA;
  return (
    <div
      data-testid="connection-states"
      data-variant={variant}
      data-state={state}
      className="relative h-full w-full overflow-hidden"
    >
      {shipped ? (
        <Shipped state={state} shell={shell} step={step} />
      ) : state === "cold" && cold ? (
        <ColdV3 step={step} error={coldError} />
      ) : (
        <View state={state} shell={shell} />
      )}
    </div>
  );
}
