import bundledCoreCode from "./assets/yt.solver.core.min.js?raw";
import bundledLibCode from "./assets/yt.solver.lib.min.js?raw";
import { cacheGet, cacheSet } from "@/lib/cache";
import { assertSolverBundleUsable } from "./solver";
import type {
  YtDlpCommitSummary,
  YtDlpReleaseSummary,
  YtDlpSolverBundle,
  YtDlpUpstreamStatus,
} from "./types";

const GITHUB_API = "https://api.github.com/repos";
const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ralph-meet-ytdlp-upstream",
};

const SOLVER_BUNDLE_CACHE_KEY = "v1:ytdlp:solver-bundle";
const UPSTREAM_STATUS_CACHE_KEY = "v1:ytdlp:upstream-status";
const SOLVER_BUNDLE_TTL_SECONDS = 60 * 60 * 24 * 30;
const UPSTREAM_STATUS_TTL_SECONDS = 60 * 60 * 6;
const RECOMMENDED_CHANNEL = "nightly" as const;
const BUNDLED_EJS_VERSION = "0.8.0";
const BUNDLED_EJS_RELEASE_URL =
  "https://github.com/yt-dlp/ejs/releases/tag/0.8.0";
const BUNDLED_EJS_LIB_DIGEST =
  "sha256:c55987fe697e5b9ee18830163f7af85327e9bb5c3e674b969d38c8d205eaa577";
const BUNDLED_EJS_CORE_DIGEST =
  "sha256:18da6ce0758b416e7ae645084f4f8801f9f9d59d6c477c05eaa0ff94ebd8cc00";

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at: string | null;
  assets: GitHubReleaseAsset[];
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit?: {
    committer?: {
      date?: string | null;
    };
  };
}

