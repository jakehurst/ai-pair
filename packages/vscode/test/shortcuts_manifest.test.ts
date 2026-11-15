import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';

it('contributes the requested active-session shortcuts through VS Code', () => {
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  const parsed = z
    .object({
      contributes: z.object({
        keybindings: z.array(z.object({ command: z.string(), key: z.string(), mac: z.string(), when: z.string() })),
      }),
    })
    .parse(manifest);
  expect(parsed.contributes.keybindings).toEqual([
    { command: 'aiPair.togglePause', key: 'alt+q', mac: 'ctrl+shift+q', when: 'aiPair.active' },
    { command: 'aiPair.toggleAttention', key: 'alt+w', mac: 'ctrl+shift+w', when: 'aiPair.active' },
    { command: 'aiPair.focusReply', key: 'ctrl+alt+space', mac: 'ctrl+shift+space', when: 'aiPair.active' },
  ]);
});
