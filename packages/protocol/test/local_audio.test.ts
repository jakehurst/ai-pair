import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localAudioFrame, LOCAL_AUDIO_VERSION } from '../src/local_audio';

const fake = vi.hoisted(() => ({ problem: vi.fn<(text: unknown) => string | undefined>() }));
vi.mock('../src/index', () => ({ speechProblem: fake.problem }));
beforeEach(() => {
  fake.problem.mockReset();
});

const base = { version: 7, connectionEpoch: 'connection-1', sequence: 1 };
const owner = { jobId: 'job-1', pageEpoch: 1 };

describe('local audio command frames', () => {
  it('accepts version 7 and rejects version 6 companion frames', () => {
    expect(localAudioFrame.safeParse({ ...base, version: 7, type: 'attach' }).success).toBe(true);
    expect(localAudioFrame.safeParse({ ...base, version: 6, type: 'attach' }).success).toBe(false);
  });
  it('accepts the bounded commands and terminal acknowledgements', () => {
    for (const frame of [
      { ...base, type: 'attach' },
      { ...base, type: 'heartbeat' },
      { ...base, type: 'panelChunk', pageEpoch: 1, messageId: 1, index: 0, count: 1, data: '{}' },
      { ...base, type: 'panelAction', pageEpoch: 1, action: { type: 'reply', text: 'Hello.' } },
      { ...base, ...owner, type: 'speak', text: 'A short narration.' },
      { ...base, ...owner, type: 'attentionCue' },
      { ...base, ...owner, type: 'pause' },
      { ...base, ...owner, type: 'resume' },
      { ...base, ...owner, type: 'cancel' },
      { ...base, ...owner, type: 'terminal', outcome: 'ended' },
    ]) {
      expect(localAudioFrame.safeParse(frame).success).toBe(true);
    }
  });

  it('rejects wrong versions, unknown commands, extra keys and invalid identities', () => {
    for (const frame of [
      { ...base, type: 'attach', version: 3 },
      { ...base, type: 'exec', command: 'arbitrary' },
      { ...base, type: 'panelAction', pageEpoch: 1, action: { type: 'speechKeySet' } },
      { ...base, type: 'attach', secret: 'must not cross' },
      { ...base, type: 'heartbeat', sequence: 0 },
      { ...base, ...owner, type: 'pause', pageEpoch: -1 },
      { ...base, ...owner, type: 'cancel', jobId: '' },
    ]) {
      expect(localAudioFrame.safeParse(frame).success).toBe(false);
    }
  });

  it('rejects narration when the shared text validator reports a problem', () => {
    fake.problem.mockReturnValue('invalid');
    expect(localAudioFrame.safeParse({ ...base, ...owner, type: 'speak', text: 'bad' }).success).toBe(false);
    expect(fake.problem).toHaveBeenCalledWith('bad');
  });
});

describe('speech delivery frame', () => {
  it('accepts a delivery on speak and rejects it elsewhere', () => {
    const deliveryBase = { version: LOCAL_AUDIO_VERSION, connectionEpoch: 'c', sequence: 1, jobId: 'j', pageEpoch: 1 };
    expect(localAudioFrame.safeParse({ ...deliveryBase, type: 'speak', text: 'Hello', delivery: 'curious' }).success).toBe(true);
    expect(localAudioFrame.safeParse({ ...deliveryBase, type: 'speak', text: 'Hello', delivery: 'angry' }).success).toBe(false);
    expect(localAudioFrame.safeParse({ ...deliveryBase, type: 'pause', delivery: 'neutral' }).success).toBe(false);
  });
});
