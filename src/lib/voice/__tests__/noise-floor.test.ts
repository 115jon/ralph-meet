import { describe, expect, it } from "vitest";
import { NoiseFloorEstimator } from "../noise-floor";

function frequencyFrame(decibels: number): Float32Array {
  return new Float32Array(256).fill(decibels);
}

describe("NoiseFloorEstimator", () => {
  it("warms up from sustained background noise", () => {
    const estimator = new NoiseFloorEstimator();

    for (let index = 0; index < 80; index += 1) {
      estimator.updateFrequencyData(frequencyFrame(-60));
    }

    expect(estimator.isReady()).toBe(true);
    expect(estimator.getNoiseFloorDb()).toBeLessThan(-50);
  });

  it("does not treat a loud transient as the sustained floor", () => {
    const estimator = new NoiseFloorEstimator();

    for (let index = 0; index < 80; index += 1) {
      estimator.updateFrequencyData(frequencyFrame(-60));
    }
    const backgroundFloor = estimator.getNoiseFloorDb();

    const transientFloor = estimator.updateFrequencyData(frequencyFrame(-10));

    expect(transientFloor).toBeLessThan(-50);
    expect(transientFloor).toBeLessThan(backgroundFloor + 10);
  });

  it("keeps speech out of the floor when speech probability is supplied", () => {
    const estimator = new NoiseFloorEstimator();

    for (let index = 0; index < 80; index += 1) {
      estimator.updateFrequencyData(frequencyFrame(-60), 0);
    }
    for (let index = 0; index < 100; index += 1) {
      estimator.updateFrequencyData(frequencyFrame(-20), 1);
    }

    expect(estimator.getNoiseFloorDb()).toBeLessThan(-50);
    expect(estimator.getSignalToNoiseRatioDb()).toBeGreaterThan(20);
  });
});
