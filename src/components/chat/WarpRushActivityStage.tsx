import { getAuthAssetUrl } from "@/lib/platform";
import type { SFUClient } from "@/lib/sfu-client";
import {
  type WarpRushPreset,
  type WarpRushRemotePilotState,
  WARP_RUSH_BASE_SPEED,
  WARP_RUSH_SHIP_Z,
  WARP_RUSH_SLIPSTREAM_BONUS,
  WARP_RUSH_STEP_SECONDS,
  advanceWarpRushRunState,
  createWarpRushCourse,
  createWarpRushRunState,
  getWarpRushObstacleRenderState,
  getWarpRushRelativeDistance,
  getWarpRushRingRenderState,
} from "@/lib/warp-rush";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { HIT, PRESS } from "@/components/ui/interaction";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Num } from "@/components/ui/num";
import { useAppActive } from "@/hooks/useAppActive";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

interface WarpRushActivityStageProps {
  sfu: SFUClient | null;
  channelId: string;
  localUserId?: string | null;
  participants: Array<{ userId: string; name: string; avatar?: string | null }>;
}

type RunStatus = "booting" | "running" | "crashed" | "unsupported";

interface LoadPresetConfig {
  label: string;
  starLayers: number;
  starsPerLayer: number;
  dustPerLayer: number;
  debrisCount: number;
  bloomStrength: number;
  obstacleDetail: number;
  ringRadius: number;
}

interface PerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  points: number;
  dpr: number;
}

interface PilotPresenceState {
  userId: string;
  name?: string;
  avatar?: string | null;
  x: number;
  y: number;
  worldDistance: number;
  score: number;
  best: number;
  preset: WarpRushPreset;
  crashed: boolean;
  slipstream: boolean;
  updatedAt: number;
}

interface DebrisState {
  distance: number;
  radius: number;
  angle: number;
  lift: number;
  scale: number;
  drift: number;
  spinX: number;
  spinY: number;
  spinZ: number;
}

const STORAGE_KEY = "voice-warp-rush:best";
const PRESETS: Record<WarpRushPreset, LoadPresetConfig> = {
  balanced: {
    label: "Balanced",
    starLayers: 3,
    starsPerLayer: 7000,
    dustPerLayer: 1800,
    debrisCount: 260,
    bloomStrength: 0.92,
    obstacleDetail: 2,
    ringRadius: 12,
  },
  ultra: {
    label: "High",
    starLayers: 4,
    starsPerLayer: 12000,
    dustPerLayer: 2800,
    debrisCount: 560,
    bloomStrength: 1.12,
    obstacleDetail: 2,
    ringRadius: 12.5,
  },
  meltdown: {
    label: "Max",
    starLayers: 5,
    starsPerLayer: 17000,
    dustPerLayer: 4200,
    debrisCount: 1080,
    bloomStrength: 1.38,
    obstacleDetail: 2,
    ringRadius: 13,
  },
};
const PRESET_ORDER: WarpRushPreset[] = ["balanced", "ultra", "meltdown"];
/** The game renders at most this often, however fast the display refreshes. */
const FRAME_INTERVAL_MS = 1000 / 60;
const RENDER_SCALES = [
  { label: "0.85x", value: 0.85 },
  { label: "1.0x", value: 1 },
  { label: "1.25x", value: 1.25 },
] as const;
const GHOST_COLORS = [
  "#67e8f9",
  "#f472b6",
  "#facc15",
  "#a78bfa",
  "#4ade80",
  "#fb923c",
];

function readBestScore() {
  if (typeof window === "undefined") return 0;
  const value = Number(window.localStorage.getItem(STORAGE_KEY) ?? "0");
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function writeBestScore(value: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      String(Math.max(0, Math.round(value))),
    );
  } catch {
    // Best score is non-critical.
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatStat(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function buildStarGeometry(
  count: number,
  radius: number,
  depth: number,
  colorA: THREE.ColorRepresentation,
  colorB: THREE.ColorRepresentation,
) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  const from = new THREE.Color(colorA);
  const to = new THREE.Color(colorB);

  for (let index = 0; index < count; index++) {
    const distance = radius + Math.random() * radius;
    const angle = Math.random() * Math.PI * 2;
    const tilt = (Math.random() - 0.5) * Math.PI * 0.7;
    const i3 = index * 3;
    positions[i3] = Math.cos(angle) * distance;
    positions[i3 + 1] = Math.sin(tilt) * radius * 0.85;
    positions[i3 + 2] = -Math.random() * depth;
    color.copy(from).lerp(to, Math.random());
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function buildDebrisField(count: number, loopLength: number) {
  return Array.from(
    { length: count },
    (_, index): DebrisState => ({
      distance: 20 + (index / count) * loopLength,
      radius: 6.8 + (index % 19) * 0.36,
      angle: (index * 0.73) % (Math.PI * 2),
      lift: ((index * 17) % 29) / 29 - 0.5,
      scale: 0.08 + (index % 7) * 0.022,
      drift: 0.18 + (index % 11) * 0.045,
      spinX: 0.18 + (index % 5) * 0.09,
      spinY: 0.26 + (index % 7) * 0.06,
      spinZ: 0.16 + (index % 9) * 0.05,
    }),
  );
}

function createGhostShip(colorHex: string) {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1.15, 7),
    new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.7,
      metalness: 0.55,
      roughness: 0.25,
      transparent: true,
      opacity: 0.72,
    }),
  );
  hull.rotation.x = Math.PI / 2;
  hull.position.z = 0.04;
  const fin = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.05, 0.3),
    new THREE.MeshStandardMaterial({
      color: "#e2e8f0",
      emissive: colorHex,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.55,
    }),
  );
  fin.position.z = -0.32;
  group.add(hull, fin);
  return { group, hull, fin };
}

