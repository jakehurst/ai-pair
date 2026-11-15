import { describe, expect, it, vi } from 'vitest';
import { decodeWav, MAX_WAV_BYTES, SpeechAudio, type AudioClip } from '../src/webview/speech_audio';

function harness() {
  const listeners = new Map<string, () => void>();
  const audio = {
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn<() => void>(),
    addEventListener: vi.fn((name: string, callback: () => void) => {
      listeners.set(name, callback);
    }),
  };
  const revoke = vi.fn<() => void>();
  const make = vi.fn<() => AudioClip>(() => ({ audio, revoke }));
  const send = vi.fn<(event: { id: number; pageId: number; event: 'started' | 'ended' | 'failed' }) => void>();
  return { audio, make, revoke, send, listeners, player: new SpeechAudio(make, send) };
}

describe('speech page audio', () => {
  it('plays only the current page and unit, then acknowledges and releases it', async () => {
    const h = harness();
    h.player.page(1);
    h.player.begin(4, 1);
    h.player.audio(4, 2, 'wav', false);
    expect(h.make).not.toHaveBeenCalled();
    h.player.audio(4, 1, 'wav', false);
    await Promise.resolve();
    expect(h.send.mock.calls).toEqual([[{ id: 4, pageId: 1, event: 'started' }]]);
    h.listeners.get('ended')?.();
    expect(h.send.mock.calls.at(-1)).toEqual([{ id: 4, pageId: 1, event: 'ended' }]);
    expect(h.revoke).toHaveBeenCalledOnce();
  });

  it('interrupts synchronously and never resurrects the old unit', async () => {
    const h = harness();
    h.player.page(1);
    h.player.begin(4, 1);
    h.player.audio(4, 1, 'wav', false);
    h.player.stop();
    expect(h.audio.pause).toHaveBeenCalledOnce();
    expect(h.revoke).toHaveBeenCalledOnce();
    h.player.begin(4, 1);
    h.player.audio(4, 1, 'wav', false);
    await Promise.resolve();
    expect(h.make).toHaveBeenCalledOnce();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('keeps audio paused until the matching unit resumes', async () => {
    const h = harness();
    h.player.page(1);
    h.player.begin(3, 1);
    h.player.audio(3, 1, 'wav', true);
    expect(h.audio.play).not.toHaveBeenCalled();
    h.player.control(4, 1, 'resume');
    expect(h.audio.play).not.toHaveBeenCalled();
    h.player.control(3, 1, 'resume');
    await Promise.resolve();
    expect(h.audio.play).toHaveBeenCalledOnce();
    h.player.control(3, 1, 'pause');
    expect(h.audio.pause).toHaveBeenCalledOnce();
  });
});

it('rejects empty, malformed and oversized encoded audio before allocation', () => {
  expect([...decodeWav('V0FW')]).toEqual([87, 65, 86]);
  expect(() => decodeWav('')).toThrow();
  expect(() => decodeWav('!')).toThrow();
  expect(() => decodeWav('   ')).toThrow();
  expect(() => decodeWav('A'.repeat(Math.ceil(MAX_WAV_BYTES / 3) * 4))).toThrow();
  expect(() => decodeWav('A'.repeat(Math.ceil(MAX_WAV_BYTES / 3) * 4 + 4))).toThrow();
});

it('ignores stale callbacks when a page or unit changes', async () => {
  const h = harness();
  const deferred = Promise.withResolvers<void>();
  h.audio.play.mockReturnValueOnce(deferred.promise);
  h.player.page(1);
  h.player.begin(1, 1);
  h.player.audio(1, 1, 'wav', false);
  const ended = h.listeners.get('ended');
  const error = h.listeners.get('error');
  h.player.page(2);
  h.player.begin(2, 2);
  deferred.resolve();
  await Promise.resolve();
  ended?.();
  error?.();
  expect(h.send).not.toHaveBeenCalled();
  expect(h.revoke).toHaveBeenCalledOnce();
});

it('reports a failed clip or rejected playback without advancing another unit', async () => {
  const h = harness();
  h.player.page(1);
  h.player.begin(1, 1);
  h.make.mockImplementationOnce(() => {
    throw new Error('bad audio');
  });
  h.player.audio(1, 1, 'bad', false);
  expect(h.send.mock.calls).toEqual([[{ id: 1, pageId: 1, event: 'failed' }]]);
  h.player.begin(2, 1);
  h.audio.play.mockRejectedValueOnce(new Error('autoplay'));
  h.player.audio(2, 1, 'wav', false);
  await Promise.resolve();
  expect(h.send.mock.calls.at(-1)).toEqual([{ id: 2, pageId: 1, event: 'failed' }]);
  expect(h.revoke).toHaveBeenCalledOnce();
});

it('rejects invalid page and unit IDs and ignores duplicate audio', async () => {
  const h = harness();
  h.player.page(0);
  h.player.begin(1, 0);
  h.player.audio(1, 0, 'wav', false);
  expect(h.make).not.toHaveBeenCalled();
  h.player.page(1);
  h.player.begin(Number.NaN, 1);
  h.player.begin(-1, 1);
  h.player.audio(1, 1, 'wav', false);
  expect(h.make).not.toHaveBeenCalled();
  h.player.begin(1, 1);
  h.player.audio(1, 1, 'wav', false);
  h.player.audio(1, 1, 'wav', false);
  await Promise.resolve();
  expect(h.make).toHaveBeenCalledOnce();
});

it('reports a synchronous audio-play failure and releases the URL', () => {
  const h = harness();
  h.player.page(1);
  h.player.begin(1, 1);
  h.audio.play.mockImplementationOnce(() => {
    throw new Error('not available');
  });
  h.player.audio(1, 1, 'wav', false);
  expect(h.send.mock.calls).toEqual([[{ id: 1, pageId: 1, event: 'failed' }]]);
  expect(h.revoke).toHaveBeenCalledOnce();
});

it('ignores a paused play rejection and resumes the same unit', async () => {
  const h = harness();
  const first = Promise.withResolvers<void>();
  h.audio.play.mockReturnValueOnce(first.promise);
  h.player.page(1);
  h.player.begin(1, 1);
  h.player.audio(1, 1, 'wav', false);
  h.player.control(1, 1, 'pause');
  first.reject(new Error('interrupted by pause'));
  await Promise.resolve();
  expect(h.send).not.toHaveBeenCalled();
  expect(h.revoke).not.toHaveBeenCalled();
  h.player.control(1, 1, 'resume');
  await Promise.resolve();
  expect(h.send.mock.calls).toEqual([[{ id: 1, pageId: 1, event: 'started' }]]);
});

it('ignores an earlier play rejection after a newer resume starts', async () => {
  const h = harness();
  const first = Promise.withResolvers<void>();
  h.audio.play.mockReturnValueOnce(first.promise);
  h.player.page(1);
  h.player.begin(1, 1);
  h.player.audio(1, 1, 'wav', false);
  h.player.control(1, 1, 'pause');
  h.player.control(1, 1, 'resume');
  await Promise.resolve();
  first.reject(new Error('interrupted by pause'));
  await Promise.resolve();
  expect(h.send.mock.calls).toEqual([[{ id: 1, pageId: 1, event: 'started' }]]);
  expect(h.revoke).not.toHaveBeenCalled();
});

it('reports media errors only for the current clip and accepts an explicit stop', () => {
  const h = harness();
  h.player.page(1);
  h.player.begin(1, 1);
  h.player.audio(1, 1, 'wav', true);
  h.listeners.get('error')?.();
  expect(h.send.mock.calls).toEqual([[{ id: 1, pageId: 1, event: 'failed' }]]);
  expect(h.revoke).toHaveBeenCalledOnce();
  h.player.begin(2, 1);
  h.player.audio(2, 1, 'wav', true);
  h.player.control(2, 1, 'stop');
  expect(h.revoke).toHaveBeenCalledTimes(2);
});

it('ignores resume without a pause and handles pause before the clip arrives', async () => {
  const h = harness();
  h.player.page(1);
  h.player.begin(1, 1);
  h.player.control(1, 1, 'resume');
  h.player.control(1, 1, 'pause');
  h.player.control(1, 1, 'resume');
  expect(h.audio.play).not.toHaveBeenCalled();
  h.player.audio(1, 1, 'wav', false);
  await Promise.resolve();
  expect(h.send.mock.calls).toEqual([[{ id: 1, pageId: 1, event: 'started' }]]);
});

it('acknowledges retirement only after the named current clip is silent', () => {
  const h = harness();
  h.player.page(1);
  h.player.begin(4, 1);
  h.player.audio(4, 1, 'wav', true);
  expect(h.player.retire(4, 2)).toBe(false);
  expect(h.player.retire(5, 1)).toBe(false);
  expect(h.audio.pause).not.toHaveBeenCalled();
  expect(h.player.retire(4, 1)).toBe(true);
  expect(h.audio.pause).toHaveBeenCalledOnce();
  expect(h.revoke).toHaveBeenCalledOnce();
  expect(h.player.retire(4, 1)).toBe(true);
  expect(h.player.retire(0, 1)).toBe(false);
});

/** Rejects as a browser does before any user gesture. */
function notAllowed(): Promise<void> {
  return Promise.reject(new DOMException('needs a gesture', 'NotAllowedError'));
}

describe('BlockedResolves and AcceptedStarts: a clip the browser refuses before any gesture (#77)', () => {
  it('keeps the refused clip and starts it from the next gesture', async () => {
    const h = harness();
    h.audio.play.mockImplementationOnce(notAllowed);
    h.player.page(1);
    h.player.begin(4, 1);
    h.player.audio(4, 1, 'wav', false);
    await Promise.resolve();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.revoke).not.toHaveBeenCalled();
    h.player.gesture();
    await Promise.resolve();
    expect(h.audio.play).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls).toEqual([[{ id: 4, pageId: 1, event: 'started' }]]);
    h.player.gesture();
    expect(h.audio.play).toHaveBeenCalledTimes(2);
  });

  it('BlockedIsCurrent: a gesture after a pause or stop starts nothing', async () => {
    const h = harness();
    h.audio.play.mockImplementation(notAllowed);
    h.player.page(1);
    h.player.begin(4, 1);
    h.player.audio(4, 1, 'wav', false);
    await Promise.resolve();
    h.player.control(4, 1, 'pause');
    h.player.gesture();
    expect(h.audio.play).toHaveBeenCalledOnce();
    h.player.control(4, 1, 'resume');
    await Promise.resolve();
    h.player.stop();
    h.player.gesture();
    expect(h.audio.play).toHaveBeenCalledTimes(2);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('does nothing on a gesture when no clip is held', () => {
    const h = harness();
    h.player.gesture();
    expect(h.audio.play).not.toHaveBeenCalled();
  });
});
