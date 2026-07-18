import {
  buildListenTogetherSnapshot,
  clampListenTogetherPosition,
  createListenTogetherState,
  getListenTogetherCurrentEntry,
  getListenTogetherPositionMs,
  getListenTogetherTrackDuration,
  LISTEN_TOGETHER_RECENTLY_PLAYED_LIMIT,
  type ListenTogetherEnqueueMode,
  type ListenTogetherPersistentState,
  type ListenTogetherQueueEntry,
  type ListenTogetherQueueEntrySeed,
  type ListenTogetherStateSnapshot,
} from "@/lib/listen-together";

export interface ListenTogetherMutationResult {
  state: ListenTogetherPersistentState;
  queue: ListenTogetherQueueEntry[];
  queueChanged: boolean;
  playbackChanged: boolean;
}

function touchState(
  state: ListenTogetherPersistentState,
  patch: Partial<ListenTogetherPersistentState>,
  now: number,
): ListenTogetherPersistentState {
  return {
    ...state,
    ...patch,
    revision: state.revision + 1,
    lastUpdatedAt: now,
  };
}

function startEntry(
  state: ListenTogetherPersistentState,
  queue: ListenTogetherQueueEntry[],
  entryId: string | null,
  now: number,
  positionMs = 0,
  paused = false,
): ListenTogetherPersistentState {
  const entry = getListenTogetherCurrentEntry(queue, entryId);
  const recentlyPlayed = entry
    ? [
        {
          historyId: crypto.randomUUID(),
          playedAt: now,
          entry,
        },
        ...(state.recentlyPlayed ?? []),
      ].slice(0, LISTEN_TOGETHER_RECENTLY_PLAYED_LIMIT)
    : state.recentlyPlayed;
  return touchState(
    state,
    {
      currentEntryId: entryId,
      paused,
      anchorPositionMs: Math.max(0, Math.floor(positionMs)),
      anchorUpdatedAt: now,
      recentlyPlayed,
    },
    now,
  );
}

function buildQueueEntries(
  entries: ListenTogetherQueueEntrySeed[],
  now: number,
): ListenTogetherQueueEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    entryId: crypto.randomUUID(),
    requestedAt: now + index,
  }));
}

function insertQueueEntries(
  queue: ListenTogetherQueueEntry[],
  currentEntryId: string | null,
  additions: ListenTogetherQueueEntry[],
  mode: ListenTogetherEnqueueMode,
): ListenTogetherQueueEntry[] {
  if (additions.length === 0) return queue;
  if (!currentEntryId || mode === "append") {
    return [...queue, ...additions];
  }

  const currentIndex = queue.findIndex(
    (entry) => entry.entryId === currentEntryId,
  );
  if (currentIndex === -1) {
    return [...queue, ...additions];
  }

  if (mode === "play-now") {
    return [
      ...queue.slice(0, currentIndex),
      ...additions,
      ...queue.slice(currentIndex + 1),
    ];
  }

  return [
    ...queue.slice(0, currentIndex + 1),
    ...additions,
    ...queue.slice(currentIndex + 1),
  ];
}

function getEntryDuration(
  queue: ListenTogetherQueueEntry[],
  currentEntryId: string | null,
): number | null {
  const entry = getListenTogetherCurrentEntry(queue, currentEntryId);
  return entry ? getListenTogetherTrackDuration(entry.track) : null;
}

export function ensureListenTogetherState(
  roomSlug: string,
  state?: ListenTogetherPersistentState | null,
): ListenTogetherPersistentState {
  if (!state) return createListenTogetherState(roomSlug);
  return {
    ...state,
    recentlyPlayed: (state.recentlyPlayed ?? []).slice(
      0,
      LISTEN_TOGETHER_RECENTLY_PLAYED_LIMIT,
    ),
  };
}

export function buildListenTogetherRoomSnapshot(
  roomSlug: string,
  queue: ListenTogetherQueueEntry[],
  state?: ListenTogetherPersistentState | null,
  now = Date.now(),
): ListenTogetherStateSnapshot {
  return buildListenTogetherSnapshot(
    ensureListenTogetherState(roomSlug, state),
    queue,
    now,
  );
}

