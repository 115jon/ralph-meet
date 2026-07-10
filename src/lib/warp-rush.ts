export type WarpRushPreset = "balanced" | "ultra" | "meltdown";

export interface WarpRushCourseObstacle {
  distance: number;
  x: number;
  y: number;
  radius: number;
  wobbleAmpX: number;
  wobbleAmpY: number;
  wobbleFreq: number;
  wobblePhase: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

export interface WarpRushCourseRing {
  distance: number;
  x: number;
  y: number;
  rot: number;
  twist: number;
}

export interface WarpRushCourse {
  loopLength: number;
  introDistance: number;
  obstacles: WarpRushCourseObstacle[];
  rings: WarpRushCourseRing[];
}

export interface WarpRushRunState {
  elapsedSeconds: number;
  worldDistance: number;
  normalizedX: number;
  normalizedY: number;
  shipX: number;
  shipY: number;
  crashed: boolean;
  score: number;
  usedSlipstream: boolean;
}

export interface WarpRushInputState {
  targetX: number;
  targetY: number;
}

export interface WarpRushRemotePilotState {
  x: number;
  y: number;
  worldDistance: number;
  crashed: boolean;
}

export interface WarpRushStepResult {
  collided: boolean;
  slipstream: boolean;
  speed: number;
}

export const WARP_RUSH_STEP_SECONDS = 1 / 120;
export const WARP_RUSH_BASE_SPEED = 58;
export const WARP_RUSH_SLIPSTREAM_BONUS = 0.12;
export const WARP_RUSH_SCORE_PER_UNIT = 10;
export const WARP_RUSH_SHIP_Z = 5.1;
export const WARP_RUSH_SHIP_RANGE_X = 4.3;
export const WARP_RUSH_SHIP_RANGE_Y = 2.8;
export const WARP_RUSH_LOOP_LENGTH = 960;
export const WARP_RUSH_INTRO_DISTANCE = 140;

const COURSE_SEED_VERSION = "warp-rush-v2";
const COURSE_OBSTACLE_COUNT = 58;
const COURSE_RING_COUNT = 18;
const COURSE_SPREAD_X = 4.8;
const COURSE_SPREAD_Y = 3.2;
const COURSE_CLEARANCE_DISTANCE = 15;
const COURSE_CLEARANCE_RADIUS = 2.2;
const TURN_RESPONSE = 7.2;
const COLLISION_PADDING = 0.46;
const EARLY_SAFE_BUFFER = 2.25;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function positiveModulo(value: number, modulus: number) {
  return ((value % modulus) + modulus) % modulus;
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function dampNumber(
  current: number,
  target: number,
  smoothing: number,
  deltaSeconds: number,
) {
  return lerp(current, target, 1 - Math.exp(-smoothing * deltaSeconds));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed: string) {
  let state = hashString(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(rng: () => number, min: number, max: number) {
  return min + (max - min) * rng();
}

export function createWarpRushCourse(
  seedSource: string,
  ringCount = COURSE_RING_COUNT,
): WarpRushCourse {
  const rng = createRng(`${COURSE_SEED_VERSION}:${seedSource}`);
  const obstacles: WarpRushCourseObstacle[] = [];
  const usableLength = WARP_RUSH_LOOP_LENGTH - WARP_RUSH_INTRO_DISTANCE - 48;
  const segmentSpacing = usableLength / COURSE_OBSTACLE_COUNT;

  for (let index = 0; index < COURSE_OBSTACLE_COUNT; index++) {
    const distance =
      WARP_RUSH_INTRO_DISTANCE +
      index * segmentSpacing +
      randomBetween(rng, segmentSpacing * 0.18, segmentSpacing * 0.62);
    let candidate: WarpRushCourseObstacle | null = null;

    for (let attempt = 0; attempt < 24; attempt++) {
      const nextCandidate: WarpRushCourseObstacle = {
        distance,
        x: randomBetween(rng, -COURSE_SPREAD_X, COURSE_SPREAD_X),
        y: randomBetween(rng, -COURSE_SPREAD_Y, COURSE_SPREAD_Y),
        radius: randomBetween(rng, 0.42, 0.88),
        wobbleAmpX: randomBetween(rng, 0.08, 0.34),
        wobbleAmpY: randomBetween(rng, 0.06, 0.24),
        wobbleFreq: randomBetween(rng, 0.05, 0.095),
        wobblePhase: randomBetween(rng, 0, Math.PI * 2),
        spinX: randomBetween(rng, 0.45, 1.25),
        spinY: randomBetween(rng, -1.7, 1.7),
        spinZ: randomBetween(rng, -0.8, 0.8),
        rotX: randomBetween(rng, 0, Math.PI * 2),
        rotY: randomBetween(rng, 0, Math.PI * 2),
        rotZ: randomBetween(rng, 0, Math.PI * 2),
      };

      const needsEarlyClearance = distance < WARP_RUSH_INTRO_DISTANCE + 150;
      const safeBuffer = needsEarlyClearance ? EARLY_SAFE_BUFFER : 1.18;
      if (
        Math.hypot(nextCandidate.x, nextCandidate.y) <
        nextCandidate.radius + safeBuffer
      ) {
        continue;
      }

      const overlaps = obstacles.some(
        (obstacle) =>
          Math.abs(obstacle.distance - nextCandidate.distance) <
            COURSE_CLEARANCE_DISTANCE &&
          Math.hypot(
            obstacle.x - nextCandidate.x,
            obstacle.y - nextCandidate.y,
          ) <
            obstacle.radius + nextCandidate.radius + COURSE_CLEARANCE_RADIUS,
      );
      if (overlaps) {
        continue;
      }

      candidate = nextCandidate;
      break;
    }

    obstacles.push(
      candidate ?? {
        distance,
        x:
          randomBetween(rng, COURSE_SPREAD_X * 0.52, COURSE_SPREAD_X * 0.92) *
          (rng() > 0.5 ? 1 : -1),
        y:
          randomBetween(rng, COURSE_SPREAD_Y * 0.45, COURSE_SPREAD_Y * 0.85) *
          (rng() > 0.5 ? 1 : -1),
        radius: 0.58,
        wobbleAmpX: 0.12,
        wobbleAmpY: 0.09,
        wobbleFreq: 0.07,
        wobblePhase: randomBetween(rng, 0, Math.PI * 2),
        spinX: randomBetween(rng, 0.45, 1.25),
        spinY: randomBetween(rng, -1.7, 1.7),
        spinZ: randomBetween(rng, -0.8, 0.8),
        rotX: randomBetween(rng, 0, Math.PI * 2),
        rotY: randomBetween(rng, 0, Math.PI * 2),
        rotZ: randomBetween(rng, 0, Math.PI * 2),
      },
    );
  }

  const rings: WarpRushCourseRing[] = [];
  const ringSpacing = usableLength / ringCount;
  for (let index = 0; index < ringCount; index++) {
    rings.push({
      distance:
        WARP_RUSH_INTRO_DISTANCE * 0.6 +
        index * ringSpacing +
        randomBetween(rng, ringSpacing * 0.1, ringSpacing * 0.45),
      x: randomBetween(rng, -0.7, 0.7),
      y: randomBetween(rng, -0.55, 0.55),
      rot: randomBetween(rng, 0, Math.PI * 2),
      twist: randomBetween(rng, -0.45, 0.45),
    });
  }

  return {
    loopLength: WARP_RUSH_LOOP_LENGTH,
    introDistance: WARP_RUSH_INTRO_DISTANCE,
    obstacles,
    rings,
  };
}

export function createWarpRushRunState(): WarpRushRunState {
  return {
    elapsedSeconds: 0,
    worldDistance: 0,
    normalizedX: 0,
    normalizedY: 0,
    shipX: 0,
    shipY: 0,
    crashed: false,
    score: 0,
    usedSlipstream: false,
  };
}

export function getWarpRushObstacleOffset(
  obstacle: WarpRushCourseObstacle,
  travelDistance: number,
) {
  const phase = travelDistance * obstacle.wobbleFreq + obstacle.wobblePhase;
  return {
    x: obstacle.x + Math.sin(phase) * obstacle.wobbleAmpX,
    y: obstacle.y + Math.cos(phase * 1.17) * obstacle.wobbleAmpY,
  };
}

export function getWarpRushRelativeDistance(
  distance: number,
  worldDistance: number,
  loopLength: number,
  behindBuffer = 90,
) {
  let relative = distance - positiveModulo(worldDistance, loopLength);
  if (relative < -behindBuffer) {
    relative += loopLength;
  }
  return relative;
}

export function getWarpRushObstacleRenderState(
  obstacle: WarpRushCourseObstacle,
  worldDistance: number,
  loopLength: number,
) {
  const relativeDistance = getWarpRushRelativeDistance(
    obstacle.distance,
    worldDistance,
    loopLength,
  );
  const travelDistance = worldDistance + relativeDistance;
  const offset = getWarpRushObstacleOffset(obstacle, travelDistance);
  return {
    x: offset.x,
    y: offset.y,
    z: WARP_RUSH_SHIP_Z - relativeDistance,
    travelDistance,
  };
}

export function getWarpRushRingRenderState(
  ring: WarpRushCourseRing,
  worldDistance: number,
  loopLength: number,
) {
  const relativeDistance = getWarpRushRelativeDistance(
    ring.distance,
    worldDistance,
    loopLength,
  );
  return {
    x: ring.x,
    y: ring.y,
    z: WARP_RUSH_SHIP_Z - relativeDistance,
  };
}

export function hasWarpRushCollision(
  course: WarpRushCourse,
  previousWorldDistance: number,
  nextWorldDistance: number,
  previousShipX: number,
  previousShipY: number,
  nextShipX: number,
  nextShipY: number,
) {
  const stepDistance = nextWorldDistance - previousWorldDistance;
  if (stepDistance <= 0) return false;

  for (const obstacle of course.obstacles) {
    const loopIndex = Math.floor(
      (previousWorldDistance - obstacle.distance) / course.loopLength,
    );
    for (const offset of [loopIndex, loopIndex + 1]) {
      const collisionDistance = obstacle.distance + offset * course.loopLength;
      if (
        collisionDistance <= previousWorldDistance ||
        collisionDistance > nextWorldDistance
      ) {
        continue;
      }

      const travelProgress =
        (collisionDistance - previousWorldDistance) / stepDistance;
      const shipX = lerp(previousShipX, nextShipX, travelProgress);
      const shipY = lerp(previousShipY, nextShipY, travelProgress);
      const obstacleOffset = getWarpRushObstacleOffset(
        obstacle,
        collisionDistance,
      );
      const collisionRadius = obstacle.radius + COLLISION_PADDING;
      const dx = obstacleOffset.x - shipX;
      const dy = obstacleOffset.y - shipY;
      if (dx * dx + dy * dy < collisionRadius * collisionRadius) {
        return true;
      }
    }
  }

  return false;
}

export function advanceWarpRushRunState(
  state: WarpRushRunState,
  input: WarpRushInputState,
  course: WarpRushCourse,
  remotePilots: WarpRushRemotePilotState[],
  stepSeconds = WARP_RUSH_STEP_SECONDS,
): WarpRushStepResult {
  if (state.crashed) {
    return { collided: true, slipstream: false, speed: 0 };
  }

  const previousShipX = state.shipX;
  const previousShipY = state.shipY;
  const previousWorldDistance = state.worldDistance;

  state.normalizedX = dampNumber(
    state.normalizedX,
    clamp(input.targetX, -1, 1),
    TURN_RESPONSE,
    stepSeconds,
  );
  state.normalizedY = dampNumber(
    state.normalizedY,
    clamp(input.targetY, -1, 1),
    TURN_RESPONSE,
    stepSeconds,
  );
  state.shipX = state.normalizedX * WARP_RUSH_SHIP_RANGE_X;
  state.shipY = state.normalizedY * WARP_RUSH_SHIP_RANGE_Y;

  const slipstream = remotePilots.some((pilot) => {
    if (pilot.crashed) return false;
    const gap = pilot.worldDistance - previousWorldDistance;
    return (
      gap >= 8 &&
      gap <= 20 &&
      Math.abs(pilot.x - previousShipX) <= 2.2 &&
      Math.abs(pilot.y - previousShipY) <= 1.7
    );
  });
  const speed =
    WARP_RUSH_BASE_SPEED * (slipstream ? 1 + WARP_RUSH_SLIPSTREAM_BONUS : 1);
  const nextWorldDistance = previousWorldDistance + speed * stepSeconds;
  const collided = hasWarpRushCollision(
    course,
    previousWorldDistance,
    nextWorldDistance,
    previousShipX,
    previousShipY,
    state.shipX,
    state.shipY,
  );

  state.elapsedSeconds += stepSeconds;
  state.worldDistance = nextWorldDistance;
  state.usedSlipstream = slipstream;
  state.score = Math.round(
    nextWorldDistance * WARP_RUSH_SCORE_PER_UNIT * (slipstream ? 1.04 : 1),
  );
  if (collided) {
    state.crashed = true;
  }

  return {
    collided,
    slipstream,
    speed,
  };
}
