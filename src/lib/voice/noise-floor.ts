import { imcra } from "@audio/noise-estimate";

const DEFAULT_FFT_SIZE = 512;
const MIN_ESTIMATE_FRAMES = 80;
const SILENCE_DB = -100;

/** Tracks the sustained spectral floor independently of instantaneous level. */
export class NoiseFloorEstimator {
  private readonly fftSize: number;
  private readonly half: number;
  private readonly estimator: ReturnType<typeof imcra>;
  private readonly magnitudes: Float64Array;
  private frameCount = 0;
  private noiseFloorDb = SILENCE_DB;
  private signalToNoiseRatioDb = 0;

  constructor(fftSize = DEFAULT_FFT_SIZE) {
    this.fftSize = fftSize;
    this.half = fftSize / 2;
    this.estimator = imcra(this.half, { resetEvery: 80 });
    this.magnitudes = new Float64Array(this.half + 1);
  }

  updateFrequencyData(
    data: Float32Array,
    speechPresenceProbability?: number,
  ): number {
    this.magnitudes.fill(0);
    for (let index = 0; index < data.length && index <= this.half; index += 1) {
      const decibels = data[index];
      this.magnitudes[index] = Number.isFinite(decibels)
        ? Math.pow(10, decibels / 20)
        : 0;
    }

    this.estimator.update(this.magnitudes, speechPresenceProbability);
    this.frameCount += 1;

    let power = 0;
    let signalPower = 0;
    for (let index = 0; index <= this.half; index += 1) {
      const weight = index === 0 || index === this.half ? 1 : 2;
      power += this.estimator.psd[index] * weight;
      signalPower += this.magnitudes[index] * this.magnitudes[index] * weight;
    }

    const meanPower = power / this.fftSize;
    this.noiseFloorDb =
      meanPower > 0
        ? Math.max(SILENCE_DB, 10 * Math.log10(meanPower))
        : SILENCE_DB;
    const signalMeanPower = signalPower / this.fftSize;
    this.signalToNoiseRatioDb =
      signalMeanPower > 0 && meanPower > 0
        ? 10 * Math.log10(signalMeanPower / meanPower)
        : 0;
    return this.noiseFloorDb;
  }

  getNoiseFloorDb(): number {
    return this.noiseFloorDb;
  }

  isReady(): boolean {
    return this.frameCount >= MIN_ESTIMATE_FRAMES;
  }

  getSignalToNoiseRatioDb(): number {
    return this.signalToNoiseRatioDb;
  }
}
