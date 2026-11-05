import type { VoiceTimers } from "../voice-session";

/** Hand-cranked timers: nothing fires until `advance`. */
export class FakeTimers implements VoiceTimers {
  now = 0;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { at: number; callback: () => void }
  >();

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.pending.set(id, { at: this.now + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  get size(): number {
    return this.pending.size;
  }

  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = until;
  }
}

/** Lets every pending promise callback run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}
