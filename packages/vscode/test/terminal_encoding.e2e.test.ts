// Compares the Bash submission with the original in a real Bash process.
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ window: {} }));
import { commandForShell } from '../src/terminal';

describe('Bash multiline submission', () => {
  it.each([
    "cat <<'EOF' | tail -n 1\nalpha\nbeta\nEOF\n",
    "cat <<'CPP'\n#include <iostream>\nint main() { std::cout << \"$x \\\\n ' café\"; }\nCPP\n",
    "printf '%s\\n' 'literal \\\\n' 'quote'\nprintf 'done\\n'\n",
    'set -o pipefail\nprintf fail | false\n',
    'cd /tmp\nexport PAIR_ENCODING=ready\nprintf \'%s:%s\\n\' "$PWD" "$PAIR_ENCODING"\n',
    "printf 'control\\n'\n\tprintf 'unicode café\\n'\n",
  ])('preserves command output and exit for %s', (command) => {
    const original = spawnSync('/bin/bash', ['-c', command], { encoding: 'utf8' });
    const submitted = spawnSync('/bin/bash', ['-c', commandForShell(command, 'bash')], { encoding: 'utf8' });
    expect(submitted.stdout).toBe(original.stdout);
    expect(submitted.stderr).toBe(original.stderr);
    expect(submitted.status).toBe(original.status);
  });
});

it('keeps cwd and exported variables for the next command in the same shell', () => {
  const original = 'cd /tmp\nexport PAIR_PERSIST=ready\n';
  const next = 'printf \'%s:%s\\n\' "$PWD" "$PAIR_PERSIST"';
  const result = spawnSync('/bin/bash', ['-c', `${commandForShell(original, 'bash')}\n${next}`], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('/tmp:ready\n');
});
