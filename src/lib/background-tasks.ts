import { CacheKey } from "@/lib/cache";
import {
  processMessagePostprocessingTask,
  type MessagePostprocessingTask,
} from "@/services/message.service";
export type { MessagePostprocessingTask } from "@/services/message.service";
import {
  processR2CleanupTask,
  recordR2CleanupFailure,
  type R2CleanupTask,
} from "@/services/r2-cleanup.service";

export const BACKGROUND_TASK_VERSION = 1 as const;
export const PRESENCE_CACHE_INVALIDATE_TASK =
  "presence.cache.invalidate" as const;
export const MESSAGE_POSTPROCESS_TASK = "message.postprocess" as const;
export const R2_CLEANUP_TASK = "r2.cleanup" as const;
const MAX_QUEUE_MESSAGE_BYTES = 120 * 1024;
const MAX_SERVER_IDS_PER_TASK = 100;
const MESSAGE_POSTPROCESSING_MAX_ATTEMPTS = 10;
const MESSAGE_POSTPROCESSING_BASE_DELAY_MS = 60_000;
const MESSAGE_POSTPROCESSING_MAX_DELAY_MS = 6 * 60 * 60 * 1000;

function nextMessagePostprocessingAttemptAt(
  attempt: number,
  now = Date.now(),
): string {
  const delay = Math.min(
    MESSAGE_POSTPROCESSING_MAX_DELAY_MS,
    MESSAGE_POSTPROCESSING_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
  );
  return new Date(now + delay).toISOString();
}
const MESSAGE_POSTPROCESSING_RETRY_LIMIT = 100;

export interface PresenceCacheInvalidationTask {
  type: typeof PRESENCE_CACHE_INVALIDATE_TASK;
  serverIds: string[];
}

export interface MessagePostprocessingEnvelopeTask extends MessagePostprocessingTask {
  type: typeof MESSAGE_POSTPROCESS_TASK;
}

export interface R2CleanupEnvelopeTask extends R2CleanupTask {
  type: typeof R2_CLEANUP_TASK;
}

export type BackgroundTask =
  | PresenceCacheInvalidationTask
  | MessagePostprocessingEnvelopeTask
  | R2CleanupEnvelopeTask;

export interface BackgroundTaskEnvelope {
  version: typeof BACKGROUND_TASK_VERSION;
  task: BackgroundTask;
}

export interface BackgroundTaskRuntimeEnv {
  CACHE: KVNamespace;
  DB?: D1Database;
  BUCKET?: R2Bucket;
  MEETING_ROOM?: DurableObjectNamespace;
  BACKGROUND_TASKS?: Queue<BackgroundTaskEnvelope>;
}

export interface BackgroundTaskConsumerEnv {
  CACHE: KVNamespace;
  DB: D1Database;
  BUCKET: R2Bucket;
  MEETING_ROOM: DurableObjectNamespace;
}

type PresenceCacheInvalidationEnvelope = {
  version: typeof BACKGROUND_TASK_VERSION;
  task: PresenceCacheInvalidationTask;
};

export type BackgroundTaskParseResult =
  | { ok: true; value: BackgroundTaskEnvelope }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function taskSizeBytes(task: BackgroundTaskEnvelope): number {
  return new TextEncoder().encode(JSON.stringify(task)).byteLength;
}

function makeMessagePostprocessingTask(
  task: MessagePostprocessingTask,
): BackgroundTaskEnvelope {
  return {
    version: BACKGROUND_TASK_VERSION,
    task: {
      type: MESSAGE_POSTPROCESS_TASK,
      messageId: task.messageId,
      channelId: task.channelId,
      revision: task.revision,
      notify: task.notify !== false,
    },
  };
}

export function createMessagePostprocessingTask(
  task: MessagePostprocessingTask,
): BackgroundTaskEnvelope {
  const envelope = makeMessagePostprocessingTask(task);
  if (taskSizeBytes(envelope) > MAX_QUEUE_MESSAGE_BYTES) {
    throw new Error("Message postprocessing task exceeds Queue size limit");
  }
  return envelope;
}

function makeR2CleanupTask(fileKey: string): BackgroundTaskEnvelope {
  return {
    version: BACKGROUND_TASK_VERSION,
    task: { type: R2_CLEANUP_TASK, fileKey },
  };
}

export function createR2CleanupTask(fileKey: string): BackgroundTaskEnvelope {
  const envelope = makeR2CleanupTask(fileKey);
  if (taskSizeBytes(envelope) > MAX_QUEUE_MESSAGE_BYTES) {
    throw new Error("R2 cleanup task exceeds Queue size limit");
  }
  return envelope;
}

