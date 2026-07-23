import { beforeEach, describe, expect, it, vi } from "vitest";

const processMessagePostprocessingTaskMock = vi.hoisted(() => vi.fn());
const processR2CleanupTaskMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/message.service", () => ({
  processMessagePostprocessingTask: processMessagePostprocessingTaskMock,
}));

vi.mock("@/services/r2-cleanup.service", () => ({
  processR2CleanupTask: processR2CleanupTaskMock,
}));
import {
  createPresenceCacheInvalidationTasks,
  createMessagePostprocessingTask,
  createR2CleanupTask,
  parseBackgroundTask,
  consumeBackgroundTaskBatch,
  scheduleMessagePostprocessing,
  retryMessagePostprocessing,
  type MessagePostprocessingTask,
  scheduleServerMemberCacheInvalidation,
  type BackgroundTaskEnvelope,
} from "../background-tasks";

function createCache(deleteMock: ReturnType<typeof vi.fn>): KVNamespace {
  return { delete: deleteMock } as unknown as KVNamespace;
}

function consumerEnv(cache: KVNamespace): {
  CACHE: KVNamespace;
  DB: D1Database;
  BUCKET: R2Bucket;
  MEETING_ROOM: DurableObjectNamespace;
} {
  return {
    CACHE: cache,
    DB: {} as D1Database,
    BUCKET: {} as R2Bucket,
    MEETING_ROOM: {} as DurableObjectNamespace,
  };
}

function successfulQueue(
  send: ReturnType<typeof vi.fn>,
): Queue<BackgroundTaskEnvelope> {
  return { send } as unknown as Queue<BackgroundTaskEnvelope>;
}

