import { CacheKey } from "@/lib/cache";

export const BACKGROUND_TASK_VERSION = 1 as const;
export const PRESENCE_CACHE_INVALIDATE_TASK =
  "presence.cache.invalidate" as const;
const MAX_QUEUE_MESSAGE_BYTES = 120 * 1024;
const MAX_SERVER_IDS_PER_TASK = 100;

export interface PresenceCacheInvalidationTask {
  type: typeof PRESENCE_CACHE_INVALIDATE_TASK;
  serverIds: string[];
}

export interface BackgroundTaskEnvelope {
  version: typeof BACKGROUND_TASK_VERSION;
  task: PresenceCacheInvalidationTask;
}

export interface BackgroundTaskRuntimeEnv {
  CACHE: KVNamespace;
  BACKGROUND_TASKS?: Queue<BackgroundTaskEnvelope>;
}

export interface BackgroundTaskConsumerEnv {
  CACHE: KVNamespace;
}

export type BackgroundTaskParseResult =
  | { ok: true; value: BackgroundTaskEnvelope }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function taskSizeBytes(task: BackgroundTaskEnvelope): number {
  return new TextEncoder().encode(JSON.stringify(task)).byteLength;
}

function makePresenceCacheInvalidationTask(
  serverIds: string[],
): BackgroundTaskEnvelope {
  return {
    version: BACKGROUND_TASK_VERSION,
    task: {
      type: PRESENCE_CACHE_INVALIDATE_TASK,
      serverIds,
    },
  };
}

export function createPresenceCacheInvalidationTasks(
  serverIds: readonly string[],
): BackgroundTaskEnvelope[] {
  const uniqueServerIds = [...new Set(serverIds)].filter(
    (serverId) => serverId.length > 0,
  );
  const tasks: BackgroundTaskEnvelope[] = [];
  let currentServerIds: string[] = [];

  for (const serverId of uniqueServerIds) {
    const candidate = makePresenceCacheInvalidationTask([
      ...currentServerIds,
      serverId,
    ]);

    if (
      currentServerIds.length > 0 &&
      (currentServerIds.length >= MAX_SERVER_IDS_PER_TASK ||
        taskSizeBytes(candidate) > MAX_QUEUE_MESSAGE_BYTES)
    ) {
      tasks.push(makePresenceCacheInvalidationTask(currentServerIds));
      currentServerIds = [serverId];
      continue;
    }

    if (taskSizeBytes(candidate) > MAX_QUEUE_MESSAGE_BYTES) {
      throw new Error(
        "Presence cache invalidation task exceeds Queue size limit",
      );
    }

    currentServerIds.push(serverId);
  }

  if (currentServerIds.length > 0) {
    tasks.push(makePresenceCacheInvalidationTask(currentServerIds));
  }

  return tasks;
}

export function parseBackgroundTask(value: unknown): BackgroundTaskParseResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "malformed-task" };
  }
  if (value.version !== BACKGROUND_TASK_VERSION) {
    return {
      ok: false,
      reason:
        typeof value.version === "number" &&
        value.version > BACKGROUND_TASK_VERSION
          ? "unsupported-future-version"
          : "malformed-task",
    };
  }

  const task = value.task;
  if (
    !isRecord(task) ||
    task.type !== PRESENCE_CACHE_INVALIDATE_TASK ||
    !Array.isArray(task.serverIds) ||
    task.serverIds.length === 0 ||
    !task.serverIds.every(
      (serverId): serverId is string =>
        typeof serverId === "string" && serverId.length > 0,
    )
  ) {
    if (isRecord(task) && task.type !== PRESENCE_CACHE_INVALIDATE_TASK) {
      return { ok: false, reason: "unknown-task" };
    }
    return { ok: false, reason: "malformed-task" };
  }
  if (task.serverIds.length > MAX_SERVER_IDS_PER_TASK) {
    return { ok: false, reason: "oversized-task" };
  }

  return {
    ok: true,
    value: {
      version: BACKGROUND_TASK_VERSION,
      task: {
        type: PRESENCE_CACHE_INVALIDATE_TASK,
        serverIds: [...new Set(task.serverIds)],
      },
    },
  };
}

export async function deleteServerMemberCacheKeys(
  cache: KVNamespace,
  serverIds: readonly string[],
): Promise<void> {
  const results = await Promise.allSettled(
    [...new Set(serverIds)].map((serverId) =>
      cache.delete(CacheKey.serverMembers(serverId)),
    ),
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length > 0) {
    throw new Error(
      `Failed to delete ${failures.length} server member cache key(s)`,
    );
  }
}

export async function publishPresenceCacheInvalidation(
  env: BackgroundTaskRuntimeEnv,
  serverIds: readonly string[],
): Promise<boolean> {
  if (!env.BACKGROUND_TASKS) return false;

  for (const task of createPresenceCacheInvalidationTasks(serverIds)) {
    await env.BACKGROUND_TASKS.send(task, { contentType: "json" });
  }

  return true;
}

export function scheduleServerMemberCacheInvalidation(
  env: BackgroundTaskRuntimeEnv,
  serverIds: readonly string[],
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<void> {
  if (serverIds.length === 0) return Promise.resolve();

  const work = publishPresenceCacheInvalidation(env, serverIds)
    .then((published) => {
      if (!published) {
        return deleteServerMemberCacheKeys(env.CACHE, serverIds);
      }
    })
    .catch(async (error: unknown) => {
      console.error("Background task publish failed; using KV fallback", error);
      await deleteServerMemberCacheKeys(env.CACHE, serverIds);
    });

  const settledWork = work.catch((error: unknown) => {
    console.error("Presence cache fallback failed", error);
  });
  if (waitUntil) waitUntil(settledWork);
  return settledWork;
}

export async function consumeBackgroundTaskBatch(
  batch: MessageBatch<unknown>,
  env: BackgroundTaskConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = parseBackgroundTask(message.body);
    if (!parsed.ok) {
      if (
        parsed.reason === "unsupported-future-version" ||
        parsed.reason === "unknown-task" ||
        parsed.reason === "oversized-task"
      ) {
        message.retry();
      } else {
        message.ack();
      }
      continue;
    }

    try {
      await deleteServerMemberCacheKeys(env.CACHE, parsed.value.task.serverIds);
      message.ack();
    } catch (error: unknown) {
      console.error(
        "Background task processing failed; retrying message",
        error,
      );
      message.retry();
    }
  }
}
