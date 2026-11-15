// SystemOutputDriver on its own (#82): the audio-native adapter is a typed fake and the factory is mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { AudioAdapter, AudioEvent, AudioLease } from '../../audio-native/src';
import { createLocalAudioAdapter } from '../../audio-native/src/factory';
import { SystemOutputDriver, systemOutputDriver } from '../src/speech_system_output';

vi.mock('../../audio-native/src/factory', () => ({ createLocalAudioAdapter: vi.fn() }));

/** Returns a fake adapter whose admit, play and stop the test settles by hand. */
function fakeAdapter() {
  const lease = mock<AudioLease>();
  const listeners: Array<(event: AudioEvent) => void> = [];
  const stopped = Promise.withResolvers<void>();
  const adapter = {
    capabilities: vi.fn<AudioAdapter['capabilities']>(() =>
      Promise.resolve({ backend: 'coreaudio', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true }),
    ),
    list: vi.fn<AudioAdapter['list']>(() => Promise.resolve([])),
    admit: vi.fn<AudioAdapter['admit']>(() => Promise.resolve(lease)),
    play: vi.fn<AudioAdapter['play']>(() => Promise.resolve()),
    pause: vi.fn<AudioAdapter['pause']>(() => Promise.resolve()),
    resume: vi.fn<AudioAdapter['resume']>(() => Promise.resolve()),
    stop: vi.fn<AudioAdapter['stop']>(() => stopped.promise),
    onEvent: vi.fn<AudioAdapter['onEvent']>((listener) => {
      listeners.push(listener);
      return { dispose: vi.fn<() => void>() };
    }),
  };
  /** Delivers one helper event for the given job. */
  function emit(jobId: string, type: AudioEvent['type']): void {
    for (const listener of listeners) listener({ owner: { connectionEpoch: 'legacy', jobId, pageEpoch: 0 }, sequence: 1, part: 0, type });
  }
  return { adapter, emit, stopped, lease };
}