function createMessage(
  body: unknown,
  id: string,
): {
  id: string;
  timestamp: Date;
  body: unknown;
  attempts: number;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
} {
  return {
    id,
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe("background task queue", () => {
  beforeEach(() => {
    processMessagePostprocessingTaskMock.mockReset();
    processR2CleanupTaskMock.mockReset();
  });

  it("validates versioned task envelopes and rejects unknown tasks", () => {
    const [task] = createPresenceCacheInvalidationTasks(["server-1"]);

    expect(parseBackgroundTask(task)).toEqual({ ok: true, value: task });
    expect(parseBackgroundTask({ version: 2, task })).toMatchObject({
      ok: false,
    });
    expect(
      parseBackgroundTask({
        version: 1,
        task: { type: "future.task", serverIds: ["server-1"] },
      }),
    ).toMatchObject({ ok: false });
    expect(parseBackgroundTask({ version: 1, task: null })).toMatchObject({
      ok: false,
    });
  });

  it("creates one compact message postprocessing task with a durable revision", () => {
    const task = createMessagePostprocessingTask({
      messageId: "message-1",
      channelId: "channel-1",
      revision: 7,
    });

    expect(task).toEqual({
      version: 1,
      task: {
        type: "message.postprocess",
        messageId: "message-1",
        channelId: "channel-1",
        revision: 7,
        notify: true,
      },
    });
    expect(parseBackgroundTask(task)).toEqual({ ok: true, value: task });
    expect(
      new TextEncoder().encode(JSON.stringify(task)).byteLength,
    ).toBeLessThan(128 * 1024);
  });

  it("chunks cache invalidations below the Queue message size limit", () => {
    const tasks = createPresenceCacheInvalidationTasks(
      Array.from(
        { length: 10_000 },
        (_, index) => `server-${index}-${"x".repeat(20)}`,
      ),
    );

    expect(tasks.length).toBeGreaterThan(1);
    for (const task of tasks) {
      expect(task.task.serverIds.length).toBeLessThanOrEqual(100);
      expect(
        new TextEncoder().encode(JSON.stringify(task)).byteLength,
      ).toBeLessThan(128 * 1024);
    }
  });

  it("chunks by count even when task IDs are short", () => {
    const [firstTask] = createPresenceCacheInvalidationTasks(
      Array.from({ length: 101 }, (_, index) => `server-${index}`),
    );

    expect(firstTask.task.serverIds).toHaveLength(100);
  });

  it("keeps byte-sized chunks below the message limit", () => {
    const tasks = createPresenceCacheInvalidationTasks(
      Array.from(
        { length: 100 },
        (_, index) => `server-${index}-${"x".repeat(1_300)}`,
      ),
    );

    expect(tasks.length).toBeGreaterThan(1);
    for (const task of tasks) {
      expect(
        new TextEncoder().encode(JSON.stringify(task)).byteLength,
      ).toBeLessThan(128 * 1024);
    }
  });

  it("rejects a single task ID that cannot fit in a Queue message", () => {
    expect(() =>
      createPresenceCacheInvalidationTasks([`server-${"x".repeat(130_000)}`]),
    ).toThrow("exceeds Queue size limit");
  });

  it("rejects oversized current-version task envelopes", () => {
    expect(
      parseBackgroundTask({
        version: 1,
        task: {
          type: "presence.cache.invalidate",
          serverIds: Array.from(
            { length: 101 },
            (_, index) => `server-${index}`,
          ),
        },
      }),
    ).toEqual({ ok: false, reason: "oversized-task" });
  });

  it("acknowledges malformed messages and retries only failed valid tasks", async () => {
    const deleteMock = vi.fn(async (key: string) => {
      if (key.endsWith("server-fail")) throw new Error("KV unavailable");
    });
    const valid = createPresenceCacheInvalidationTasks([
      "server-ok",
      "server-fail",
    ])[0];
    const validMessage = createMessage(valid, "valid");
    const malformedMessage = createMessage({ nope: true }, "malformed");

    await consumeBackgroundTaskBatch(
      {
        queue: "ralph-meet-background-tasks",
        messages: [validMessage, malformedMessage],
      } as unknown as MessageBatch<unknown>,
      consumerEnv(createCache(deleteMock)),
    );

    expect(validMessage.retry).toHaveBeenCalledOnce();
    expect(validMessage.ack).not.toHaveBeenCalled();
    expect(malformedMessage.ack).toHaveBeenCalledOnce();
  });

  it("retries unsupported future task versions for DLQ handling", async () => {
    const message = createMessage(
      {
        version: 2,
        task: { type: "presence.cache.invalidate", serverIds: ["server-1"] },
      },
      "future",
    );

    await consumeBackgroundTaskBatch(
      {
        queue: "ralph-meet-background-tasks",
        messages: [message],
      } as unknown as MessageBatch<unknown>,
      consumerEnv(createCache(vi.fn(async () => undefined))),
    );

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("retries unknown task types for DLQ handling", async () => {
    const message = createMessage(
      {
        version: 1,
        task: { type: "future.task", serverIds: ["server-1"] },
      },
      "unknown",
    );

    await consumeBackgroundTaskBatch(
      {
        queue: "ralph-meet-background-tasks",
        messages: [message],
      } as unknown as MessageBatch<unknown>,
      consumerEnv(createCache(vi.fn(async () => undefined))),
    );

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("makes duplicate cache deletes safe", async () => {
    const deleteMock = vi.fn(async () => undefined);
    const [task] = createPresenceCacheInvalidationTasks([
      "server-1",
      "server-1",
    ]);
    const message = createMessage(task, "duplicate");

    await consumeBackgroundTaskBatch(
      {
        queue: "ralph-meet-background-tasks",
        messages: [message],
      } as unknown as MessageBatch<unknown>,
      consumerEnv(createCache(deleteMock)),
    );

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("falls back to direct invalidation when queue publishing fails", async () => {
    const deleteMock = vi.fn(async () => undefined);
    const sendMock = vi.fn(async () => {
      throw new Error("Queue unavailable");
    });
    const pending: Promise<unknown>[] = [];

    scheduleServerMemberCacheInvalidation(
      {
        CACHE: createCache(deleteMock),
        BACKGROUND_TASKS: successfulQueue(sendMock),
      },
      ["server-1", "server-2"],
      (promise) => pending.push(promise),
    );

    await Promise.all(pending);

    expect(sendMock).toHaveBeenCalledOnce();
    expect(deleteMock).toHaveBeenCalledWith("v1:server:members:server-1");
    expect(deleteMock).toHaveBeenCalledWith("v1:server:members:server-2");
  });

  it("waits for queue publication when no execution context is available", async () => {
    let releaseSend!: () => void;
    const sendMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSend = resolve;
        }),
    );
    const deleteMock = vi.fn(async () => undefined);
    let settled = false;

    const scheduled = scheduleServerMemberCacheInvalidation(
      {
        CACHE: createCache(deleteMock),
        BACKGROUND_TASKS: successfulQueue(sendMock),
      },
      ["server-1"],
    );
    scheduled.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    releaseSend();
    await scheduled;
    expect(settled).toBe(true);
  });

  it("records a message fallback row when queue publication and direct work fail", async () => {
    const calls: string[] = [];
    const db = {
      prepare(sql: string) {
        calls.push(sql);
        return {
          bind() {
            return {
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const send = vi.fn(async () => {
      throw new Error("Queue unavailable");
    });
    processMessagePostprocessingTaskMock.mockRejectedValueOnce(
      new Error("postprocessing unavailable"),
    );
    const pending: Promise<unknown>[] = [];

    scheduleMessagePostprocessing(
      {
        CACHE: createCache(vi.fn(async () => undefined)),
        DB: db,
        BACKGROUND_TASKS: successfulQueue(send),
      },
      {
        messageId: "message-1",
        channelId: "channel-1",
        revision: 3,
        notify: false,
      },
      (promise) => pending.push(promise),
    );

    await Promise.all(pending);

    expect(send).toHaveBeenCalledOnce();
    expect(
      calls.some((sql) => sql.includes("message_postprocessing_jobs")),
    ).toBe(true);
  });

  it("records the message outbox row before attempting Queue publication", async () => {
    const order: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                if (sql.includes("message_postprocessing_jobs")) {
                  order.push("outbox");
                }
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const send = vi.fn(async () => {
      order.push("queue");
    });
    const pending: Promise<unknown>[] = [];

    scheduleMessagePostprocessing(
      {
        CACHE: createCache(vi.fn(async () => undefined)),
        DB: db,
        BACKGROUND_TASKS: successfulQueue(send),
      },
      {
        messageId: "message-1",
        channelId: "channel-1",
        revision: 1,
      },
      (promise) => pending.push(promise),
    );

    await Promise.all(pending);

    expect(order).toEqual(["outbox", "queue"]);
  });

  it("acks successful message and R2 consumer tasks after clearing message outbox work", async () => {
    const calls: string[] = [];
    const db = {
      prepare(sql: string) {
        calls.push(sql);
        return {
          bind() {
            return {
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const message = createMessage(
      createMessagePostprocessingTask({
        messageId: "message-1",
        channelId: "channel-1",
        revision: 1,
      }),
      "message-task",
    );
    const cleanup = createMessage(
      createR2CleanupTask("attachments/file.txt"),
      "cleanup-task",
    );
    processMessagePostprocessingTaskMock.mockResolvedValue(undefined);
    processR2CleanupTaskMock.mockResolvedValue(undefined);

    const env = consumerEnv(createCache(vi.fn(async () => undefined)));
    env.DB = db;
    await consumeBackgroundTaskBatch(
      {
        queue: "ralph-meet-background-tasks",
        messages: [message, cleanup],
      } as unknown as MessageBatch<unknown>,
      env,
    );

    expect(processMessagePostprocessingTaskMock).toHaveBeenCalledOnce();
    expect(processR2CleanupTaskMock).toHaveBeenCalledOnce();
    await expect(
      processMessagePostprocessingTaskMock.mock.results[0]?.value,
    ).resolves.toBe(undefined);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(cleanup.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(cleanup.retry).not.toHaveBeenCalled();
    expect(
      calls.filter((sql) =>
        sql.includes("DELETE FROM message_postprocessing_jobs"),
      ),
    ).toHaveLength(1);
  });

  it("retries failing message and R2 consumer tasks while retaining message outbox work", async () => {
    const calls: string[] = [];
    const db = {
      prepare(sql: string) {
        calls.push(sql);
        return {
          bind() {
            return {
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const message = createMessage(
      createMessagePostprocessingTask({
        messageId: "message-1",
        channelId: "channel-1",
        revision: 1,
      }),
      "message-task-failing",
    );
    const cleanup = createMessage(
      createR2CleanupTask("attachments/file.txt"),
      "cleanup-task-failing",
    );
    processMessagePostprocessingTaskMock.mockRejectedValueOnce(
      new Error("postprocessing unavailable"),
    );
    processR2CleanupTaskMock.mockRejectedValueOnce(
      new Error("cleanup unavailable"),
    );

    const env = consumerEnv(createCache(vi.fn(async () => undefined)));
    env.DB = db;
    await consumeBackgroundTaskBatch(
      {
        queue: "ralph-meet-background-tasks",
        messages: [message, cleanup],
      } as unknown as MessageBatch<unknown>,
      env,
    );

    expect(message.retry).toHaveBeenCalledOnce();
    expect(cleanup.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
    expect(cleanup.ack).not.toHaveBeenCalled();
    expect(
      calls.filter((sql) =>
        sql.includes("DELETE FROM message_postprocessing_jobs"),
      ),
    ).toHaveLength(0);
  });

  it("retries bounded message fallback rows and clears successful rows", async () => {
    const task: MessagePostprocessingTask = {
      messageId: "message-1",
      channelId: "channel-1",
      revision: 1,
      notify: false,
    };
    const calls: string[] = [];
    const db = {
      prepare(sql: string) {
        calls.push(sql);
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [
                    {
                      message_id: task.messageId,
                      channel_id: task.channelId,
                      revision: task.revision,
                      notify: 0,
                    },
                  ],
                };
              },
              async first() {
                return null;
              },
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const realtime = {
      idFromName: vi.fn(() => "global-id"),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response("OK")),
      })),
    } as unknown as DurableObjectNamespace;

    await retryMessagePostprocessing(
      {
        CACHE: createCache(vi.fn(async () => undefined)),
        DB: db,
        MEETING_ROOM: realtime,
      },
      5,
    );

    expect(calls.some((sql) => sql.includes("SELECT message_id"))).toBe(true);
    expect(
      calls.some((sql) =>
        sql.includes("DELETE FROM message_postprocessing_jobs"),
      ),
    ).toBe(true);
  });
});