function makePresenceCacheInvalidationTask(
  serverIds: string[],
): PresenceCacheInvalidationEnvelope {
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
): PresenceCacheInvalidationEnvelope[] {
  const uniqueServerIds = [...new Set(serverIds)].filter(
    (serverId) => serverId.length > 0,
  );
  const tasks: PresenceCacheInvalidationEnvelope[] = [];
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
  if (!isRecord(task) || typeof task.type !== "string") {
    return { ok: false, reason: "malformed-task" };
  }

  if (task.type === PRESENCE_CACHE_INVALIDATE_TASK) {
    if (
      !Array.isArray(task.serverIds) ||
      task.serverIds.length === 0 ||
      !task.serverIds.every(
        (serverId): serverId is string =>
          typeof serverId === "string" && serverId.trim().length > 0,
      )
    ) {
      return { ok: false, reason: "malformed-task" };
    }
    if (task.serverIds.length > MAX_SERVER_IDS_PER_TASK) {
      return { ok: false, reason: "oversized-task" };
    }

    const normalizedServerIds = [...new Set(task.serverIds)];
    const normalizedTask = {
      version: BACKGROUND_TASK_VERSION,
      task: {
        type: PRESENCE_CACHE_INVALIDATE_TASK,
        serverIds: normalizedServerIds,
      },
    } satisfies PresenceCacheInvalidationEnvelope;
    if (taskSizeBytes(normalizedTask) > MAX_QUEUE_MESSAGE_BYTES) {
      return { ok: false, reason: "oversized-task" };
    }
    return {
      ok: true,
      value: normalizedTask,
    };
  }

  if (task.type === MESSAGE_POSTPROCESS_TASK) {
    if (
      typeof task.messageId !== "string" ||
      task.messageId.trim().length === 0 ||
      typeof task.channelId !== "string" ||
      task.channelId.trim().length === 0 ||
      typeof task.revision !== "number" ||
      !Number.isSafeInteger(task.revision) ||
      task.revision < 1 ||
      (task.notify !== undefined && typeof task.notify !== "boolean")
    ) {
      return { ok: false, reason: "malformed-task" };
    }
    const normalized = makeMessagePostprocessingTask({
      messageId: task.messageId,
      channelId: task.channelId,
      revision: task.revision,
      notify: task.notify !== false,
    });
    return taskSizeBytes(normalized) > MAX_QUEUE_MESSAGE_BYTES
      ? { ok: false, reason: "oversized-task" }
      : { ok: true, value: normalized };
  }

  if (task.type === R2_CLEANUP_TASK) {
    if (typeof task.fileKey !== "string" || task.fileKey.trim().length === 0) {
      return { ok: false, reason: "malformed-task" };
    }
    const normalized = makeR2CleanupTask(task.fileKey);
    return taskSizeBytes(normalized) > MAX_QUEUE_MESSAGE_BYTES
      ? { ok: false, reason: "oversized-task" }
      : { ok: true, value: normalized };
  }

  return { ok: false, reason: "unknown-task" };
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

async function broadcastTaskEvent(
  realtime: DurableObjectNamespace,
  target: { kind: "server" | "channel" | "user"; id: string },
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const stub = realtime.get(realtime.idFromName("global-gateway"));
    const response = await stub.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(target.kind === "server" ? { server_id: target.id } : {}),
        ...(target.kind === "channel" ? { channel_id: target.id } : {}),
        ...(target.kind === "user" ? { target_user_id: target.id } : {}),
        event,
        data,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Background realtime broadcast failed with status ${response.status}`,
      );
    }
  } catch (error: unknown) {
    console.error("Background realtime broadcast failed", error);
    throw error;
  }
}

async function processMessageTaskInRuntime(
  env: BackgroundTaskRuntimeEnv,
  task: MessagePostprocessingTask,
): Promise<void> {
  const db = env.DB;
  const realtime = env.MEETING_ROOM;
  if (!db || !realtime) {
    throw new Error("Message postprocessing bindings are unavailable");
  }
  await processMessagePostprocessingTask(db, task, (target, event, data) =>
    broadcastTaskEvent(realtime, target, event, data),
  );
}

export async function recordMessagePostprocessingJob(
  db: D1Database,
  task: MessagePostprocessingTask,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO message_postprocessing_jobs
         (message_id, revision, channel_id, notify)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id, revision) DO UPDATE SET
         channel_id = excluded.channel_id,
         notify = excluded.notify`,
    )
    .bind(
      task.messageId,
      task.revision,
      task.channelId,
      task.notify === false ? 0 : 1,
    )
    .run();
}