export function enqueueListenTogetherEntries(
  roomSlug: string,
  queue: ListenTogetherQueueEntry[],
  state: ListenTogetherPersistentState | null | undefined,
  entries: ListenTogetherQueueEntrySeed[],
  mode: ListenTogetherEnqueueMode,
  now = Date.now(),
): ListenTogetherMutationResult {
  const nextState = ensureListenTogetherState(roomSlug, state);
  const additions = buildQueueEntries(entries, now);
  const nextQueue = insertQueueEntries(
    queue,
    nextState.currentEntryId,
    additions,
    mode,
  );
  if (additions.length === 0) {
    return {
      state: nextState,
      queue: nextQueue,
      queueChanged: false,
      playbackChanged: false,
    };
  }

  if (mode === "play-now" || !nextState.currentEntryId) {
    return {
      state: startEntry(nextState, nextQueue, additions[0].entryId, now),
      queue: nextQueue,
      queueChanged: true,
      playbackChanged: true,
    };
  }

  return {
    state: touchState(nextState, {}, now),
    queue: nextQueue,
    queueChanged: true,
    playbackChanged: false,
  };
}

export function playListenTogether(
  roomSlug: string,
  queue: ListenTogetherQueueEntry[],
  state: ListenTogetherPersistentState | null | undefined,
  entryId?: string | null,
  now = Date.now(),
): ListenTogetherMutationResult {
  const nextState = ensureListenTogetherState(roomSlug, state);
  const targetEntryId =
    entryId ?? nextState.currentEntryId ?? queue[0]?.entryId ?? null;
  if (!targetEntryId) {
    return {
      state: nextState,
      queue,
      queueChanged: false,
      playbackChanged: false,
    };
  }

  const targetEntry = getListenTogetherCurrentEntry(queue, targetEntryId);
  if (!targetEntry) {
    return {
      state: nextState,
      queue,
      queueChanged: false,
      playbackChanged: false,
    };
  }

  if (targetEntryId === nextState.currentEntryId && !nextState.paused) {
    return {
      state: nextState,
      queue,
      queueChanged: false,
      playbackChanged: false,
    };
  }

  const currentDurationMs = getEntryDuration(queue, nextState.currentEntryId);
  const resumePosition =
    targetEntryId === nextState.currentEntryId
      ? getListenTogetherPositionMs(nextState, currentDurationMs, now)
      : 0;

  if (targetEntryId === nextState.currentEntryId) {
    return {
      state: touchState(
        nextState,
        {
          paused: false,
          anchorPositionMs: resumePosition,
          anchorUpdatedAt: now,
        },
        now,
      ),
      queue,
      queueChanged: false,
      playbackChanged: true,
    };
  }

  return {
    state: startEntry(
      nextState,
      queue,
      targetEntryId,
      now,
      resumePosition,
      false,
    ),
    queue,
    queueChanged: false,
    playbackChanged: true,
  };
}

export function pauseListenTogether(
  roomSlug: string,
  queue: ListenTogetherQueueEntry[],
  state: ListenTogetherPersistentState | null | undefined,
  paused: boolean,
  now = Date.now(),
): ListenTogetherMutationResult {
  const nextState = ensureListenTogetherState(roomSlug, state);
  if (!nextState.currentEntryId || nextState.paused === paused) {
    return {
      state: nextState,
      queue,
      queueChanged: false,
      playbackChanged: false,
    };
  }

  const durationMs = getEntryDuration(queue, nextState.currentEntryId);
  const positionMs = getListenTogetherPositionMs(nextState, durationMs, now);
  return {
    state: touchState(
      nextState,
      {
        paused,
        anchorPositionMs: positionMs,
        anchorUpdatedAt: now,
      },
      now,
    ),
    queue,
    queueChanged: false,
    playbackChanged: true,
  };
}

export function seekListenTogether(
  roomSlug: string,
  queue: ListenTogetherQueueEntry[],
  state: ListenTogetherPersistentState | null | undefined,
  positionMs: number,
  now = Date.now(),
): ListenTogetherMutationResult {
  const nextState = ensureListenTogetherState(roomSlug, state);
  if (!nextState.currentEntryId) {
    return {
      state: nextState,
      queue,
      queueChanged: false,
      playbackChanged: false,
    };
  }
  const durationMs = getEntryDuration(queue, nextState.currentEntryId);
  return {
    state: touchState(
      nextState,
      {
        anchorPositionMs: clampListenTogetherPosition(positionMs, durationMs),
        anchorUpdatedAt: now,
      },
      now,
    ),
    queue,
    queueChanged: false,
    playbackChanged: true,
  };
}

