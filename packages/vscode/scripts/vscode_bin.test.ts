// The VS Code download script on its own (#176): it prints the path of the stable build it fetched. Solitary:
// @vscode/test-electron is a fake; the script runs afresh on import.

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@vscode/test-electron', () => ({ downloadAndUnzipVSCode: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("downloads stable VS Code and prints its executable's path", async () => {
  vi.mocked(downloadAndUnzipVSCode).mockResolvedValue('/cache/vscode/code');
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logs.push(line);
  });
  vi.resetModules();
  await import('./vscode_bin.mts');
  expect(downloadAndUnzipVSCode).toHaveBeenCalledWith('stable');
  expect(logs).toEqual(['/cache/vscode/code']);
});