export async function clearMessagePostprocessingJob(
  db: D1Database,
  task: MessagePostprocessingTask,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM message_postprocessing_jobs
       WHERE message_id = ? AND revision = ? AND channel_id = ?`,
    )
    .bind(task.messageId, task.revision, task.channelId)
    .run();
}

export async function retryMessagePostprocessing(
  env: BackgroundTaskRuntimeEnv,
  limit = MESSAGE_POSTPROCESSING_RETRY_LIMIT,
): Promise<void> {
  const db = env.DB;
  if (!db || !env.MEETING_ROOM) {
    throw new Error("Message postprocessing retry bindings are unavailable");
  }
  const safeLimit = Number.isFinite(limit)
    ? Math.max(
        1,
        Math.min(MESSAGE_POSTPROCESSING_RETRY_LIMIT, Math.floor(limit)),
      )
    : MESSAGE_POSTPROCESSING_RETRY_LIMIT;
  const { results } = await db
    .prepare(
      `SELECT message_id, revision, channel_id, notify, attempts
        FROM message_postprocessing_jobs
        WHERE attempts < ? AND next_attempt_at <= ?
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .bind(
      MESSAGE_POSTPROCESSING_MAX_ATTEMPTS,
      new Date().toISOString(),
      safeLimit,
    )
    .all<{
      message_id: string;
      revision: number;
      channel_id: string;
      notify: number;
      attempts: number;
    }>();

  for (const row of results ?? []) {
    const task: MessagePostprocessingTask = {
      messageId: row.message_id,
      channelId: row.channel_id,
      revision: Number(row.revision),
      notify: row.notify !== 0,
    };
    try {
      await processMessageTaskInRuntime(env, task);
      await clearMessagePostprocessingJob(db, task);
    } catch (error: unknown) {
      console.error("Scheduled message postprocessing failed", error);
      const attempts = Math.min(
        MESSAGE_POSTPROCESSING_MAX_ATTEMPTS,
        Number(row.attempts ?? 0) + 1,
      );
      await db
        .prepare(
          `UPDATE message_postprocessing_jobs
           SET attempts = ?, next_attempt_at = ?
           WHERE message_id = ? AND revision = ?`,
        )
        .bind(
          attempts,
          nextMessagePostprocessingAttemptAt(attempts),
          task.messageId,
          task.revision,
        )
        .run();
    }
  }
}

export function scheduleMessagePostprocessing(
  env: BackgroundTaskRuntimeEnv,
  task: MessagePostprocessingTask,
  waitUntil?: (promise: Promise<unknown>) => void,
  options?: { outboxRecorded?: boolean },
): Promise<void> {
  const work = (async () => {
    const db = env.DB;
    if (db && !options?.outboxRecorded) {
      try {
        await recordMessagePostprocessingJob(db, task);
      } catch (error: unknown) {
        console.error(
          "Failed to record message postprocessing fallback",
          error,
        );
      }
    }
    if (env.BACKGROUND_TASKS) {
      try {
        await env.BACKGROUND_TASKS.send(createMessagePostprocessingTask(task), {
          contentType: "json",
        });
        return;
      } catch (error: unknown) {
        console.error(
          "Message postprocessing publish failed; using direct fallback",
          error,
        );
      }
    }
    await processMessageTaskInRuntime(env, task);
    if (db) await clearMessagePostprocessingJob(db, task);
  })();
  const settledWork = work.catch((error: unknown) => {
    console.error("Message postprocessing fallback failed", error);
  });
  if (waitUntil) waitUntil(settledWork);
  return settledWork;
}

export function scheduleR2Cleanup(
  env: BackgroundTaskRuntimeEnv,
  fileKey: string,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<void> {
  const work = (async () => {
    if (env.BACKGROUND_TASKS) {
      try {
        await env.BACKGROUND_TASKS.send(createR2CleanupTask(fileKey), {
          contentType: "json",
        });
        return;
      } catch (error: unknown) {
        console.error(
          "R2 cleanup publish failed; using direct fallback",
          error,
        );
      }
    }

    const db = env.DB;
    const bucket = env.BUCKET;
    if (!db || !bucket) {
      throw new Error("R2 cleanup bindings are unavailable");
    }
    await processR2CleanupTask(db, bucket, { fileKey });
  })();
  const settledWork = work.catch((error: unknown) => {
    console.error("R2 cleanup fallback failed", error);
  });
  if (waitUntil) waitUntil(settledWork);
  return settledWork;
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

    const task = parsed.value.task;
    try {
      if (task.type === PRESENCE_CACHE_INVALIDATE_TASK) {
        await deleteServerMemberCacheKeys(env.CACHE, task.serverIds);
      } else if (task.type === MESSAGE_POSTPROCESS_TASK) {
        await processMessagePostprocessingTask(
          env.DB,
          task,
          (target, event, data) =>
            broadcastTaskEvent(env.MEETING_ROOM, target, event, data),
        );
        await clearMessagePostprocessingJob(env.DB, task);
      } else {
        await processR2CleanupTask(env.DB, env.BUCKET, task);
      }
      message.ack();
    } catch (error: unknown) {
      if (task.type === R2_CLEANUP_TASK) {
        try {
          await recordR2CleanupFailure(env.DB, task.fileKey, error);
        } catch (recordError: unknown) {
          console.error("Failed to persist R2 cleanup retry", recordError);
        }
      }
      console.error(
        "Background task processing failed; retrying message",
        error,
      );
      message.retry();
    }
  }
}
