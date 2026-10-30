/**
 * Dev-only fixtures for the "act-*" surfaces (see routes/ui-fixtures.tsx):
 * the voice activities (Wordle, Warp Rush), the Voice apps picker and the
 * Listen Together surfaces. Nothing here ships.
 *
 *   act-wordle | act-wordle-howto | act-wordle-hints | act-wordle-settings
 *   act-wordle-done
 *   act-warp | act-warp-unsupported | act-warp-booting
 *   act-apps | act-apps-menu (the same single list; the old mode prop still works)
 *   act-listen | act-listen-empty | act-listen-history | act-listen-actions
 *   act-now-playing | act-soundboard
 */

import { useEffect, useState } from "react";

import { FloatingSoundboardManager } from "@/components/chat/FloatingSoundboardManager";
import { ListenTogetherNowPlayingCard } from "@/components/chat/ListenTogetherNowPlayingCard";
import { ListenTogetherPanel } from "@/components/chat/ListenTogetherPanel";
import { useListenTogetherPlaybackState } from "@/components/chat/listen-together-playback";
import { VoiceAppsModal } from "@/components/chat/VoiceAppsModal";
import * as WarpRushModule from "@/components/chat/WarpRushActivityStage";
import { WordleActivityStage } from "@/components/chat/WordleActivityStage";
import {
  installListenSearchStub,
  LISTEN_ROOM,
  listenSnapshot,
} from "@/components/dev/UiFixtures";
import type { SFUClient } from "@/lib/sfu-client";
import { getNewYorkDateKey } from "@/lib/wordle";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";

const { WarpRushActivityStage } = WarpRushModule;

/** Enough of an SFU client for controls to look connected. */
const fakeSfu = {
  voiceGW: { isReady: true, sendAppEvent: () => true },
  resumeAudioContext: () => {},
  on: () => () => {},
  off: () => {},
} as unknown as SFUClient;

const participants = [
  { userId: "u-me", name: "Jon" },
  { userId: "u-ada", name: "Ada Lovelace" },
  { userId: "u-grace", name: "Grace Hopper" },
  { userId: "u-linus", name: "Linus" },
];

