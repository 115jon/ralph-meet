export type YtDlpUpdateChannel = "stable" | "nightly" | "master";

export type YtDlpSolverSource = "bundled" | "kv" | "sync";

export interface YtDlpSolverBundle {
  version: string;
  source: YtDlpSolverSource;
  fetchedAt: string;
  releaseUrl: string;
  libCode: string;
  coreCode: string;
  libDigest: string;
  coreDigest: string;
}

export interface YtDlpReleaseSummary {
  repo: string;
  tag: string;
  publishedAt: string | null;
  htmlUrl: string;
}

export interface YtDlpCommitSummary {
  repo: string;
  sha: string;
  committedAt: string | null;
  htmlUrl: string;
}

export interface YtDlpUpstreamStatus {
  syncedAt: string | null;
  recommendedChannel: YtDlpUpdateChannel;
  activeBundle: Pick<
    YtDlpSolverBundle,
    "version" | "source" | "fetchedAt" | "releaseUrl"
  >;
  ejsLatest: YtDlpReleaseSummary | null;
  ytDlpStable: YtDlpReleaseSummary | null;
  ytDlpNightly: YtDlpReleaseSummary | null;
  ytDlpMaster: YtDlpReleaseSummary | null;
  ytDlpMasterCommit: YtDlpCommitSummary | null;
  stale: boolean;
  errors: string[];
}

export type PreferredPlaybackKind = "audio" | "video" | "muxed" | "any";

export interface YouTubeResolvedFormat {
  itag: number | null;
  url: string;
  mimeType: string | null;
  container: string | null;
  codecs: string[];
  bitrate: number | null;
  contentLength: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  qualityLabel: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  projectionType: string | null;
  expiresAt: number | null;
}

export interface YouTubeResolveOptions {
  preferredKind?: PreferredPlaybackKind;
  preferredContainer?: "mp4" | "webm";
  includeFormats?: boolean;
}

export interface YouTubeResolveResponse {
  sourceUrl: string;
  videoId: string;
  title: string | null;
  author: string | null;
  durationSeconds: number | null;
  isLive: boolean;
  playerUrl: string | null;
  selectedFormat: YouTubeResolvedFormat | null;
  formats: YouTubeResolvedFormat[];
  activeSolver: Pick<YtDlpSolverBundle, "version" | "source">;
}
