import { describe, expect, it } from "vitest";
import { calculateSpatialAudioMix, calculateSpatialPositions, spatialPanFromPosition } from "../spatial-audio";

const participants = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ userId: `u${index + 1}` }));

describe("spatial audio placement", () => {
  it("places line participants evenly", () => {
    const positions = calculateSpatialPositions(participants(3), {
      placementMode: "line",
      roomSize: 40,
      distance: 60,
      arcAngle: 120,
      manualPositions: {},
    });

    expect(positions.u1.x).toBeLessThan(positions.u2.x);
    expect(positions.u2.x).toBeCloseTo(50);
    expect(positions.u3.x).toBeGreaterThan(positions.u2.x);
    expect(positions.u1.y).toBe(positions.u3.y);
  });

  it("honors arc angle and distance", () => {
    const narrow = calculateSpatialPositions(participants(2), {
      placementMode: "arc",
      roomSize: 40,
      distance: 40,
      arcAngle: 60,
      manualPositions: {},
    });
    const wide = calculateSpatialPositions(participants(2), {
      placementMode: "arc",
      roomSize: 40,
      distance: 80,
      arcAngle: 160,
      manualPositions: {},
    });

    expect(Math.abs(wide.u2.x - wide.u1.x)).toBeGreaterThan(Math.abs(narrow.u2.x - narrow.u1.x));
  });

  it("keeps grid positions within bounds", () => {
    const positions = calculateSpatialPositions(participants(9), {
      placementMode: "grid",
      roomSize: 40,
      distance: 95,
      arcAngle: 120,
      manualPositions: {},
    });

    for (const position of Object.values(positions)) {
      expect(position.x).toBeGreaterThanOrEqual(8);
      expect(position.x).toBeLessThanOrEqual(92);
      expect(position.y).toBeGreaterThanOrEqual(12);
      expect(position.y).toBeLessThanOrEqual(70);
    }
  });

  it("uses manual positions when manual mode is active", () => {
    const positions = calculateSpatialPositions(participants(2), {
      placementMode: "manual",
      roomSize: 40,
      distance: 55,
      arcAngle: 120,
      manualPositions: { u2: { x: 88, y: 22 } },
    });

    expect(positions.u2).toEqual({ x: 88, y: 22 });
  });

  it("maps x position to stereo pan", () => {
    expect(spatialPanFromPosition({ x: 0, y: 50 })).toBe(-1);
    expect(spatialPanFromPosition({ x: 50, y: 50 })).toBe(0);
    expect(spatialPanFromPosition({ x: 100, y: 50 })).toBe(1);
  });

  it("calculates pan and attenuation from room-relative distance", () => {
    const close = calculateSpatialAudioMix({ x: 50, y: 78 }, { x: 58, y: 74 }, 40);
    const far = calculateSpatialAudioMix({ x: 50, y: 78 }, { x: 92, y: 18 }, 40);

    expect(close.pan).toBeGreaterThan(0);
    expect(far.pan).toBeGreaterThan(close.pan);
    expect(far.distanceMeters).toBeGreaterThan(close.distanceMeters);
    expect(far.gain).toBeLessThan(close.gain);
  });
});
