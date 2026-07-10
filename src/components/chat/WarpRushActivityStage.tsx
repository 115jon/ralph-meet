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
import {
  AlertTriangle,
  Gauge,
  Move3D,
  Rocket,
  RotateCcw,
  Trophy,
  Users,
  Wind,
  Zap,
} from "lucide-react";
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
    label: "Ultra",
    starLayers: 4,
    starsPerLayer: 12000,
    dustPerLayer: 2800,
    debrisCount: 560,
    bloomStrength: 1.12,
    obstacleDetail: 2,
    ringRadius: 12.5,
  },
  meltdown: {
    label: "Meltdown",
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
  const [accelerationLabel, setAccelerationLabel] = useState(
    "Checking acceleration",
  );
  const [failureReason, setFailureReason] = useState<string | null>(null);
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
      queueMicrotask(() => {
        if (disposed) return;
        setFailureReason(
          error instanceof Error
            ? error.message
            : "WebGL renderer failed to initialize.",
        );
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
      setAccelerationLabel(
        isLikelySoftwareRenderer(finalRendererLabel)
          ? "Fallback renderer likely"
          : "Hardware acceleration likely",
      );
      setFailureReason(null);
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
        const fps = fpsFrames / fpsElapsed;
        setPerfStats({
          fps: Math.round(fps),
          frameMs: Number((1000 / Math.max(fps, 1)).toFixed(1)),
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          points: renderer.info.render.points,
          dpr: Number(renderer.getPixelRatio().toFixed(2)),
        });
        fpsFrames = 0;
        fpsElapsed = 0;
      }
    };

    resize();
    resetRun();
    renderer.setAnimationLoop(renderFrame);

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      for (const cleanup of cleanupFns.reverse()) cleanup();
    };
  }, [channelId, course, preset, renderScale]);

  const sortedLeaderboard = useMemo(
    () =>
      Object.values(pilotStates)
        .filter(
          (entry) =>
            Date.now() - entry.updatedAt < 12000 ||
            entry.userId === localUserId,
        )
        .sort(
          (left, right) =>
            right.best - left.best ||
            right.score - left.score ||
            right.updatedAt - left.updatedAt,
        )
        .slice(0, 8),
    [localUserId, pilotStates],
  );
  const softwareRendererLikely = isLikelySoftwareRenderer(rendererLabel);
  const remotePilotCount = sortedLeaderboard.reduce(
    (count, entry) => count + (entry.userId === localUserId ? 0 : 1),
    0,
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#020617] text-white">
      <div ref={stageRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_28%),linear-gradient(180deg,rgba(2,6,23,0.12),rgba(2,6,23,0.82))]" />

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between gap-3 p-3 sm:p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="pointer-events-auto flex w-full max-w-[440px] flex-col gap-3">
            <div className="rounded-[28px] border border-cyan-300/15 bg-slate-950/48 p-4 shadow-[0_22px_90px_rgba(2,6,23,0.42)] backdrop-blur-2xl sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-cyan-200/74">
                    <Rocket size={14} />
                    Warp Rush 3D
                  </div>
                  <h2 className="mt-2 text-2xl font-black leading-none text-white sm:text-[2rem]">
                    Shared tunnel sprint
                  </h2>
                  <p className="mt-2 max-w-[34ch] text-sm leading-6 text-slate-300">
                    Same seed, same hazards, live ghost ships. Draft the pilot
                    ahead and compare acceleration modes without changing the
                    sim.
                  </p>
                </div>
                <div
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em]",
                    softwareRendererLikely
                      ? "border-amber-300/35 bg-amber-400/10 text-amber-100"
                      : "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
                  )}
                >
                  {accelerationLabel}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                    Score
                  </div>
                  <div className="mt-2 text-2xl font-black text-cyan-200">
                    {formatStat(score)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                    Best
                  </div>
                  <div className="mt-2 text-2xl font-black text-fuchsia-200">
                    {formatStat(bestScore)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                    <Wind size={12} />
                    Draft
                  </div>
                  <div
                    className={cn(
                      "mt-2 text-sm font-bold",
                      slipstreamActive ? "text-emerald-200" : "text-slate-200",
                    )}
                  >
                    {slipstreamActive
                      ? `+${Math.round(WARP_RUSH_SLIPSTREAM_BONUS * 100)}% speed`
                      : "No draft"}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                    <Users size={12} />
                    Rival
                  </div>
                  <div className="mt-2 text-sm font-bold text-slate-100">
                    {nearestRivalGap === null
                      ? "Open tunnel"
                      : `${nearestRivalGap.toFixed(1)}m ahead`}
                  </div>
                </div>
              </div>
            </div>

            {failureReason && (
              <div className="rounded-full border border-amber-300/28 bg-slate-950/72 px-4 py-2 text-xs text-amber-50 backdrop-blur-xl">
                {failureReason}
              </div>
            )}
          </div>

          <div className="pointer-events-auto w-full max-w-[340px] rounded-[28px] border border-cyan-300/15 bg-slate-950/44 p-4 shadow-[0_22px_90px_rgba(2,6,23,0.4)] backdrop-blur-2xl sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-cyan-200/80">
                <Trophy size={14} />
                Session board
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                {remotePilotCount > 0
                  ? `${remotePilotCount + 1} live`
                  : "Solo warm-up"}
              </div>
            </div>

            <div className="mt-3 max-h-[44vh] space-y-2 overflow-y-auto pr-1">
              {sortedLeaderboard.length > 0 ? (
                sortedLeaderboard.map((entry, index) => {
                  const participant = participantMap.get(entry.userId);
                  const displayName =
                    participant?.name ?? entry.name ?? "Pilot";
                  const avatar = participant?.avatar ?? entry.avatar ?? null;
                  return (
                    <div
                      key={entry.userId}
                      className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400/15 text-xs font-black text-cyan-100">
                        {index + 1}
                      </div>
                      {avatar ? (
                        <img
                          src={getAuthAssetUrl(avatar)}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-400/15 text-sm font-black text-fuchsia-100">
                          {displayName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-white">
                          {displayName}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                          <span>{PRESETS[entry.preset].label}</span>
                          <span>
                            {entry.crashed
                              ? "Crashed"
                              : entry.slipstream
                                ? "Drafting"
                                : "Running"}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-black text-cyan-100">
                          {formatStat(entry.best)}
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                          Peak
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-center text-sm text-slate-300">
                  Launch the activity in the same voice session and live rivals
                  will start ghosting into the tunnel.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-[24px] border border-cyan-300/15 bg-slate-950/44 px-3 py-3 backdrop-blur-2xl sm:px-4">
            <div className="flex items-center gap-2 pr-1 text-[11px] uppercase tracking-[0.24em] text-cyan-200/78">
              <Move3D size={14} />
              Controls
            </div>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-slate-200">
              Mouse / touch steer
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-slate-200">
              WASD trim
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-slate-200">
              Draft a ghost
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-slate-200">
              Space restart
            </span>
          </div>

          <div className="pointer-events-auto w-full max-w-[640px] rounded-[28px] border border-cyan-300/15 bg-slate-950/44 p-3 shadow-[0_22px_90px_rgba(2,6,23,0.36)] backdrop-blur-2xl sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="mr-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-cyan-200/78">
                <Zap size={14} />
                Load
              </div>
              {PRESET_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPreset(option)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-bold transition-colors",
                    preset === option
                      ? "border-cyan-200 bg-cyan-300/20 text-white"
                      : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-cyan-300/35 hover:text-white",
                  )}
                >
                  {PRESETS[option].label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="mr-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-fuchsia-200/78">
                <Gauge size={14} />
                Scale
              </div>
              {RENDER_SCALES.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setRenderScale(option.value)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-bold transition-colors",
                    renderScale === option.value
                      ? "border-fuchsia-200 bg-fuchsia-300/18 text-white"
                      : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-fuchsia-300/35 hover:text-white",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-slate-200">
                {perfStats.fps} FPS
              </div>
              <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-slate-200">
                {perfStats.frameMs}ms frame
              </div>
              <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-slate-300">
                {formatStat(perfStats.triangles)} tris
              </div>
              <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-slate-300">
                {formatStat(perfStats.drawCalls)} draws
              </div>
              <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-slate-300">
                {formatStat(perfStats.points)} points
              </div>
              <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-slate-300">
                DPR {perfStats.dpr}
              </div>
            </div>

            <div className="mt-3 min-w-0 rounded-full border border-white/8 bg-black/25 px-3 py-2 text-[11px] text-slate-300">
              <span className="uppercase tracking-[0.18em] text-slate-500">
                Renderer
              </span>
              <span className="ml-2 inline-block max-w-full break-all align-middle text-slate-100">
                {rendererLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      {status === "crashed" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
          <div className="max-w-md rounded-[28px] border border-amber-300/30 bg-slate-950/86 p-6 text-center shadow-[0_24px_120px_rgba(2,6,23,0.8)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-400/10 text-amber-200">
              <AlertTriangle size={28} />
            </div>
            <h3 className="mt-4 text-3xl font-black text-white">Hull breach</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Breach confirmed. The race sim stays fixed-step across refresh
              rates now, so acceleration changes should affect render cost, not
              the course itself.
            </p>
            <div className="mt-5 flex items-center justify-center gap-6">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Run
                </div>
                <div className="mt-1 text-3xl font-black text-cyan-200">
                  {formatStat(score)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Best
                </div>
                <div className="mt-1 text-3xl font-black text-fuchsia-200">
                  {formatStat(bestScore)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Live FPS
                </div>
                <div className="mt-1 text-3xl font-black text-emerald-200">
                  {perfStats.fps}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => restartRef.current()}
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-cyan-200/35 bg-cyan-300/20 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-cyan-300/28"
            >
              <RotateCcw size={16} />
              Restart run
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
