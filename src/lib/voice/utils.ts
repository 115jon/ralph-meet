export const formatQuality = (
  q: string | null | undefined,
  track?: MediaStreamTrack | null,
  stats?: { fps: number; bitrate: number; width?: number; height?: number } | null
) => {
  // Prefer inbound-rtp stats for remote tracks (track.getSettings() is unreliable in Chrome)
  const statsH = stats?.height && stats.height > 0 ? stats.height : null;
  const statsW = stats?.width && stats.width > 0 ? stats.width : null;

  // Use stats resolution if available, otherwise fall back to track.getSettings()
  let h: number | undefined;
  let w: number | undefined;
  if (statsH && statsW) {
    h = statsH;
    w = statsW;
  } else if (track) {
    const settings = track.getSettings();
    h = settings.height;
    w = settings.width;
  }

  if (h && w) {
    let res = '';
    if (h >= 2160 || w >= 3840) res = '4K';
    else if (h >= 1440 || w >= 2560) res = '1440';
    else if (h >= 1080 || w >= 1920) res = '1080';
    else if (h >= 720 || w >= 1280) res = '720';
    else res = h.toString();

    let fps = track?.getSettings().frameRate ? Math.round(track.getSettings().frameRate!) : null;
    // If hardware FPS is missing (common for remote tracks), use stats-based FPS
    if (!fps && stats?.fps) fps = Math.round(stats.fps);

    if (fps) return `${res}P / ${fps} FPS`;
    return `${res}P`;
  }

  // Fallback to signaled quality string
  if (!q) return 'HD';
  if (q && q.includes('p')) {
    const [res, fps] = q.split('p');
    return `${res.toUpperCase()}P / ${fps} FPS`;
  }
  return q?.toUpperCase() || 'HD';
};

export interface StreamQualityProfile {
  id: string;
  label: string;
  height: number;
  fps: number;
}

export const STREAMING_PROFILES: StreamQualityProfile[] = [
  { id: "720p30", label: "720p", height: 720, fps: 30 },
  { id: "720p60", label: "720p", height: 720, fps: 60 },
  { id: "1080p30", label: "1080p", height: 1080, fps: 30 },
  { id: "1080p60", label: "1080p", height: 1080, fps: 60 },
  { id: "1440p30", label: "1440p", height: 1440, fps: 30 },
  { id: "1440p60", label: "1440p", height: 1440, fps: 60 },
  { id: "4k30", label: "4K", height: 2160, fps: 30 },
  { id: "4k60", label: "4K", height: 2160, fps: 60 },
];

/**
 * Returns all available streaming qualities.
 *
 * We intentionally do NOT gate by the local display resolution:
 * - The viewer may have a larger monitor than the streamer.
 * - `window.screen` only reports the monitor the browser is on, not
 *   necessarily the largest display in a multi-monitor setup.
 * - Screen-capture can target a different monitor or upscale.
 * - Discord follows the same approach (quality is gated by subscription
 *   tier, not local hardware).
 */
export const getAvailableStreamQualities = (): string[] =>
  STREAMING_PROFILES.map(p => p.id);