const bundledSolverBundle: YtDlpSolverBundle = {
  version: BUNDLED_EJS_VERSION,
  source: "bundled",
  fetchedAt: "2026-07-06T00:00:00.000Z",
  releaseUrl: BUNDLED_EJS_RELEASE_URL,
  libCode: bundledLibCode,
  coreCode: bundledCoreCode,
  libDigest: BUNDLED_EJS_LIB_DIGEST,
  coreDigest: BUNDLED_EJS_CORE_DIGEST,
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: GITHUB_HEADERS });
  if (!response.ok) {
    throw new Error(
      `GitHub API request failed for ${url} (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: GITHUB_HEADERS });
  if (!response.ok) {
    throw new Error(
      `GitHub asset download failed for ${url} (${response.status})`,
    );
  }
  return response.text();
}

async function sha256DigestHex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyAssetDigest(code: string, expectedDigest?: string) {
  if (!expectedDigest) return true;
  const [algorithm, value] = expectedDigest.split(":");
  if (!algorithm || !value || algorithm.toLowerCase() !== "sha256") {
    return false;
  }
  return (await sha256DigestHex(code)) === value.toLowerCase();
}

function summarizeRelease(
  repo: string,
  release: GitHubRelease | null,
): YtDlpReleaseSummary | null {
  if (!release) return null;
  return {
    repo,
    tag: release.tag_name,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
  };
}

function summarizeCommit(
  repo: string,
  commit: GitHubCommit | null,
): YtDlpCommitSummary | null {
  if (!commit) return null;
  return {
    repo,
    sha: commit.sha,
    committedAt: commit.commit?.committer?.date ?? null,
    htmlUrl: commit.html_url,
  };
}

function isOlderThan(dateString: string | null, ageMs: number) {
  if (!dateString) return true;
  const parsed = Date.parse(dateString);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > ageMs;
}

function buildFallbackStatus(
  bundle: YtDlpSolverBundle,
  errors: string[] = [],
): YtDlpUpstreamStatus {
  return {
    syncedAt: null,
    recommendedChannel: RECOMMENDED_CHANNEL,
    activeBundle: {
      version: bundle.version,
      source: bundle.source,
      fetchedAt: bundle.fetchedAt,
      releaseUrl: bundle.releaseUrl,
    },
    ejsLatest: null,
    ytDlpStable: null,
    ytDlpNightly: null,
    ytDlpMaster: null,
    ytDlpMasterCommit: null,
    stale: true,
    errors,
  };
}

async function readCachedSolverBundle(): Promise<YtDlpSolverBundle | null> {
  const cached = await cacheGet<YtDlpSolverBundle>(SOLVER_BUNDLE_CACHE_KEY);
  if (!cached) return null;

  const candidate: YtDlpSolverBundle = {
    ...cached,
    source: "kv",
  };

  const digestChecks = await Promise.all([
    verifyAssetDigest(candidate.libCode, candidate.libDigest),
    verifyAssetDigest(candidate.coreCode, candidate.coreDigest),
  ]);

  if (digestChecks.some((result) => !result)) {
    return null;
  }

  try {
    assertSolverBundleUsable(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function loadActiveSolverBundle(): Promise<YtDlpSolverBundle> {
  const cached = await readCachedSolverBundle();
  if (cached) return cached;
  return bundledSolverBundle;
}

export async function getYtDlpUpstreamStatus(): Promise<YtDlpUpstreamStatus> {
  const cached = await cacheGet<YtDlpUpstreamStatus>(UPSTREAM_STATUS_CACHE_KEY);
  if (cached) return cached;
  return buildFallbackStatus(await loadActiveSolverBundle());
}

export async function syncYtDlpUpstream(
  force = false,
): Promise<YtDlpUpstreamStatus> {
  if (!force) {
    const cached = await cacheGet<YtDlpUpstreamStatus>(
      UPSTREAM_STATUS_CACHE_KEY,
    );
    if (
      cached &&
      !isOlderThan(cached.syncedAt, UPSTREAM_STATUS_TTL_SECONDS * 1000)
    ) {
      return cached;
    }
  }

  const errors: string[] = [];

  const [
    ejsResult,
    stableResult,
    nightlyResult,
    masterReleaseResult,
    masterCommitResult,
  ] = await Promise.allSettled([
    fetchJson<GitHubRelease>(`${GITHUB_API}/yt-dlp/ejs/releases/latest`),
    fetchJson<GitHubRelease>(`${GITHUB_API}/yt-dlp/yt-dlp/releases/latest`),
    fetchJson<GitHubRelease>(
      `${GITHUB_API}/yt-dlp/yt-dlp-nightly-builds/releases/latest`,
    ),
    fetchJson<GitHubRelease>(
      `${GITHUB_API}/yt-dlp/yt-dlp-master-builds/releases/latest`,
    ),
    fetchJson<GitHubCommit>(`${GITHUB_API}/yt-dlp/yt-dlp/commits/master`),
  ]);

  const ejsRelease = ejsResult.status === "fulfilled" ? ejsResult.value : null;
  const stableRelease =
    stableResult.status === "fulfilled" ? stableResult.value : null;
  const nightlyRelease =
    nightlyResult.status === "fulfilled" ? nightlyResult.value : null;
  const masterRelease =
    masterReleaseResult.status === "fulfilled"
      ? masterReleaseResult.value
      : null;
  const masterCommit =
    masterCommitResult.status === "fulfilled" ? masterCommitResult.value : null;

  for (const result of [
    ejsResult,
    stableResult,
    nightlyResult,
    masterReleaseResult,
    masterCommitResult,
  ]) {
    if (result.status === "rejected") {
      errors.push(
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      );
    }
  }

  let activeBundle = await loadActiveSolverBundle();

  if (ejsRelease) {
    const libAsset = ejsRelease.assets.find(
      (asset) => asset.name === "yt.solver.lib.min.js",
    );
    const coreAsset = ejsRelease.assets.find(
      (asset) => asset.name === "yt.solver.core.min.js",
    );

    if (libAsset && coreAsset) {
      try {
        const [libCode, coreCode] = await Promise.all([
          fetchText(libAsset.browser_download_url),
          fetchText(coreAsset.browser_download_url),
        ]);

        const [libValid, coreValid] = await Promise.all([
          verifyAssetDigest(libCode, libAsset.digest),
          verifyAssetDigest(coreCode, coreAsset.digest),
        ]);

        if (!libValid || !coreValid) {
          throw new Error("Latest yt-dlp/ejs asset digest verification failed");
        }

        const freshBundle: YtDlpSolverBundle = {
          version: ejsRelease.tag_name,
          source: "sync",
          fetchedAt: new Date().toISOString(),
          releaseUrl: ejsRelease.html_url,
          libCode,
          coreCode,
          libDigest:
            libAsset.digest ?? `sha256:${await sha256DigestHex(libCode)}`,
          coreDigest:
            coreAsset.digest ?? `sha256:${await sha256DigestHex(coreCode)}`,
        };

        assertSolverBundleUsable(freshBundle);
        await cacheSet(
          SOLVER_BUNDLE_CACHE_KEY,
          freshBundle,
          SOLVER_BUNDLE_TTL_SECONDS,
        );
        activeBundle = freshBundle;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      errors.push(
        "Latest yt-dlp/ejs release did not contain both minified solver assets",
      );
    }
  }

  const status: YtDlpUpstreamStatus = {
    syncedAt: new Date().toISOString(),
    recommendedChannel: RECOMMENDED_CHANNEL,
    activeBundle: {
      version: activeBundle.version,
      source: activeBundle.source,
      fetchedAt: activeBundle.fetchedAt,
      releaseUrl: activeBundle.releaseUrl,
    },
    ejsLatest: summarizeRelease("yt-dlp/ejs", ejsRelease),
    ytDlpStable: summarizeRelease("yt-dlp/yt-dlp", stableRelease),
    ytDlpNightly: summarizeRelease(
      "yt-dlp/yt-dlp-nightly-builds",
      nightlyRelease,
    ),
    ytDlpMaster: summarizeRelease("yt-dlp/yt-dlp-master-builds", masterRelease),
    ytDlpMasterCommit: summarizeCommit("yt-dlp/yt-dlp", masterCommit),
    stale: !!ejsRelease && activeBundle.version !== ejsRelease.tag_name,
    errors,
  };

  await cacheSet(
    UPSTREAM_STATUS_CACHE_KEY,
    status,
    UPSTREAM_STATUS_TTL_SECONDS,
  );
  return status;
}
