import { describe, expect, it } from "vitest";
import { SOUND_IDS } from "../sound-catalog";
import { playSynth } from "../sound-synth";
import { createRecordingContext } from "./audio-recorder";

// The snapshot was checked against the oscillator code that shipped before
// the sound engine (src/lib/sounds.ts at 3.5.1), recorded the same way with
// its setTimeout offsets mapped onto the clock. A diff here changes how a
// built-in sound sounds.
describe("built-in sound recipes", () => {
  it.each(SOUND_IDS)("%s keeps its oscillators and envelopes", (id) => {
    const rec = createRecordingContext();
    playSynth(id, rec.context, rec.out, 0);
    expect(rec.voices()).toMatchSnapshot();
  });

  it("schedules from the given start time without changing the shape", () => {
    for (const id of SOUND_IDS) {
      const at0 = createRecordingContext();
      playSynth(id, at0.context, at0.out, 0);
      const later = createRecordingContext();
      playSynth(id, later.context, later.out, 12.5);
      expect(later.voices(12.5)).toEqual(at0.voices());
    }
  });
});
