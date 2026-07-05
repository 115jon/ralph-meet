export interface AlarmStorageLike {
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
}

export function computeEarliestAlarmDeadline(
  now: number,
  deadlines: Iterable<number | null | undefined>,
): number | null {
  let nextAlarm: number | null = null;

  for (const deadline of deadlines) {
    if (typeof deadline !== "number" || !Number.isFinite(deadline)) continue;
    if (deadline <= now) return now;
    nextAlarm = nextAlarm === null ? deadline : Math.min(nextAlarm, deadline);
  }

  return nextAlarm;
}

export async function scheduleEarlierAlarmIfNeeded(
  storage: AlarmStorageLike,
  nextAlarm: number | null | undefined,
  now = Date.now(),
) {
  if (typeof nextAlarm !== "number" || !Number.isFinite(nextAlarm)) return false;

  const currentAlarm = await storage.getAlarm();
  if (currentAlarm === null || currentAlarm <= now || nextAlarm < currentAlarm) {
    await storage.setAlarm(nextAlarm);
    return true;
  }

  return false;
}