/** Lets queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SystemOutputDriver', () => {
  it('reports support only when the helper has a default output, and never throws', async () => {
    const h = fakeAdapter();
    const driver = new SystemOutputDriver(h.adapter);
    expect(await driver.supported()).toBe(true);
    h.adapter.capabilities.mockResolvedValueOnce({
      backend: 'unavailable',
      location: 'ui',
      defaultOutput: false,
      deviceSelection: false,
      pauseResume: false,
    });
    expect(await driver.supported()).toBe(false);
    h.adapter.capabilities.mockRejectedValueOnce(new Error('helper missing'));
    expect(await driver.supported()).toBe(false);
  });

  it('NativeDefault: admits the default, plays, reports start and end, and releases only after the helper stops', async () => {
    const h = fakeAdapter();
    const driver = new SystemOutputDriver(h.adapter);
    const events: string[] = [];
    expect(
      driver.play('', new Uint8Array(44), (event) => {
        events.push(event);
      }),
    ).toBe(true);
    expect(driver.play('', new Uint8Array(44), vi.fn<() => void>())).toBe(false);
    await settle();
    expect(h.adapter.admit).toHaveBeenCalledWith({ connectionEpoch: 'legacy', jobId: '1', pageEpoch: 0 }, { kind: 'default' });
    expect(h.adapter.play).toHaveBeenCalledWith(h.lease, expect.any(Uint8Array));
    h.emit('9', 'started');
    h.emit('1', 'started');
    h.emit('1', 'ended');
    h.emit('1', 'ended');
    expect(events).toEqual(['started']);
    expect(driver.available()).toBe(false);
    h.stopped.resolve();
    await settle();
    expect(events).toEqual(['started', 'ended']);
    expect(driver.available()).toBe(true);
  });

  it('reports a failed admission, a failed play, or a helper failure as failed', async () => {
    const h = fakeAdapter();
    h.stopped.resolve();
    h.adapter.stop.mockRejectedValue(new Error('already gone'));
    const driver = new SystemOutputDriver(h.adapter);
    const events: string[] = [];
    h.adapter.admit.mockRejectedValueOnce(new Error('no default'));
    driver.play('', new Uint8Array(44), (event) => {
      events.push(event);
    });
    await settle();
    h.adapter.play.mockRejectedValueOnce(new Error('busy'));
    driver.play('', new Uint8Array(44), (event) => {
      events.push(event);
    });
    await settle();
    driver.play('', new Uint8Array(44), (event) => {
      events.push(event);
    });
    await settle();
    h.emit('3', 'canceled');
    await settle();
    expect(events).toEqual(['failed', 'failed', 'failed']);
    expect(driver.available()).toBe(true);
  });

  it('RetirementCompletes: pauses and resumes the job, and a stop keeps ownership until retirement with no late events', async () => {
    const h = fakeAdapter();
    const driver = new SystemOutputDriver(h.adapter);
    const events: string[] = [];
    driver.control('stop');
    driver.play('', new Uint8Array(44), (event) => {
      events.push(event);
    });
    await settle();
    driver.control('pause');
    driver.control('resume');
    h.adapter.pause.mockRejectedValueOnce(new Error('gone'));
    driver.control('pause');
    await settle();
    expect(h.adapter.pause).toHaveBeenCalledTimes(2);
    expect(h.adapter.resume).toHaveBeenCalledOnce();
    driver.control('stop');
    driver.control('stop');
    h.emit('1', 'ended');
    expect(driver.available()).toBe(false);
    h.stopped.resolve();
    await settle();
    expect(h.adapter.stop).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
    expect(driver.available()).toBe(true);
  });

  it('reports one failure when the helper fails and its play request then rejects too', async () => {
    const h = fakeAdapter();
    const playing = Promise.withResolvers<void>();
    h.adapter.play.mockReturnValueOnce(playing.promise);
    const driver = new SystemOutputDriver(h.adapter);
    const events: string[] = [];
    driver.play('', new Uint8Array(44), (event) => {
      events.push(event);
    });
    await settle();
    h.emit('1', 'failed');
    playing.reject(new Error('helper failed'));
    h.stopped.resolve();
    await settle();
    expect(events).toEqual(['failed']);
    expect(h.adapter.stop).toHaveBeenCalledOnce();
  });

  it('suppresses a terminal event when a stop arrives before retirement finishes', async () => {
    const h = fakeAdapter();
    const driver = new SystemOutputDriver(h.adapter);
    const events: string[] = [];
    driver.play('', new Uint8Array(44), (event) => {
      events.push(event);
    });
    await settle();
    h.emit('1', 'failed');
    driver.control('stop');
    h.stopped.resolve();
    await settle();
    expect(events).toEqual([]);
  });
});

it('creates a driver on a local macOS or Linux desktop only (#84)', () => {
  const h = fakeAdapter();
  vi.mocked(createLocalAudioAdapter).mockReturnValue(h.adapter);
  expect(systemOutputDriver('/ext', /* localDesktop= */ true, 'darwin')).toBeInstanceOf(SystemOutputDriver);
  expect(createLocalAudioAdapter).toHaveBeenCalledWith('/ext');
  expect(systemOutputDriver('/ext', /* localDesktop= */ true, 'linux')).toBeInstanceOf(SystemOutputDriver);
  expect(systemOutputDriver('/ext', /* localDesktop= */ true, 'win32')).toBeUndefined();
  vi.mocked(createLocalAudioAdapter).mockClear();
  expect(systemOutputDriver('/ext', /* localDesktop= */ false, 'linux')).toBeUndefined();
  expect(systemOutputDriver('/ext', /* localDesktop= */ false, 'darwin')).toBeUndefined();
  expect(createLocalAudioAdapter).not.toHaveBeenCalled();
  const local = systemOutputDriver('/ext', /* localDesktop= */ true);
  expect(local).toEqual(['darwin', 'linux'].includes(process.platform) ? expect.any(SystemOutputDriver) : undefined);
});
