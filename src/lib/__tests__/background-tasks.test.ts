import { describe, expect, it, vi } from "vitest";
import {
  createPresenceCacheInvalidationTasks,
  parseBackgroundTask,
  consumeBackgroundTaskBatch,
  scheduleServerMemberCacheInvalidation,
  type BackgroundTaskEnvelope,
} from "../background-tasks";

function createCache(deleteMock: ReturnType<typeof vi.fn>): KVNamespace {
  return { delete: deleteMock } as unknown as KVNamespace;
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
      { CACHE: createCache(deleteMock) },
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
      { CACHE: createCache(vi.fn(async () => undefined)) },
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
      { CACHE: createCache(vi.fn(async () => undefined)) },
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
      { CACHE: createCache(deleteMock) },
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
});
