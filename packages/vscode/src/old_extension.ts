import * as vscode from 'vscode';

/** The ID AI Pair had before it moved to the mattyv publisher (#51). */
export const OLD_EXTENSION_ID = 'michalstrba.ai-pair';
/** The warning shown while the old AI Pair is installed (#78). */
export const OLD_EXTENSION_WARNING =
  'An older AI Pair (michalstrba.ai-pair) is still installed and conflicts with this one. ' +
  'Uninstall it, then add your speech API keys again: they cannot be carried over.';
/** The warning's button, which uninstalls the old AI Pair. */
export const OLD_EXTENSION_UNINSTALL = 'Uninstall old AI Pair';

/** Warns when the old AI Pair is installed, and uninstalls it when asked (#78). */
export async function warnOldExtension(): Promise<void> {
  if (vscode.extensions.getExtension(OLD_EXTENSION_ID) === undefined) return;
  const choice = await vscode.window.showWarningMessage(OLD_EXTENSION_WARNING, OLD_EXTENSION_UNINSTALL);
  // VS Code reports a failed uninstall itself.
  if (choice === OLD_EXTENSION_UNINSTALL) await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', OLD_EXTENSION_ID);
}
