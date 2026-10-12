// Playing a batch in memory before queuing it, so an action that would fail (text that isn't on
// its line, say) is reported at once, instead of when the batch plays, minutes later. It's the same
// player as real playback, on a stage that plays in a copy of the editor, instantly and silently.

import type { Action, BatchResult } from '@ai-pair/protocol';
import type { Config } from './config';
import type { LineIds, Sighting } from './lines';
import { Player, transformScene, type Scene } from './player';
import { MissingFile, type Change, type CommandOutcome, type EditorPort, type PanelPort, type PlayerEditor } from './ports';
import { instant } from './timeline';

/** A panel that shows nothing: a rehearsal is silent. */
const silent: PanelPort = { post: () => {} };

/** What playing batches leaves behind: the scene, the text of each file they edited, and its lines. `edits`: this batch's own. */
export interface Rehearsal {
  scene: Scene;
  texts: Map<string, string>;
  lines: LineIds;
  edits: Set<string>;
}

/** A copy of the editor: files it has edited are its own, the rest are read from the real one. */
class MemoryEditor implements PlayerEditor {
  readonly edits = new Set<string>();

  constructor(
    private readonly real: EditorPort,
    readonly texts: Map<string, string>,
  ) {}

  resolvePath(file: string): string {
    return this.real.resolvePath(file);
  }

  displayPath(file: string): string {
    return this.real.displayPath(file);
  }

  async getText(file: string): Promise<string> {
    return this.texts.get(file) ?? (await this.real.getText(file));
  }

  async eol(file: string): Promise<string> {
    try {
      return await this.real.eol(file);
    } catch {
      // Only created in memory.
      return '\n';
    }
  }

  async show(file: string): Promise<void> {
    if (this.texts.has(file)) return;
    try {
      await this.real.getText(file);
    } catch (error) {
      // Showing a file creates it.
      if (!(error instanceof MissingFile)) throw error;
      this.texts.set(file, '');
    }
  }

  async edit(file: string, offset: number, deleteLength: number, text: string): Promise<void> {
    const old = await this.getText(file);
    this.texts.set(file, old.slice(0, offset) + text + old.slice(offset + deleteLength));
    this.edits.add(file);
  }

  async save(): Promise<void> {}
  renderPoint(): void {}
  follow(): void {}

  runCommand(): Promise<CommandOutcome> {
    return Promise.resolve({ exitCode: 0, output: '' });
  }
}

/**
 * Plays `actions` in memory, starting from `from`. Commands don't run, and succeed; a `move` goes
 * only to a line the agent `knows`. Returns the batch's result, the lines it shows, and what it
 * leaves behind, for rehearsing the batch after it.
 */
export async function rehearse(
  editor: EditorPort,
  config: Config,
  from: Rehearsal,
  actions: Action[],
  knows: (file: string, line: number, id: number) => boolean,
): Promise<{ result: BatchResult; sightings: Sighting[]; after: Rehearsal }> {
  const scene: Scene = {
    ...from.scene,
    cursor: from.scene.cursor && { ...from.scene.cursor },
    selection: from.scene.selection && { ...from.scene.selection },
    point: from.scene.point && { ...from.scene.point },
  };
  const memory = new MemoryEditor(editor, new Map(from.texts));
  const lines = from.lines.fork();
  const player = new Player(scene, {
    editor: memory,
    panel: silent,
    pacing: instant,
    config: () => config,
    speed: () => 1,
    readingSpeed: () => 1,
    render: () => {},
    confirm: () => Promise.resolve(true),
    lines,
    knows,
  });
  const { result, sightings } = await player.play(/* id= */ 0, actions);
  return { result, sightings, after: { scene, texts: memory.texts, lines, edits: memory.edits } };
}

/**
 * Follows a change by others to a file no queued batch edits, so its rehearsed text is the editor's.
 * Its line identities are the editor's too: a copy of its own would give a line the change inserts
 * an identity of its own, unlike the one the agent is shown (specs/Rehearsal.tla, `ShareIds`).
 */
export function followChange(r: Rehearsal, file: string, after: string, changes: Change[]): void {
  for (const change of changes) {
    transformScene(r.scene, file, change);
  }
  r.lines.forget(file);
  if (r.texts.has(file)) r.texts.set(file, after);
}
