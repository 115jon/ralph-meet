import { describe, expect, it, vi } from 'vitest';
import { mungeStereoOpus } from '../stereo-codec';

vi.mock('@/lib/console-logger', () => ({
  clog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const opusSdp = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  '',
].join('\r\n');

describe('mungeStereoOpus', () => {
  it('keeps voice audio stereo and enables Opus DTX', () => {
    const munged = mungeStereoOpus(opusSdp, 'cam');

    expect(munged).toContain('stereo=1');
    expect(munged).toContain('sprop-stereo=1');
    expect(munged).toContain('maxaveragebitrate=128000');
    expect(munged).toContain('usedtx=1');
  });

  it('keeps screen audio stereo without Opus DTX', () => {
    const munged = mungeStereoOpus(opusSdp, 'screen');

    expect(munged).toContain('stereo=1');
    expect(munged).toContain('sprop-stereo=1');
    expect(munged).toContain('maxaveragebitrate=192000');
    expect(munged).toContain('usedtx=0');
  });
});
