// Runs cron jobs independently: each gets its own waitUntil and its own
// catch, so one job throwing can neither reject the others nor settle the
// invocation early (a rejected Promise.all lets the runtime wind the isolate
// down while sibling jobs are still mid-flight).

export type ScheduledJob = {
  name: string;
  run: () => Promise<unknown>;
};

export type ScheduledJobResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
};

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function runScheduledJobs(
  jobs: ScheduledJob[],
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<ScheduledJobResult[]> {
  const tracked = jobs.map((job) => {
    const promise = (async (): Promise<ScheduledJobResult> => {
      const startedAt = Date.now();
      try {
        await job.run();
        return { name: job.name, ok: true, durationMs: Date.now() - startedAt };
      } catch (error) {
        const message = describe(error);
        // Log the message explicitly: an Error object alone logs only its
        // stack frames in Workers observability.
        console.error(`${job.name} failed: ${message}`);
        return {
          name: job.name,
          ok: false,
          durationMs: Date.now() - startedAt,
          error: message,
        };
      }
    })();
    waitUntil(promise);
    return promise;
  });
  return Promise.all(tracked);
}

/**
 * Picks the jobs for a cron expression. Unknown expressions (e.g. a manual
 * "Trigger" from the dashboard with a stale schedule) run everything.
 */
export function selectScheduledJobs<K extends string>(
  cron: string,
  groups: Record<K, { crons: string[]; jobs: ScheduledJob[] }>,
): ScheduledJob[] {
  const all = Object.values(groups) as Array<{
    crons: string[];
    jobs: ScheduledJob[];
  }>;
  const matched = all.filter((group) => group.crons.includes(cron));
  return (matched.length ? matched : all).flatMap((group) => group.jobs);
}
