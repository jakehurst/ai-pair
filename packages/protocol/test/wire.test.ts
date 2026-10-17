// The wire protocol's helpers: where the discovery files live, and how a frame's bytes become a message (#4, #30).

import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoveryDir, parseRelayMessage, type Frame } from '@ai-pair/protocol';

const HOME = '/home/pair';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('discoveryDir', () => {
  it('is the windows directory under AI_PAIR_HOME', () => {
    vi.stubEnv('AI_PAIR_HOME', HOME);
    expect(discoveryDir()).toBe(path.join(HOME, 'windows'));
  });
});

describe('parseRelayMessage', () => {
  const cancel = { type: 'cancel', id: 7 };
  const json = JSON.stringify(cancel);
  const middle = Math.floor(json.length / 2);
  const frames: Array<{ form: string; frame: Frame }> = [
    { form: 'a Buffer', frame: Buffer.from(json) },
    { form: 'an ArrayBuffer', frame: new TextEncoder().encode(json).buffer },
    { form: 'a Buffer array', frame: [Buffer.from(json.slice(0, middle)), Buffer.from(json.slice(middle))] },
  ];

  it.each(frames)('reads a frame given as $form', ({ frame }) => {
    expect(parseRelayMessage(frame)).toEqual(cancel);
  });
});
