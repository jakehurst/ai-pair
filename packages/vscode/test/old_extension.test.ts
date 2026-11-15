import { afterEach, describe, expect, it, vi } from 'vitest';

const vscode = vi.hoisted(() => ({
  extensions: { getExtension: vi.fn() },
  window: { showWarningMessage: vi.fn() },
  commands: { executeCommand: vi.fn() },
}));
vi.mock('vscode', () => vscode);

import { OLD_EXTENSION_ID, OLD_EXTENSION_UNINSTALL, OLD_EXTENSION_WARNING, warnOldExtension } from '../src/old_extension';

afterEach(() => {
  vi.resetAllMocks();
});

describe('warnOldExtension', () => {
  it('stays silent when the old AI Pair is not installed', async () => {
    vscode.extensions.getExtension.mockReturnValue(undefined);
    await warnOldExtension();
    expect(vscode.extensions.getExtension).toHaveBeenCalledWith(OLD_EXTENSION_ID);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('warns and leaves the old AI Pair when the warning is dismissed', async () => {
    vscode.extensions.getExtension.mockReturnValue({ id: OLD_EXTENSION_ID });
    vscode.window.showWarningMessage.mockResolvedValue(undefined);
    await warnOldExtension();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(OLD_EXTENSION_WARNING, OLD_EXTENSION_UNINSTALL);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('uninstalls the old AI Pair from the warning button', async () => {
    vscode.extensions.getExtension.mockReturnValue({ id: OLD_EXTENSION_ID });
    vscode.window.showWarningMessage.mockResolvedValue(OLD_EXTENSION_UNINSTALL);
    vscode.commands.executeCommand.mockResolvedValue(undefined);
    await warnOldExtension();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.extensions.uninstallExtension', OLD_EXTENSION_ID);
  });
});
