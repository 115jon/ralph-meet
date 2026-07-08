import { describe, expect, it } from "vitest";
import {
  WARP_RUSH_BASE_SPEED,
  WARP_RUSH_INTRO_DISTANCE,
  WARP_RUSH_SHIP_Z,
  WARP_RUSH_STEP_SECONDS,
  advanceWarpRushRunState,
  createWarpRushCourse,
  createWarpRushRunState,
  getWarpRushObstacleRenderState,
  getWarpRushRingRenderState,
} from "./warp-rush";

function runSimulation(frameSeconds: number) {
  const course = createWarpRushCourse("voice-channel-123");
  const state = createWarpRushRunState();
  let elapsed = 0;
  let accumulator = 0;

  while (elapsed < 6 && !state.crashed) {
    const frame = Math.min(frameSeconds, 6 - elapsed);
    elapsed += frame;
    accumulator += frame;
    while (accumulator >= WARP_RUSH_STEP_SECONDS && !state.crashed) {
      const input =
        state.elapsedSeconds < 1.8
          ? { targetX: 0, targetY: 0 }
          : state.elapsedSeconds < 3.4
            ? { targetX: 0.72, targetY: -0.28 }
            : { targetX: -0.46, targetY: 0.34 };
      advanceWarpRushRunState(state, input, course, []);
      accumulator -= WARP_RUSH_STEP_SECONDS;
    }
  }

  return state;
}

describe("warp rush course", () => {
  it("keeps the first obstacle beyond the intro grace distance", () => {
    const course = createWarpRushCourse("voice-channel-123");

    expect(course.obstacles[0]?.distance).toBeGreaterThanOrEqual(WARP_RUSH_INTRO_DISTANCE);
  });

  it("renders upcoming rings and obstacles ahead of the ship", () => {
    const course = createWarpRushCourse("voice-channel-123");
    const obstacle = course.obstacles[0];
    const ring = course.rings[0];
    if (!obstacle || !ring) {
      throw new Error("Expected the course generator to create both obstacles and rings.");
    }

    const obstacleAhead = getWarpRushObstacleRenderState(obstacle, 0, course.loopLength);
    const ringAhead = getWarpRushRingRenderState(ring, 0, course.loopLength);
    const obstacleBehind = getWarpRushObstacleRenderState(obstacle, obstacle.distance + 4, course.loopLength);

    expect(obstacleAhead.z).toBeLessThan(WARP_RUSH_SHIP_Z);
    expect(ringAhead.z).toBeLessThan(WARP_RUSH_SHIP_Z);
    expect(obstacleBehind.z).toBeGreaterThan(WARP_RUSH_SHIP_Z);
  });

  it("produces consistent run progress across very different frame cadences", () => {
    const highFps = runSimulation(1 / 144);
    const lowFps = runSimulation(1 / 20);

    expect(Math.abs(highFps.worldDistance - lowFps.worldDistance)).toBeLessThanOrEqual(WARP_RUSH_BASE_SPEED * WARP_RUSH_STEP_SECONDS + 0.001);
    expect(Math.abs(highFps.score - lowFps.score)).toBeLessThanOrEqual(5);
    expect(highFps.crashed).toBe(lowFps.crashed);
  });

  it("applies a slipstream speed bonus when another pilot is directly ahead", () => {
    const course = createWarpRushCourse("voice-channel-123");
    const state = createWarpRushRunState();
    const result = advanceWarpRushRunState(
      state,
      { targetX: 0, targetY: 0 },
      course,
      [{ x: 0.1, y: 0.05, worldDistance: 12, crashed: false }],
    );

    expect(result.slipstream).toBe(true);
    expect(result.speed).toBeGreaterThan(WARP_RUSH_BASE_SPEED);
  });
});