/** Waits for a selector, then runs `fn` on the element (fixture setup). */
function whenPresent<T extends Element>(
  selector: string,
  fn: (element: T) => void,
  timeoutMs = 4000,
) {
  const started = Date.now();
  let timer = 0;
  const tick = () => {
    const element = document.querySelector<T>(selector);
    if (element) {
      fn(element);
      return;
    }
    if (Date.now() - started < timeoutMs) timer = window.setTimeout(tick, 50);
  };
  tick();
  return () => window.clearTimeout(timer);
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ------------------------------------------------------------------ */
/* Wordle                                                               */
/* ------------------------------------------------------------------ */

/** Other players, one with a name long enough to truncate in the rail. */
const wordleParticipants = [
  ...participants,
  { userId: "u-max", name: "Maximilian Featherstonehaugh-Wells" },
];

/** An SFU stand-in whose app events the fixture can push by hand. */
function makeEventSfu() {
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  const sfu = {
    voiceGW: { isReady: true, sendAppEvent: () => true },
    resumeAudioContext: () => {},
    on: (
      _eventName: string,
      listener: (event: Record<string, unknown>) => void,
    ) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    off: () => {},
  } as unknown as SFUClient;
  return {
    sfu,
    emit: (event: Record<string, unknown>) =>
      listeners.forEach((listener) => listener(event)),
  };
}

function WordleFixture({ surface }: { surface: string }) {
  const [ready, setReady] = useState(false);
  const [events] = useState(makeEventSfu);

  useEffect(() => {
    const dateKey = getNewYorkDateKey(new Date());
    const storageKey = `voice-wordle:ch-lounge:u-me:${dateKey}`;
    const done = surface === "act-wordle-done";
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        guesses: done ? ["slate", "crane"] : ["slate", "pride"],
        localProgress: null,
        hints: surface === "act-wordle-hints" ? [1] : [],
      }),
    );
    if (surface === "act-wordle-howto") {
      localStorage.removeItem("voice-wordle:how-to-play-seen");
    } else {
      localStorage.setItem("voice-wordle:how-to-play-seen", "true");
    }
    localStorage.setItem("voice-wordle:hint-notice-seen", "true");

    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/api/wordle/today")) {
        return new Response(
          JSON.stringify({
            id: 1584,
            print_date: dateKey,
            solution: "crane",
            editor: "Tracy Bennett",
            source: "nyt",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return original(input, init);
    };
    // Fixture setup: the stub must exist before the stage mounts and fetches.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    return () => {
      window.fetch = original;
      localStorage.removeItem(storageKey);
    };
  }, [surface]);

  // The group rail has someone to show: solved, still playing, out of tries.
  useEffect(() => {
    if (!ready) return;
    const dateKey = getNewYorkDateKey(new Date());
    const progress = (
      userId: string,
      name: string,
      guesses: string[],
      finished: boolean,
      missed: boolean,
    ) =>
      events.emit({
        type: "wordle.progress",
        channel_id: "ch-lounge",
        puzzle_date: dateKey,
        progress: { userId, name, guesses, streak: 2, finished, missed },
      });
    return whenPresent<HTMLButtonElement>(
      'button[aria-label="Open channel stats"]',
      () => {
        progress(
          "u-ada",
          "Ada Lovelace",
          ["adieu", "slate", "crane"],
          true,
          false,
        );
        progress("u-grace", "Grace Hopper", ["slate", "pride"], false, false);
        progress(
          "u-max",
          "Maximilian Featherstonehaugh-Wells",
          ["slate", "pride", "adieu", "audio", "stove", "moist"],
          true,
          true,
        );
      },
    );
  }, [ready, events]);

  useEffect(() => {
    if (!ready) return;
    if (surface === "act-wordle-hints") {
      return whenPresent<HTMLButtonElement>(
        'button[aria-label="Open hints"]',
        (button) => button.click(),
      );
    }
    if (surface === "act-wordle-settings") {
      return whenPresent<HTMLButtonElement>(
        'button[aria-label="Open settings"]',
        (button) => button.click(),
      );
    }
  }, [ready, surface]);

  if (!ready) return null;
  return (
    <WordleActivityStage
      sfu={events.sfu}
      channelId="ch-lounge"
      localUserId="u-me"
      participants={wordleParticipants}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Warp Rush                                                            */
/* ------------------------------------------------------------------ */

function WarpFixture({ surface }: { surface: string }) {
  const [ready, setReady] = useState(surface !== "act-warp-unsupported");

  useEffect(() => {
    if (surface !== "act-warp-unsupported") return;
    // No WebGL: three's renderer throws, the stage shows its failure state.
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      if (kind.startsWith("webgl")) return null;
      return (original as (...args: unknown[]) => unknown).call(
        this,
        kind,
        ...rest,
      );
    } as typeof original;
    setReady(true);
    return () => {
      HTMLCanvasElement.prototype.getContext = original;
    };
  }, [surface]);

  if (surface === "act-warp-booting") {
    const Booting = (
      WarpRushModule as unknown as {
        WarpRushStatusScreen?: React.ComponentType<{ kind: "booting" }>;
      }
    ).WarpRushStatusScreen;
    return Booting ? (
      <Booting kind="booting" />
    ) : (
      <div className="grid h-full place-items-center text-ui-sm text-ink-3">
        No booting state before this unit.
      </div>
    );
  }
  if (!ready) return null;
  return (
    <WarpRushActivityStage
      sfu={null}
      channelId="ch-lounge"
      localUserId="u-me"
      participants={participants}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Voice apps                                                           */
/* ------------------------------------------------------------------ */

function AppsFixture({ surface }: { surface: string }) {
  return (
    <VoiceAppsModal
      isOpen
      initialTab={surface === "act-apps-menu" ? "menu" : "activities"}
      onClose={() => {}}
      sfu={null}
      serverId="srv-ralph"
      channelId="ch-lounge"
      localUserId="u-me"
      gridItems={participants.map((p) => ({
        ...p,
        isLocal: p.userId === "u-me",
      }))}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Listen Together                                                      */
/* ------------------------------------------------------------------ */

function useListenRoom(seed: "full" | "empty" | "history") {
  useEffect(() => {
    const restoreFetch = installListenSearchStub();
    const store = useListenTogetherStore.getState();
    if (seed !== "empty") {
      const snapshot = listenSnapshot(Date.now());
      if (seed === "history") {
        snapshot.recentlyPlayed = snapshot.queue
          .slice(1)
          .map((entry, index) => ({
            historyId: `h-${index}`,
            playedAt: Date.now() - (index + 1) * 260_000,
            entry,
          }));
      }
      store.setSnapshot(LISTEN_ROOM, snapshot);
    }
    return () => {
      restoreFetch();
      useListenTogetherStore.getState().clearRoom(LISTEN_ROOM);
    };
  }, [seed]);
}

function ListenFixture({ surface }: { surface: string }) {
  const seed =
    surface === "act-listen-empty"
      ? "empty"
      : surface === "act-listen-history"
        ? "history"
        : "full";
  useListenRoom(seed);

  useEffect(() => {
    if (surface === "act-listen-empty") return;
    if (surface === "act-listen-history") {
      return whenPresent<HTMLButtonElement>(
        '[role="tab"][id*="recently-played"]',
        (tab) => tab.click(),
      );
    }
    let cancelOpen = () => {};
    const cancelType = whenPresent<HTMLInputElement>(
      'input[placeholder^="Search"]',
      (input) => {
        typeInto(input, "lumen arc");
        if (surface === "act-listen-actions") {
          cancelOpen = whenPresent<HTMLButtonElement>(
            'button[aria-label^="More actions for"]',
            (button) => button.click(),
          );
        }
      },
    );
    return () => {
      cancelType();
      cancelOpen();
    };
  }, [surface]);

  return (
    <div className="h-full">
      <ListenTogetherPanel
        sfu={fakeSfu}
        roomSlug={LISTEN_ROOM}
        voiceSessionId="vs-fixture"
        serverId="srv-ralph"
        channelId="ch-lounge"
        localUserId="u-me"
      />
    </div>
  );
}

function NowPlayingCards() {
  const playback = useListenTogetherPlaybackState(LISTEN_ROOM);
  return (
    <div className="grid h-full grid-cols-1 content-start gap-6 overflow-y-auto p-4 md:grid-cols-2 md:p-6">
      <div className="space-y-2">
        <p className="text-ui-xs text-ink-3">variant="mini"</p>
        {/* The mini body as it sits in the floating player (ply-3). */}
        <div className="max-w-[340px] rounded-xl border border-line bg-ply-3 shadow-float">
          <ListenTogetherNowPlayingCard
            playback={playback}
            sfu={fakeSfu}
            roomSlug={LISTEN_ROOM}
            onOpenQueue={() => {}}
          />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-ui-xs text-ink-3">variant="panel"</p>
        <div className="rounded-lg border border-line bg-ply-2 p-4">
          <ListenTogetherNowPlayingCard
            playback={playback}
            sfu={fakeSfu}
            roomSlug={LISTEN_ROOM}
            variant="panel"
          />
        </div>
      </div>
    </div>
  );
}

function NowPlayingFixture() {
  useListenRoom("full");
  return <NowPlayingCards />;
}

/* ------------------------------------------------------------------ */
/* Floating soundboard                                                  */
/* ------------------------------------------------------------------ */

function SoundboardFixture() {
  useEffect(() => {
    const store = useVoiceSoundboardStore.getState();
    const now = Date.now();
    const names = [
      "Airhorn",
      "Sad trombone",
      "Crowd cheer",
      "Drumroll",
      "Rimshot",
      "Record scratch",
    ];
    names.forEach((name, index) =>
      store.upsertPlayback({
        playbackId: `fx-sb-${index}`,
        ownerId: "u-me",
        serverKey: "srv-ralph",
        name,
        isLocal: true,
        startedAt: now - index * 4_000,
        paused: index === 1,
        volume: 0.8,
      }),
    );
    return () =>
      useVoiceSoundboardStore.getState().clearServerPlaybacks("srv-ralph");
  }, []);
  return (
    <div className="grid h-full place-items-center text-ui-sm text-rm-text-muted">
      Floating soundboard manager (top right)
      <FloatingSoundboardManager
        serverId="srv-ralph"
        localUserId="u-me"
        sfu={fakeSfu}
      />
    </div>
  );
}

export function ActivityFixture({ surface }: { surface: string }) {
  if (surface.startsWith("act-wordle"))
    return <WordleFixture surface={surface} />;
  if (surface.startsWith("act-warp")) return <WarpFixture surface={surface} />;
  if (surface.startsWith("act-apps")) return <AppsFixture surface={surface} />;
  if (surface.startsWith("act-listen"))
    return <ListenFixture surface={surface} />;
  if (surface === "act-now-playing") return <NowPlayingFixture />;
  if (surface === "act-soundboard") return <SoundboardFixture />;
  return (
    <div className="grid h-full place-items-center text-ui-sm text-rm-text-muted">
      Unknown fixture: {surface}
    </div>
  );
}
