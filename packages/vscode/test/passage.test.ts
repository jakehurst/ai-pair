// The built-in passage for the reading speed calibration (#109). Solitary: node:fs is a mock, so the test reads no
// file; the passage it builds is parsed by the protocol's schema.

import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PASSAGE_SCHEMA } from '@ai-pair/protocol';
import { builtInPassage } from '../src/passage';

/** Where the extension is installed. */
const EXTENSION = '/extensions/ai-pair';

vi.mock('node:fs', () => ({ readFileSync: vi.fn((file: string) => `  ${path.basename(file)}'s text\n`) }));

afterEach(() => {
  vi.clearAllMocks();
});

it("reads the passage and its notice from the extension's media folder, trimmed, under its title", () => {
  expect(PASSAGE_SCHEMA.parse(builtInPassage(EXTENSION))).toEqual({
    title: 'Comma Gets a Cure',
    text: "comma-gets-a-cure.txt's text",
    notice: "comma-gets-a-cure-notice.txt's text",
  });
  expect(vi.mocked(readFileSync).mock.calls).toEqual([
    [path.join(EXTENSION, 'media', 'comma-gets-a-cure.txt'), 'utf8'],
    [path.join(EXTENSION, 'media', 'comma-gets-a-cure-notice.txt'), 'utf8'],
  ]);
});
