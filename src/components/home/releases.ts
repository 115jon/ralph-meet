/**
 * Desktop release lookup for the landing page. The GitHub releases feed is
 * fetched after mount; until then (and if it fails) the pinned fallback is
 * shown so the download button always has a target.
 */

export interface DesktopRelease {
  tagName: string;
  name: string;
  downloadUrl: string;
  fileName: string;
  isLatest: boolean;
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  assets?: GithubReleaseAsset[];
}

export const REPO_URL = "https://github.com/115jon/ralph-meet";
export const RELEASES_API_URL =
  "https://api.github.com/repos/115jon/ralph-meet/releases";

export const FALLBACK_RELEASES: DesktopRelease[] = [
  {
    tagName: "v1.9.0",
    name: "v1.9.0",
    downloadUrl: `${REPO_URL}/releases/download/v1.9.0/RalphMeetSetup.exe`,
    fileName: "RalphMeetSetup.exe",
    isLatest: true,
  },
];

function isGithubRelease(value: unknown): value is GithubRelease {
  if (!value || typeof value !== "object") return false;
  return typeof Reflect.get(value, "tag_name") === "string";
}

export function mapGithubReleases(payload: unknown): DesktopRelease[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter(isGithubRelease)
    .map((release, index) => {
      const asset = release.assets?.find((item) => item.name.endsWith(".exe"));
      if (!asset) return null;
      return {
        tagName: release.tag_name,
        name: release.name || release.tag_name,
        downloadUrl: asset.browser_download_url,
        fileName: asset.name,
        isLatest: index === 0,
      };
    })
    .filter((release): release is DesktopRelease => release !== null);
}

/** Resolves to the mapped releases, or `[]` on any network or shape error. */
export async function fetchDesktopReleases(
  fetcher: typeof fetch = fetch,
): Promise<DesktopRelease[]> {
  try {
    const response = await fetcher(RELEASES_API_URL);
    if (!response.ok) return [];
    return mapGithubReleases(await response.json());
  } catch {
    return [];
  }
}