function isLikelySoftwareRenderer(label: string) {
  return /swiftshader|software|llvmpipe|mesa|basic render/i.test(label);
}

export function WarpRushActivityStage({
  sfu,
  channelId,
  localUserId,
  participants,
}: WarpRushActivityStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef<() => void>(() => {});
  const [bestScore, setBestScore] = useState(readBestScore);
  const bestRef = useRef(bestScore);
  const emitPresenceRef = useRef<
    (
      state: Pick<
        PilotPresenceState,
        "x" | "y" | "worldDistance" | "score" | "crashed" | "slipstream"
      >,
    ) => void
  >(() => {});
  const localPresenceRef = useRef<PilotPresenceState | null>(null);
  const remotePilotsRef = useRef<Record<string, PilotPresenceState>>({});
  const [preset, setPreset] = useState<WarpRushPreset>("ultra");
  const [renderScale, setRenderScale] = useState<number>(1);
  const [status, setStatus] = useState<RunStatus>("booting");
  const [score, setScore] = useState(0);
  const [slipstreamActive, setSlipstreamActive] = useState(false);
  const [nearestRivalGap, setNearestRivalGap] = useState<number | null>(null);
  const [perfStats, setPerfStats] = useState<PerfStats>({
    fps: 0,
    frameMs: 0,
    drawCalls: 0,
    triangles: 0,
    points: 0,
    dpr: 1,
  });
  const [rendererLabel, setRendererLabel] = useState("Booting renderer...");
  const [statsOpen, setStatsOpen] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  // The render loop runs only while the app is worth drawing: visible, and
  // not unfocused behind a fullscreen game (talk-tree-spec §5f). The scene
  // effect registers its start/stop here so a change never rebuilds the scene.
  const appActive = useAppActive();
  const appActiveRef = useRef(appActive);
  const syncLoopRef = useRef<() => void>(() => {});
  const statsOpenRef = useRef(statsOpen);
  const [pilotStates, setPilotStates] = useState<
    Record<string, PilotPresenceState>
  >({});

  const localPilot = useMemo(
    () =>
      participants.find((participant) => participant.userId === localUserId) ??
      null,
    [participants, localUserId],
  );
  const participantMap = useMemo(
    () =>
      new Map(
        participants.map((participant) => [participant.userId, participant]),
      ),
    [participants],
  );
  const course = useMemo(
    () => createWarpRushCourse(`voice:${channelId}`),
    [channelId],
  );

  useEffect(() => {
    bestRef.current = bestScore;
  }, [bestScore]);

  useEffect(() => {
    appActiveRef.current = appActive;
    syncLoopRef.current();
  }, [appActive]);

  useEffect(() => {
    statsOpenRef.current = statsOpen;
  }, [statsOpen]);

  useEffect(() => {
    remotePilotsRef.current = Object.fromEntries(
      Object.entries(pilotStates).filter(([userId]) => userId !== localUserId),
    );
  }, [pilotStates, localUserId]);

  const emitPresence = useCallback(
    (
      nextState: Pick<
        PilotPresenceState,
        "x" | "y" | "worldDistance" | "score" | "crashed" | "slipstream"
      >,
    ) => {
      if (!localUserId) return;
      const entry: PilotPresenceState = {
        userId: localUserId,
        name: localPilot?.name ?? "Pilot",
        avatar: localPilot?.avatar ?? null,
        x: nextState.x,
        y: nextState.y,
        worldDistance: nextState.worldDistance,
        score: nextState.score,
        best: Math.max(bestRef.current, nextState.score),
        preset,
        crashed: nextState.crashed,
        slipstream: nextState.slipstream,
        updatedAt: Date.now(),
      };
      localPresenceRef.current = entry;
      setPilotStates((current) => ({ ...current, [entry.userId]: entry }));
      if (!sfu) return;
      sfu.voiceGW.sendAppEvent({
        type: "warp-rush.player.state",
        channelId,
        userId: entry.userId,
        name: entry.name,
        avatar: entry.avatar,
        x: entry.x,
        y: entry.y,
        worldDistance: entry.worldDistance,
        score: entry.score,
        best: entry.best,
        preset: entry.preset,
        crashed: entry.crashed,
        slipstream: entry.slipstream,
        updatedAt: entry.updatedAt,
      });
    },
    [channelId, localPilot?.avatar, localPilot?.name, localUserId, preset, sfu],
  );

  useEffect(() => {
    emitPresenceRef.current = emitPresence;
  }, [emitPresence]);

  useEffect(() => {
    if (!sfu || !localUserId) return;

    const respondWithLocalState = () => {
      const currentState = localPresenceRef.current;
      if (!currentState) return;
      sfu.voiceGW.sendAppEvent({
        type: "warp-rush.player.state",
        channelId,
        userId: currentState.userId,
        name: currentState.name,
        avatar: currentState.avatar,
        x: currentState.x,
        y: currentState.y,
        worldDistance: currentState.worldDistance,
        score: currentState.score,
        best: currentState.best,
        preset: currentState.preset,
        crashed: currentState.crashed,
        slipstream: currentState.slipstream,
        updatedAt: Date.now(),
      });
    };

    const requestId = window.setTimeout(() => {
      sfu.voiceGW.sendAppEvent({
        type: "warp-rush.presence.request",
        channelId,
        userId: localUserId,
      });
    }, 180);

    const unsubscribe = sfu.on("app-event", (event) => {
      if (event.channelId !== channelId) return;
      if (
        event.type === "warp-rush.presence.request" &&
        typeof event.userId === "string" &&
        event.userId !== localUserId
      ) {
        respondWithLocalState();
        return;
      }

      if (
        event.type !== "warp-rush.player.state" ||
        typeof event.userId !== "string" ||
        event.userId === localUserId
      ) {
        return;
      }

      const userId = event.userId;
      setPilotStates((current) => ({
        ...current,
        [userId]: {
          userId,
          name:
            typeof event.name === "string" ? event.name : current[userId]?.name,
          avatar:
            typeof event.avatar === "string"
              ? event.avatar
              : (current[userId]?.avatar ?? null),
          x: typeof event.x === "number" ? event.x : (current[userId]?.x ?? 0),
          y: typeof event.y === "number" ? event.y : (current[userId]?.y ?? 0),
          worldDistance:
            typeof event.worldDistance === "number"
              ? event.worldDistance
              : (current[userId]?.worldDistance ?? 0),
          score:
            typeof event.score === "number"
              ? Math.max(0, Math.round(event.score))
              : (current[userId]?.score ?? 0),
          best:
            typeof event.best === "number"
              ? Math.max(0, Math.round(event.best))
              : (current[userId]?.best ?? 0),
          preset:
            event.preset === "balanced" ||
            event.preset === "ultra" ||
            event.preset === "meltdown"
              ? event.preset
              : (current[userId]?.preset ?? "balanced"),
          crashed: event.crashed === true,
          slipstream: event.slipstream === true,
          updatedAt:
            typeof event.updatedAt === "number" ? event.updatedAt : Date.now(),
        },
      }));
    });

    return () => {
      window.clearTimeout(requestId);
      unsubscribe?.();
    };
  }, [channelId, localUserId, sfu]);

  useEffect(() => {
    const container = stageRef.current;
    if (!container) return;

    const config = PRESETS[preset];
    const runState = createWarpRushRunState();
    const debrisField = buildDebrisField(config.debrisCount, course.loopLength);
    const obstacleTmp = new THREE.Object3D();
    const ringTmp = new THREE.Object3D();
    const debrisTmp = new THREE.Object3D();
    const scene = new THREE.Scene();
    const cleanupFns: Array<() => void> = [];
    let disposed = false;
    let accumulator = 0;
    let lastTimestamp = 0;
    let nextFrameAt = 0;
    let loopRunning = false;
    let fpsFrames = 0;
    let fpsElapsed = 0;
    let hudElapsed = 0;
    let broadcastElapsed = 0;
    let crashBroadcasted = false;
    let lastCommittedBest = bestRef.current;
    const pointer = { x: 0, y: 0 };
    const keys = { left: false, right: false, up: false, down: false };
    const ghostShipMap = new Map<string, ReturnType<typeof createGhostShip>>();

    scene.background = new THREE.Color("#020617");
    scene.fog = new THREE.FogExp2("#020617", 0.0165);

    const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 420);
    camera.position.set(0, 0.9, 8.5);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (error) {
      console.warn("Warp Rush: WebGL renderer failed to initialize", error);
      queueMicrotask(() => {
        if (disposed) return;
        setStatus("unsupported");
      });
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setClearColor("#020617");
    renderer.domElement.className = "h-full w-full";
    cleanupFns.push(() => renderer.dispose());

    const gl = renderer.getContext();
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const rawRenderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : `${renderer.capabilities.isWebGL2 ? "WebGL2" : "WebGL"} renderer`;
    const finalRendererLabel = `${renderer.capabilities.isWebGL2 ? "WebGL2" : "WebGL"} - ${rawRenderer}`;
    queueMicrotask(() => {
      if (disposed) return;
      setRendererLabel(finalRendererLabel);
      setStatus("running");
    });

    container.replaceChildren(renderer.domElement);
    cleanupFns.push(() => container.replaceChildren());

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      config.bloomStrength,
      0.36,
      0.18,
    );
    composer.addPass(bloomPass);

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      const dpr = clamp(window.devicePixelRatio * renderScale, 0.75, 2.25);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      bloomPass.setSize(width, height);
      setPerfStats((current) => ({ ...current, dpr: Number(dpr.toFixed(2)) }));
    };

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      cleanupFns.push(() => observer.disconnect());
    } else {
      window.addEventListener("resize", resize);
      cleanupFns.push(() => window.removeEventListener("resize", resize));
    }

    const ambient = new THREE.AmbientLight("#9dd6ff", 0.95);
    const keyLight = new THREE.DirectionalLight("#7dd3fc", 1.9);
    keyLight.position.set(4, 6, 6);
    const rimLight = new THREE.PointLight("#fb923c", 12, 70, 2.1);
    rimLight.position.set(-6, 2, 10);
    scene.add(ambient, keyLight, rimLight);

    const ship = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.ConeGeometry(0.38, 1.6, 7),
      new THREE.MeshStandardMaterial({
        color: "#67e8f9",
        emissive: "#0ea5e9",
        emissiveIntensity: 1.1,
        metalness: 0.75,
        roughness: 0.15,
      }),
    );
    hull.rotation.x = Math.PI / 2;
    hull.position.z = 0.05;
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.06, 0.42),
      new THREE.MeshStandardMaterial({
        color: "#f8fafc",
        emissive: "#fb923c",
        emissiveIntensity: 0.65,
        metalness: 0.35,
        roughness: 0.2,
      }),
    );
    fin.position.z = -0.4;
    ship.add(hull, fin);
    ship.position.set(0, 0, WARP_RUSH_SHIP_Z);
    scene.add(ship);

    const ghostGroup = new THREE.Group();
    scene.add(ghostGroup);

    cleanupFns.push(() => {
      (hull.geometry as THREE.BufferGeometry).dispose();
      (hull.material as THREE.Material).dispose();
      (fin.geometry as THREE.BufferGeometry).dispose();
      (fin.material as THREE.Material).dispose();
      for (const ghost of ghostShipMap.values()) {
        (ghost.hull.geometry as THREE.BufferGeometry).dispose();
        (ghost.hull.material as THREE.Material).dispose();
        (ghost.fin.geometry as THREE.BufferGeometry).dispose();
        (ghost.fin.material as THREE.Material).dispose();
      }
    });

    const obstacleGeometry = new THREE.IcosahedronGeometry(
      1,
      config.obstacleDetail,
    );
    const obstacleMaterial = new THREE.MeshStandardMaterial({
      color: "#f97316",
      emissive: "#fb7185",
      emissiveIntensity: 0.78,
      flatShading: true,
      metalness: 0.55,
      roughness: 0.3,
    });
    const obstaclesMesh = new THREE.InstancedMesh(
      obstacleGeometry,
      obstacleMaterial,
      course.obstacles.length,
    );
    obstaclesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(obstaclesMesh);

    const ringGeometry = new THREE.TorusGeometry(
      config.ringRadius,
      0.18,
      18,
      80,
    );
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: "#22d3ee",
      emissive: "#38bdf8",
      emissiveIntensity: 1.12,
      metalness: 0.2,
      roughness: 0.16,
    });
    const ringsMesh = new THREE.InstancedMesh(
      ringGeometry,
      ringMaterial,
      course.rings.length,
    );
    ringsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(ringsMesh);

    const debrisGeometry = new THREE.DodecahedronGeometry(0.42, 0);
    const debrisMaterial = new THREE.MeshStandardMaterial({
      color: "#c084fc",
      emissive: "#22d3ee",
      emissiveIntensity: 0.46,
      metalness: 0.3,
      roughness: 0.35,
      transparent: true,
      opacity: 0.74,
    });
    const debrisMesh = new THREE.InstancedMesh(
      debrisGeometry,
      debrisMaterial,
      debrisField.length,
    );
    debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(debrisMesh);

    cleanupFns.push(() => {
      obstacleGeometry.dispose();
      obstacleMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      debrisGeometry.dispose();
      debrisMaterial.dispose();
    });

    const starMaterials: THREE.PointsMaterial[] = [];
    const starGeometries: THREE.BufferGeometry[] = [];
    const starLayers: Array<{
      mesh: THREE.Points;
      speed: number;
      span: number;
    }> = [];
    for (let index = 0; index < config.starLayers; index++) {
      const geometry = buildStarGeometry(
        config.starsPerLayer,
        18 + index * 6,
        260,
        index % 2 === 0 ? "#67e8f9" : "#f9a8d4",
        index % 2 === 0 ? "#d946ef" : "#fef08a",
      );
      const material = new THREE.PointsMaterial({
        size: index === 0 ? 0.08 : 0.065,
        transparent: true,
        opacity: 0.78 - index * 0.08,
        vertexColors: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      points.position.z = -index * 52;
      scene.add(points);
      starGeometries.push(geometry);
      starMaterials.push(material);
      starLayers.push({
        mesh: points,
        speed: WARP_RUSH_BASE_SPEED * (0.18 + index * 0.04),
        span: 260,
      });
    }

    const dustGeometry = buildStarGeometry(
      config.dustPerLayer,
      6.6,
      210,
      "#ffffff",
      "#38bdf8",
    );
    const dustMaterial = new THREE.PointsMaterial({
      size: 0.14,
      transparent: true,
      opacity: 0.42,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dust = new THREE.Points(dustGeometry, dustMaterial);
    scene.add(dust);

    cleanupFns.push(() => {
      dustGeometry.dispose();
      dustMaterial.dispose();
      for (const geometry of starGeometries) geometry.dispose();
      for (const material of starMaterials) material.dispose();
    });

    const resetRun = () => {
      const fresh = createWarpRushRunState();
      runState.elapsedSeconds = fresh.elapsedSeconds;
      runState.worldDistance = fresh.worldDistance;
      runState.normalizedX = fresh.normalizedX;
      runState.normalizedY = fresh.normalizedY;
      runState.shipX = fresh.shipX;
      runState.shipY = fresh.shipY;
      runState.crashed = fresh.crashed;
      runState.score = fresh.score;
      runState.usedSlipstream = fresh.usedSlipstream;
      pointer.x = 0;
      pointer.y = 0;
      keys.left = false;
      keys.right = false;
      keys.up = false;
      keys.down = false;
      accumulator = 0;
      lastTimestamp = 0;
      nextFrameAt = 0;
      crashBroadcasted = false;
      setScore(0);
      setSlipstreamActive(false);
      setNearestRivalGap(null);
      setStatus("running");
      emitPresenceRef.current({
        x: 0,
        y: 0,
        worldDistance: 0,
        score: 0,
        crashed: false,
        slipstream: false,
      });
    };

    restartRef.current = resetRun;

    const onPointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.x = clamp(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -1,
        1,
      );
      pointer.y = clamp(
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
        -1,
        1,
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "a" || event.key === "ArrowLeft") keys.left = true;
      if (event.key === "d" || event.key === "ArrowRight") keys.right = true;
      if (event.key === "w" || event.key === "ArrowUp") keys.up = true;
      if (event.key === "s" || event.key === "ArrowDown") keys.down = true;
      if (event.key === " " && runState.crashed) {
        event.preventDefault();
        resetRun();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "a" || event.key === "ArrowLeft") keys.left = false;
      if (event.key === "d" || event.key === "ArrowRight") keys.right = false;
      if (event.key === "w" || event.key === "ArrowUp") keys.up = false;
      if (event.key === "s" || event.key === "ArrowDown") keys.down = false;
    };
    container.addEventListener("pointermove", onPointerMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    cleanupFns.push(() => {
      container.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    });

    const getGhostColor = (userId: string) =>
      GHOST_COLORS[
        Math.abs(
          Array.from(userId).reduce(
            (sum, character) => sum + character.charCodeAt(0),
            0,
          ),
        ) % GHOST_COLORS.length
      ];

    const renderFrame = (timestamp: number) => {
      if (disposed) return;

      // 60 fps cap: a 120 or 144 Hz display would otherwise run the whole sim
      // and the bloom pass at double speed for no visible gain. The 1ms slack
      // keeps vsync jitter from dropping a frame on a 60 Hz display.
      if (timestamp + 1 < nextFrameAt) return;
      nextFrameAt =
        nextFrameAt && timestamp - nextFrameAt < FRAME_INTERVAL_MS
          ? nextFrameAt + FRAME_INTERVAL_MS
          : timestamp + FRAME_INTERVAL_MS;

      if (!lastTimestamp) lastTimestamp = timestamp;
      const frameSeconds = clamp(
        (timestamp - lastTimestamp) / 1000,
        0.001,
        0.1,
      );
      lastTimestamp = timestamp;
      accumulator = Math.min(
        accumulator + frameSeconds,
        WARP_RUSH_STEP_SECONDS * 8,
      );

      const activeRemotePilots: WarpRushRemotePilotState[] = Object.values(
        remotePilotsRef.current,
      )
        .filter((pilot) => Date.now() - pilot.updatedAt < 6000)
        .map((pilot) => ({
          x: pilot.x,
          y: pilot.y,
          worldDistance: pilot.worldDistance,
          crashed: pilot.crashed,
        }));

      let latestStep = {
        collided: false,
        slipstream: runState.usedSlipstream,
        speed: WARP_RUSH_BASE_SPEED,
      };
      let stepCount = 0;
      while (accumulator >= WARP_RUSH_STEP_SECONDS && stepCount < 8) {
        const keyboardX = (keys.right ? 0.72 : 0) - (keys.left ? 0.72 : 0);
        const keyboardY = (keys.up ? 0.72 : 0) - (keys.down ? 0.72 : 0);
        const input = {
          targetX: clamp(pointer.x + keyboardX, -1, 1),
          targetY: clamp(pointer.y + keyboardY, -1, 1),
        };
        latestStep = advanceWarpRushRunState(
          runState,
          input,
          course,
          activeRemotePilots,
          WARP_RUSH_STEP_SECONDS,
        );
        accumulator -= WARP_RUSH_STEP_SECONDS;
        stepCount += 1;

        if (runState.score > bestRef.current) {
          bestRef.current = runState.score;
        }

        if (latestStep.collided && !crashBroadcasted) {
          crashBroadcasted = true;
          setStatus("crashed");
          emitPresenceRef.current({
            x: runState.shipX,
            y: runState.shipY,
            worldDistance: runState.worldDistance,
            score: runState.score,
            crashed: true,
            slipstream: runState.usedSlipstream,
          });
        }
      }

      ship.position.x = runState.shipX;
      ship.position.y = runState.shipY;
      ship.rotation.z = -runState.normalizedX * 0.42;
      ship.rotation.x = -runState.normalizedY * 0.2 + 0.04;

      camera.position.x = THREE.MathUtils.damp(
        camera.position.x,
        runState.normalizedX * 1.15,
        3.8,
        frameSeconds,
      );
      camera.position.y = THREE.MathUtils.damp(
        camera.position.y,
        runState.normalizedY * 0.85 + 0.9,
        3.8,
        frameSeconds,
      );
      camera.lookAt(
        runState.normalizedX * 1.65,
        runState.normalizedY * 1.15,
        -24,
      );

      rimLight.position.x = runState.normalizedX * 4 - 3;
      rimLight.position.y = runState.normalizedY * 2 + 1.2;

      for (const starLayer of starLayers) {
        starLayer.mesh.position.z +=
          latestStep.speed *
          frameSeconds *
          (starLayer.speed / WARP_RUSH_BASE_SPEED);
        if (starLayer.mesh.position.z > 40) {
          starLayer.mesh.position.z = -starLayer.span;
        }
        starLayer.mesh.rotation.z += frameSeconds * 0.012;
      }

      dust.rotation.z += frameSeconds * 0.08;
      dust.rotation.x += frameSeconds * 0.015;

      for (let index = 0; index < course.rings.length; index++) {
        const ring = course.rings[index];
        const ringState = getWarpRushRingRenderState(
          ring,
          runState.worldDistance,
          course.loopLength,
        );
        ringTmp.position.set(ringState.x, ringState.y, ringState.z);
        ringTmp.rotation.set(
          Math.PI / 2 + ring.twist * 0.22,
          ring.rot + runState.worldDistance * 0.006,
          ring.rot * 0.5,
        );
        ringTmp.updateMatrix();
        ringsMesh.setMatrixAt(index, ringTmp.matrix);
      }
      ringsMesh.instanceMatrix.needsUpdate = true;

      for (let index = 0; index < course.obstacles.length; index++) {
        const obstacle = course.obstacles[index];
        const obstacleState = getWarpRushObstacleRenderState(
          obstacle,
          runState.worldDistance,
          course.loopLength,
        );
        obstacleTmp.position.set(
          obstacleState.x,
          obstacleState.y,
          obstacleState.z,
        );
        obstacleTmp.rotation.set(
          obstacle.rotX + obstacleState.travelDistance * obstacle.spinX * 0.018,
          obstacle.rotY + obstacleState.travelDistance * obstacle.spinY * 0.016,
          obstacle.rotZ + obstacleState.travelDistance * obstacle.spinZ * 0.012,
        );
        obstacleTmp.scale.setScalar(obstacle.radius);
        obstacleTmp.updateMatrix();
        obstaclesMesh.setMatrixAt(index, obstacleTmp.matrix);
      }
      obstaclesMesh.instanceMatrix.needsUpdate = true;

      for (let index = 0; index < debrisField.length; index++) {
        const debris = debrisField[index];
        const relativeDistance = getWarpRushRelativeDistance(
          debris.distance,
          runState.worldDistance * 1.12,
          course.loopLength,
        );
        const travelDistance = runState.worldDistance + relativeDistance;
        const angle = debris.angle + travelDistance * debris.drift * 0.012;
        debrisTmp.position.set(
          Math.cos(angle) * debris.radius,
          debris.lift * 7 + Math.sin(angle * 1.3) * 1.4,
          WARP_RUSH_SHIP_Z - relativeDistance,
        );
        debrisTmp.rotation.set(
          travelDistance * debris.spinX * 0.02,
          travelDistance * debris.spinY * 0.016,
          travelDistance * debris.spinZ * 0.018,
        );
        debrisTmp.scale.setScalar(debris.scale);
        debrisTmp.updateMatrix();
        debrisMesh.setMatrixAt(index, debrisTmp.matrix);
      }
      debrisMesh.instanceMatrix.needsUpdate = true;

      const activeGhostIds = new Set<string>();
      for (const [userId, pilot] of Object.entries(remotePilotsRef.current)) {
        const age = Date.now() - pilot.updatedAt;
        const gap = pilot.worldDistance - runState.worldDistance;
        if (age > 6000 || gap < -24 || gap > 240 || pilot.crashed) {
          const ghost = ghostShipMap.get(userId);
          if (ghost) ghost.group.visible = false;
          continue;
        }

        let ghost = ghostShipMap.get(userId);
        if (!ghost) {
          ghost = createGhostShip(getGhostColor(userId));
          ghost.group.visible = false;
          ghostGroup.add(ghost.group);
          ghostShipMap.set(userId, ghost);
        }

        activeGhostIds.add(userId);
        ghost.group.visible = true;
        ghost.group.position.set(pilot.x, pilot.y, WARP_RUSH_SHIP_Z - gap);
        ghost.group.rotation.z = -clamp(pilot.x / 4.3, -1, 1) * 0.42;
        ghost.group.rotation.x = -clamp(pilot.y / 2.8, -1, 1) * 0.2 + 0.04;
      }
      for (const [userId, ghost] of ghostShipMap.entries()) {
        if (!activeGhostIds.has(userId)) {
          ghost.group.visible = false;
        }
      }

      if (!runState.crashed) {
        broadcastElapsed += frameSeconds;
        if (broadcastElapsed >= 0.12) {
          broadcastElapsed = 0;
          emitPresenceRef.current({
            x: runState.shipX,
            y: runState.shipY,
            worldDistance: runState.worldDistance,
            score: runState.score,
            crashed: false,
            slipstream: runState.usedSlipstream,
          });
        }
      }

      hudElapsed += frameSeconds;
      if (hudElapsed >= 0.08) {
        hudElapsed = 0;
        const nearestAhead =
          activeRemotePilots
            .map((pilot) => pilot.worldDistance - runState.worldDistance)
            .filter((gap) => gap >= 0)
            .sort((left, right) => left - right)[0] ?? null;
        if (bestRef.current !== lastCommittedBest) {
          lastCommittedBest = bestRef.current;
          writeBestScore(lastCommittedBest);
          setBestScore(lastCommittedBest);
        }
        setScore(runState.score);
        setSlipstreamActive(runState.usedSlipstream);
        setNearestRivalGap(nearestAhead);
      }

      composer.render();

      fpsFrames += 1;
      fpsElapsed += frameSeconds;
      if (fpsElapsed >= 0.24) {
        // Telemetry is only worth a re-render while someone is reading it.
        if (statsOpenRef.current) {
          const fps = fpsFrames / fpsElapsed;
          setPerfStats({
            fps: Math.round(fps),
            frameMs: Number((1000 / Math.max(fps, 1)).toFixed(1)),
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            points: renderer.info.render.points,
            dpr: Number(renderer.getPixelRatio().toFixed(2)),
          });
        }
        fpsFrames = 0;
        fpsElapsed = 0;
      }
    };

    // Start and stop the loop with the app: stopped, nothing is simulated or
    // drawn (the run holds still); on resume the clocks restart so the gap is
    // not treated as one long frame.
    const startLoop = () => {
      if (loopRunning || disposed) return;
      loopRunning = true;
      lastTimestamp = 0;
      nextFrameAt = 0;
      renderer.setAnimationLoop(renderFrame);
    };
    const stopLoop = () => {
      if (!loopRunning) return;
      loopRunning = false;
      renderer.setAnimationLoop(null);
    };
    const syncLoop = () => {
      if (appActiveRef.current && document.visibilityState !== "hidden") {
        startLoop();
      } else {
        stopLoop();
      }
    };
    syncLoopRef.current = syncLoop;
    document.addEventListener("visibilitychange", syncLoop);
    cleanupFns.push(() =>
      document.removeEventListener("visibilitychange", syncLoop),
    );

    resize();
    resetRun();
    syncLoop();

    return () => {
      disposed = true;
      stopLoop();
      syncLoopRef.current = () => {};
      for (const cleanup of cleanupFns.reverse()) cleanup();
    };
  }, [bootAttempt, channelId, course, preset, renderScale]);

  // Stale pilots drop off the board; a slow clock keeps render pure. It stops
  // with the app, like the render loop.
  const [leaderboardNow, setLeaderboardNow] = useState(() => Date.now());
  useEffect(() => {
    if (!appActive) return;
    const id = window.setInterval(() => setLeaderboardNow(Date.now()), 2000);
    return () => window.clearInterval(id);
  }, [appActive]);
  const sortedLeaderboard = useMemo(
    () =>
      Object.values(pilotStates)
        .filter(
          (entry) =>
            leaderboardNow - entry.updatedAt < 12000 ||
            entry.userId === localUserId,
        )
        .sort(
          (left, right) =>
            right.best - left.best ||
            right.score - left.score ||
            right.updatedAt - left.updatedAt,
        )
        .slice(0, 8),
    [leaderboardNow, localUserId, pilotStates],
  );
  const softwareRendererLikely = isLikelySoftwareRenderer(rendererLabel);
  const remotePilotCount = sortedLeaderboard.reduce(
    (count, entry) => count + (entry.userId === localUserId ? 0 : 1),
    0,
  );

  // HUD floats: ply-3 with a line and the float shadow, over the dark canvas.
  const panel = "rounded-lg border border-line bg-ply-3 shadow-float";
  const statRows: Array<[string, string]> = [
    ["Frame rate", `${perfStats.fps} fps`],
    ["Frame time", `${perfStats.frameMs} ms`],
    ["Triangles", formatStat(perfStats.triangles)],
    ["Draw calls", formatStat(perfStats.drawCalls)],
    ["Points", formatStat(perfStats.points)],
    ["Pixel ratio", String(perfStats.dpr)],
  ];

  return (
    <div className="@container relative h-full w-full overflow-hidden bg-ply-0 text-ink-1">
      <div ref={stageRef} className="absolute inset-0" />

      {status === "running" || status === "crashed" ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between gap-3 p-3 @[720px]:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <section
              aria-label="Your run"
              className={cn(
                panel,
                "pointer-events-auto w-full max-w-[340px] p-4",
              )}
            >
              <h2 className="text-ui-md font-semibold">Warp Rush</h2>
              <p className="mt-0.5 hidden max-w-[40ch] text-ui-sm text-pretty text-ink-2 @[720px]:block">
                Race through the same tunnel as everyone in the call. Steer
                around the debris, and fly close behind another ship to draft
                for a speed boost.
              </p>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt className="text-ui-xs text-ink-3">Score</dt>
                  <dd className="font-mono text-ui-xl font-semibold tabular-nums">
                    {formatStat(score)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ui-xs text-ink-3">Best</dt>
                  <dd className="font-mono text-ui-xl font-semibold tabular-nums">
                    {formatStat(bestScore)}
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-ui-xs text-ink-3">
                    <Icon name="noiseSuppression" size="xs" />
                    Draft
                  </dt>
                  <dd
                    className={cn(
                      "text-ui-sm font-medium",
                      slipstreamActive ? "text-success-ink" : "text-ink-1",
                    )}
                  >
                    {slipstreamActive
                      ? `+${Math.round(WARP_RUSH_SLIPSTREAM_BONUS * 100)}% speed`
                      : "Not drafting"}
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-ui-xs text-ink-3">
                    <Icon name="members" size="xs" />
                    Next ship
                  </dt>
                  <dd className="text-ui-sm font-medium tabular-nums">
                    {nearestRivalGap === null
                      ? "None ahead"
                      : `${nearestRivalGap.toFixed(1)}m ahead`}
                  </dd>
                </div>
              </dl>
            </section>

            <section
              aria-label="Scores"
              className={cn(
                panel,
                "pointer-events-auto hidden w-full max-w-[300px] flex-col @[720px]:flex",
              )}
            >
              <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
                <h3 className="text-ui-row font-semibold">Scores</h3>
                <span className="text-ui-xs text-ink-3">
                  {remotePilotCount > 0 ? (
                    <>
                      <Num>{remotePilotCount + 1}</Num> playing
                    </>
                  ) : (
                    "Just you"
                  )}
                </span>
              </div>

              <ul className="max-h-[44dvh] overflow-y-auto px-2 pb-2">
                {sortedLeaderboard.length > 0 ? (
                  sortedLeaderboard.map((entry, index) => {
                    const participant = participantMap.get(entry.userId);
                    const displayName =
                      participant?.name ?? entry.name ?? "Pilot";
                    const avatar = participant?.avatar ?? entry.avatar ?? null;
                    return (
                      <li
                        key={entry.userId}
                        className="flex min-h-10 items-center gap-2.5 rounded-sm px-2 py-1.5"
                      >
                        <Num className="w-4 text-right text-ink-3">
                          {index + 1}
                        </Num>
                        <Avatar
                          name={displayName}
                          src={avatar ? getAuthAssetUrl(avatar) : null}
                          size={24}
                          ring="ply-3"
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate text-ui-sm font-medium"
                            title={displayName}
                          >
                            {displayName}
                          </div>
                          <div className="truncate text-ui-xs text-ink-3">
                            {entry.crashed
                              ? "Crashed"
                              : entry.slipstream
                                ? "Drafting"
                                : "Flying"}
                            {" · "}
                            {PRESETS[entry.preset].label}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-ui-row font-semibold tabular-nums">
                            {formatStat(entry.best)}
                          </div>
                          <div className="text-ui-xs text-ink-3">Best</div>
                        </div>
                      </li>
                    );
                  })
                ) : (
                  <li className="px-2 py-3 text-ui-sm text-pretty text-ink-3">
                    Other players in this call show up here, and as ghost ships
                    in the tunnel.
                  </li>
                )}
              </ul>
            </section>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <p
              className={cn(
                panel,
                "pointer-events-auto hidden flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-ui-sm text-ink-2 @[720px]:flex",
              )}
            >
              <span>Steer with the mouse</span>
              <span className="flex items-center gap-1.5">
                Trim with
                <KbdGroup>
                  <Kbd>W</Kbd>
                  <Kbd>A</Kbd>
                  <Kbd>S</Kbd>
                  <Kbd>D</Kbd>
                </KbdGroup>
              </span>
              <span className="flex items-center gap-1.5">
                Restart with <Kbd>Space</Kbd>
              </span>
            </p>

            <section
              aria-label="Game settings"
              className={cn(
                panel,
                "pointer-events-auto flex w-full max-w-[460px] flex-col gap-2 p-3",
              )}
            >
              {softwareRendererLikely ? (
                <p className="flex items-start gap-2 rounded-md bg-warning-tint px-2.5 py-1.5 text-ui-xs text-pretty text-warning-ink">
                  <Icon name="warning" size="sm" className="mt-px" />
                  This browser is drawing without graphics acceleration, so the
                  game may run slowly.
                </p>
              ) : null}

              {statsOpen ? (
                <div id="warp-rush-stats" className="flex flex-col gap-2">
                  <dl className="grid grid-cols-3 gap-x-4 gap-y-2">
                    {statRows.map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-ui-xs text-ink-3">{label}</dt>
                        <dd>
                          <Num size="sm">{value}</Num>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="text-ui-xs break-words text-ink-3">
                    Renderer:{" "}
                    <span className="text-ink-2">{rendererLabel}</span>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Segmented
                  label="Quality"
                  value={preset}
                  onChange={setPreset}
                  options={PRESET_ORDER.map((option) => ({
                    value: option,
                    label: PRESETS[option].label,
                  }))}
                />
                <Segmented
                  label="Resolution"
                  value={renderScale}
                  onChange={setRenderScale}
                  mono
                  options={RENDER_SCALES.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={statsOpen}
                  aria-controls="warp-rush-stats"
                  onClick={() => setStatsOpen((open) => !open)}
                  className="ml-auto"
                >
                  <Icon name="gauge" size="sm" />
                  Stats
                </Button>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {status === "crashed" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-scrim px-6">
          <div
            role="group"
            aria-label="Run over"
            className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-line bg-ply-3 p-6 text-center shadow-modal"
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-ui-lg font-semibold">You hit debris</h3>
              <p className="text-ui-sm text-pretty text-ink-2">
                The course is the same every run, so try a different line
                through the tunnel.
              </p>
            </div>
            <dl className="grid w-full grid-cols-2 divide-x divide-line rounded-lg border border-line bg-ply-2 py-3">
              <div>
                <dt className="text-ui-xs text-ink-3">This run</dt>
                <dd className="font-mono text-ui-xl font-semibold tabular-nums">
                  {formatStat(score)}
                </dd>
              </div>
              <div>
                <dt className="text-ui-xs text-ink-3">Best</dt>
                <dd className="font-mono text-ui-xl font-semibold tabular-nums">
                  {formatStat(bestScore)}
                </dd>
              </div>
            </dl>
            <Button size="lg" onClick={() => restartRef.current()}>
              <Icon name="reset" size="sm" />
              Restart run
            </Button>
          </div>
        </div>
      )}

      {status === "booting" || status === "unsupported" ? (
        <div className="absolute inset-0 z-20">
          <WarpRushStatusScreen
            kind={status}
            onRetry={() => {
              setStatus("booting");
              setBootAttempt((attempt) => attempt + 1);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One row of mutually exclusive choices: a ply-tint well (radius 8) holding
 * 28px segments (radius 6, concentric at 2px padding). The chosen segment is
 * tint-3; the rest are bare until hovered.
 */
function Segmented<T extends string | number>({
  label,
  value,
  onChange,
  options,
  mono = false,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  /** The labels are numbers ("1.25x"): set them in the number face. */
  mono?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <span className="text-ui-xs text-ink-3">{label}</span>
      <div className="flex rounded-md bg-tint-1 p-0.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "h-7 rounded-sm px-2.5 outline-none",
                mono ? "text-num-sm" : "text-ui-sm font-medium",
                PRESS,
                HIT,
                selected
                  ? "bg-tint-3 text-ink-1"
                  : "text-ink-2 pointer-fine:hover:text-ink-1",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The stage before a frame renders (booting) or when WebGL is missing
 * (unsupported): an EmptyState on the canvas ground. Booting is the pending
 * (half-resolved, still) glyph; the failure names the problem and the one fix, never the
 * renderer's raw error.
 */
export function WarpRushStatusScreen({
  kind,
  onRetry,
}: {
  kind: "booting" | "unsupported";
  onRetry?: () => void;
}) {
  return (
    <div
      role={kind === "unsupported" ? "alert" : undefined}
      className="flex h-full w-full items-center justify-center bg-ply-0"
    >
      {kind === "booting" ? (
        <EmptyState
          loading
          title="Starting Warp Rush"
          description="Setting up the 3D view for this device."
        />
      ) : (
        <EmptyState
          title="Warp Rush can't start"
          description="This browser couldn't open a 3D canvas. Turn on graphics acceleration in your browser settings, then try again."
          action={
            onRetry ? (
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
