import type { YtDlpSolverBundle } from "./types";

type SolverRequestType = "n" | "sig";

interface SolverRequest {
  type: SolverRequestType;
  challenges: string[];
}

interface SolverResultResponse {
  type: "result";
  data: Record<string, string | null>;
}

interface SolverErrorResponse {
  type: "error";
  error: string;
}

interface SolverOutput {
  type: "result" | "error";
  error?: string;
  responses?: Array<SolverResultResponse | SolverErrorResponse>;
}

type CompiledSolver = (input: {
  type: "player" | "preprocessed";
  player?: string;
  preprocessed_player?: string;
  output_preprocessed?: boolean;
  requests: SolverRequest[];
}) => SolverOutput;

const solverCache = new Map<string, CompiledSolver>();

function getBundleCacheKey(bundle: YtDlpSolverBundle) {
  return `${bundle.version}:${bundle.libDigest}:${bundle.coreDigest}`;
}

function isSolverOutput(value: unknown): value is SolverOutput {
  return !!value && typeof value === "object" && "type" in value;
}

export function compileSolverBundle(bundle: YtDlpSolverBundle): CompiledSolver {
  const cacheKey = getBundleCacheKey(bundle);
  const cached = solverCache.get(cacheKey);
  if (cached) return cached;

  const compiled = new Function(
    `${bundle.libCode}
const meriyah = lib.meriyah;
const astring = lib.astring;
${bundle.coreCode}
return jsc;`,
  )();

  if (typeof compiled !== "function") {
    throw new Error(
      `yt-dlp solver bundle ${bundle.version} did not compile into a function`,
    );
  }

  solverCache.set(cacheKey, compiled as CompiledSolver);
  return compiled as CompiledSolver;
}

export function assertSolverBundleUsable(bundle: YtDlpSolverBundle) {
  const compiled = compileSolverBundle(bundle);
  const output = compiled({
    type: "preprocessed",
    preprocessed_player: "_result.n=(value)=>value;_result.sig=(value)=>value;",
    requests: [],
  });

  if (
    !isSolverOutput(output) ||
    output.type !== "result" ||
    !Array.isArray(output.responses)
  ) {
    throw new Error(
      `yt-dlp solver bundle ${bundle.version} failed its smoke test`,
    );
  }
}

export function solvePlayerChallenges(
  bundle: YtDlpSolverBundle,
  playerCode: string,
  input: {
    n: string[];
    sig: string[];
  },
) {
  const requests: SolverRequest[] = [];
  if (input.n.length > 0) requests.push({ type: "n", challenges: input.n });
  if (input.sig.length > 0)
    requests.push({ type: "sig", challenges: input.sig });

  const solved = {
    n: {} as Record<string, string | null>,
    sig: {} as Record<string, string | null>,
  };

  if (requests.length === 0) {
    return solved;
  }

  const compiled = compileSolverBundle(bundle);
  const output = compiled({
    type: "player",
    player: playerCode,
    output_preprocessed: false,
    requests,
  });

  if (!isSolverOutput(output)) {
    throw new Error("yt-dlp solver returned an invalid payload");
  }

  if (output.type === "error") {
    throw new Error(output.error || "yt-dlp solver reported an unknown error");
  }

  const responses = output.responses ?? [];
  if (responses.length !== requests.length) {
    throw new Error("yt-dlp solver returned an unexpected number of responses");
  }

  for (const [index, response] of responses.entries()) {
    const request = requests[index];
    if (response.type === "error") {
      throw new Error(
        `yt-dlp solver could not resolve ${request.type}: ${response.error}`,
      );
    }

    for (const challenge of request.challenges) {
      const value = response.data[challenge] ?? null;
      solved[request.type][challenge] = value;
    }
  }

  return solved;
}