export function skipListenTogether(
  roomSlug: string,
  queue: ListenTogetherQueueEntry[],
  state: ListenTogetherPersistentState | null | undefined,
  now = Date.now(),
): ListenTogetherMutationResult {
  const nextState = ensureListenTogetherState(roomSlug, state);
  if (!nextState.currentEntryId) {
    return {
      state: nextState,
      queue,
      queueChanged: false,
      playbackChanged: false,
    };
  }

  const currentIndex = queue.findIndex(
    (entry) => entry.entryId === nextState.currentEntryId,
  );
  if (currentIndex === -1) {
    return {
      state: nextState,
      queue,
      queueChanged: false,
      playbackChanged: false,
    };
  }

  const nextQueue = queue.filter(
    (entry) => entry.entryId !== nextState.currentEntryId,
  );
  const successor =
    nextQueue[currentIndex] ?? nextQueue[currentIndex - 1] ?? null;
  if (!successor) {
    return {
      state: touchState(
        nextState,
        {
          currentEntryId: null,
          paused: true,
          anchorPositionMs: 0,
          anchorUpdatedAt: now,
        },
        now,
      ),
      queue: nextQueue,
      queueChanged: true,
      playbackChanged: true,
    };
  }

  return {
    state: startEntry(nextState, nextQueue, successor.entryId, now),
    queue: nextQueue,
    queueChanged: true,
    playbackChanged: true,
  };
}

export function removeListenTogetherEntry(
  roomSlug: string,
  queue: ListenTogetherQueueEntry[],
  state: ListenTogetherPersistentState | null | undefined,
  entryId: string,
  now = Date.now(),
): ListenTogetherMutationResult {
  const nextState = ensureListenTogetherState(roomSlug, state);
  const removeIndex = queue.findIndex((entry) => entry.entryId === entryId);
  if (removeIndex === -1) {
    return {
      state: nextState,
      queue,
      queueChanged: false,
      playbackChanged: false,
    };
  }

  const nextQueue = queue.filter((entry) => entry.entryId !== entryId);
  if (entryId !== nextState.currentEntryId) {
    return {
      state: touchState(nextState, {}, now),
      queue: nextQueue,
      queueChanged: true,
      playbackChanged: false,
    };
  }

  const successor =
    nextQueue[removeIndex] ?? nextQueue[removeIndex - 1] ?? null;
  if (!successor) {
    return {
      state: touchState(
        nextState,
        {
          currentEntryId: null,
          paused: true,
          anchorPositionMs: 0,
          anchorUpdatedAt: now,
        },
        now,
      ),
      queue: nextQueue,
      queueChanged: true,
      playbackChanged: true,
    };
  }

  return {
    state: startEntry(nextState, nextQueue, successor.entryId, now),
    queue: nextQueue,
    queueChanged: true,
    playbackChanged: true,
  };
}

export function clearListenTogether(
  roomSlug: string,
  state: ListenTogetherPersistentState | null | undefined,
  now = Date.now(),
): ListenTogetherMutationResult {
  const nextState = ensureListenTogetherState(roomSlug, state);
  return {
    state: touchState(
      nextState,
      {
        currentEntryId: null,
        paused: true,
        anchorPositionMs: 0,
        anchorUpdatedAt: now,
      },
      now,
    ),
    queue: [],
    queueChanged: true,
    playbackChanged: true,
  };
}

export function freezeListenTogetherPlayback(
  roomSlug: string,
  queue: ListenTogetherQueueEntry[],
  state: ListenTogetherPersistentState | null | undefined,
  now = Date.now(),
): ListenTogetherMutationResult {
  const nextState = ensureListenTogetherState(roomSlug, state);
  if (!nextState.currentEntryId || nextState.paused) {
    return {
      state: nextState,
      queue,
      queueChanged: false,
      playbackChanged: false,
    };
  }
  const durationMs = getEntryDuration(queue, nextState.currentEntryId);
  const frozenPositionMs = getListenTogetherPositionMs(
    nextState,
    durationMs,
    now,
  );
  return {
    state: touchState(
      nextState,
      {
        paused: true,
        anchorPositionMs: frozenPositionMs,
        anchorUpdatedAt: now,
      },
      now,
    ),
    queue,
    queueChanged: false,
    playbackChanged: true,
  };
}
