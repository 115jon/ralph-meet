/**
 * A fake BaseAudioContext that records every oscillator a sound builds:
 * waveform, frequency automation, start/stop times and the gain automation
 * on its way to the output. Lets tests pin a synth recipe exactly.
 */

type Event = [kind: string, value: number, time: number];

class RecordedParam {
  events: Event[] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number) {
    this.events.push(["set", v, t]);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(["linear", v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(["exponential", v, t]);
    return this;
  }
}

class RecordedNode {
  outputs: RecordedNode[] = [];
  constructor(public kind: string) {}
  connect<T extends RecordedNode>(node: T): T {
    this.outputs.push(node);
    return node;
  }
}

class RecordedOscillator extends RecordedNode {
  type = "sine";
  frequency = new RecordedParam(440);
  startAt: number | null = null;
  stopAt: number | null = null;
  constructor() {
    super("oscillator");
  }
  start(t = 0) {
    this.startAt = t;
  }
  stop(t = 0) {
    this.stopAt = t;
  }
}

class RecordedGain extends RecordedNode {
  gain = new RecordedParam(1);
  constructor() {
    super("gain");
  }
}

export interface RecordedVoice {
  type: string;
  frequency: { value: number; events: Event[] };
  start: number | null;
  stop: number | null;
  /** Gain stages from the oscillator to the output, in order. */
  gains: Array<{ value: number; events: Event[] }>;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const roundEvents = (events: Event[]): Event[] =>
  events.map(([k, v, t]) => [k, round(v), round(t)]);

export function createRecordingContext() {
  const oscillators: RecordedOscillator[] = [];
  const destination = new RecordedNode("destination");
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    destination,
    createOscillator() {
      const osc = new RecordedOscillator();
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      return new RecordedGain();
    },
  };
  /** Every oscillator built so far, with times relative to `origin`. */
  const voices = (origin = 0): RecordedVoice[] =>
    oscillators.map((osc) => {
      const gains: RecordedVoice["gains"] = [];
      let node: RecordedNode | undefined = osc.outputs[0];
      while (node instanceof RecordedGain) {
        gains.push({
          value: round(node.gain.value),
          events: roundEvents(
            node.gain.events.map(([k, v, t]) => [k, v, t - origin]),
          ),
        });
        node = node.outputs[0];
      }
      return {
        type: osc.type,
        frequency: {
          value: round(osc.frequency.value),
          events: roundEvents(
            osc.frequency.events.map(([k, v, t]) => [k, v, t - origin]),
          ),
        },
        start: osc.startAt === null ? null : round(osc.startAt - origin),
        stop: osc.stopAt === null ? null : round(osc.stopAt - origin),
        gains,
      };
    });
  const reset = () => {
    oscillators.length = 0;
  };
  return {
    context: context as unknown as BaseAudioContext,
    raw: context,
    out: destination as unknown as AudioNode,
    voices,
    reset,
  };
}
