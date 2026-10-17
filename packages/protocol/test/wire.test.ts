// The wire protocol's helpers: where the discovery files live, and how a frame's bytes become a message (#4, #30).
// Solitary: the home directory comes from a mocked node:os; the message schemas are constants, and real.

import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiPairHome, discoveryDir, parseEditorMessage, parseRelayMessage, type Frame } from '../src/wire';

/** The user's home directory, as the mocked node:os gives it. */
const USER_HOME = '/home/me';

/** An AI_PAIR_HOME the environment sets. */
const HOME = '/home/pair';

vi.mock('node:os', () => ({ homedir: vi.fn(() => USER_HOME) }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('aiPairHome', () => {
  it('is AI_PAIR_HOME, or .ai-pair in the home directory when it is not set', () => {
    vi.stubEnv('AI_PAIR_HOME', HOME);
    expect(aiPairHome()).toBe(HOME);
    vi.stubEnv('AI_PAIR_HOME', undefined);
    expect(aiPairHome()).toBe(path.join(USER_HOME, '.ai-pair'));
  });
});

describe('discoveryDir', () => {
  it('is the windows directory under AI_PAIR_HOME', () => {
    vi.stubEnv('AI_PAIR_HOME', HOME);
    expect(discoveryDir()).toBe(path.join(HOME, 'windows'));
  });
});

describe('parseRelayMessage', () => {
  it('reads a message from the relay', () => {
    const cancel = { type: 'cancel', id: 7 };
    const frame: Frame = Buffer.from(JSON.stringify(cancel));
    expect(parseRelayMessage(frame)).toEqual(cancel);
  });

  it('gives nothing for a frame that is not JSON, or JSON no relay message fits', () => {
    expect(parseRelayMessage(Buffer.from('{"type":'))).toBeUndefined();
    expect(parseRelayMessage(Buffer.from(JSON.stringify({ type: 'welcome' })))).toBeUndefined();
  });
});

describe('parseEditorMessage', () => {
  it('reads a message from the editor, and gives nothing for a frame that is not one (SendGarbage)', () => {
    expect(parseEditorMessage(Buffer.from(JSON.stringify({ type: 'welcome' })))).toEqual({ type: 'welcome' });
    expect(parseEditorMessage(Buffer.from('not json'))).toBeUndefined();
    expect(parseEditorMessage(Buffer.from(JSON.stringify({ type: 'cancel', id: 7 })))).toBeUndefined();
  });
});
