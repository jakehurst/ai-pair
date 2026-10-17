// What the core needs from the editor and the narration panel.

import type { Excerpt, Turn } from '@ai-pair/protocol';

/** What the agent is doing, as the panel shows it. */
export type AgentState = 'typing' | 'read' | 'running' | 'thinking' | 'absent' | 'paused' | 'listening' | 'navigator';

/** What follow mode keeps in the programmer's view: the agent cursor, or the code it last pointed at. */
export type Focus = 'cursor' | 'point';

/** Where the editor's cursor is, and what is selected, as offsets into the file. */
export interface CursorView {
  file: string;
  offset: number;
  selection?: { start: number; end: number };
}

/** Where an edit puts undo stops, so the programmer undoes a batch in sensible steps. */
export interface EditOptions {
  undoStopBefore: boolean;
  undoStopAfter: boolean;
}

/** What a command produced in the terminal, and how it ended. */
export interface CommandOutcome {
  /** Absent while still running, or when the terminal couldn't report it. */
  exitCode?: number;
  output: string;
  truncated?: boolean;
  running?: boolean;
  /** The terminal's shell, e.g. `pwsh` or `zsh`, when it's known. */
  shell?: string;
  /** Interrupted before the command was sent to the terminal. */
  notStarted?: boolean;
  /** For a command still running: settles when it ends, with its exit code if the terminal reported one. */
  exited?: Promise<number | undefined>;
}

/** How to run a command: where, how long to wait, and the signal that stops waiting. */
export interface RunOptions {
  /** Directory to run in (absolute). */
  cwd: string;
  /** Stop waiting after this long; the command keeps running. */
  waitMs: number;
  /** Aborted when playback is interrupted: stop waiting, leave the command running. */
  signal: AbortSignal;
}

/** An excerpt whose `file` is absolute, as the editor knows it. */
export type SharedSelection = Excerpt;

/** A range of lines in a file, for the panel to open. */
export interface Ref {
  file: string;
  line: number;
  endLine: number;
}

/** A file that isn't on disk, with no unsaved text in the editor for it (#88, #89). */
export class MissingFile extends Error {
  constructor(readonly file: string) {
    super(`${file} doesn't exist`);
  }
}

/** Files are absolute paths; offsets are into the document text. */
export interface EditorPort {
  /**
   * Returns the absolute path for a path given by the agent (absolute or workspace-relative), in the same
   * canonical form the editor reports files in (e.g. VS Code lowercases the Windows drive letter).
   */
  resolvePath(file: string): string;
  /** Returns how to name a file to the agent. */
  displayPath(file: string): string;
  /** Returns the file's text: the editor's, with unsaved changes. Throws `MissingFile` for a file that doesn't exist. */
  getText(file: string): Promise<string>;
  /** Returns the line ending the editor stores in the file, "\n" or "\r\n", known even for an empty buffer. */
  eol(file: string): Promise<string>;
  isDirty(file: string): Promise<boolean>;
  /** Opens the file (creating it empty if missing) and makes it the visible editor. */
  show(file: string): Promise<void>;
  edit(file: string, offset: number, deleteLength: number, text: string, options: EditOptions): Promise<void>;
  save(file: string): Promise<void>;
  renderCursor(cursor: CursorView | undefined, state: AgentState, focus: Focus): void;
  renderPoint(point?: { file: string; start: number; end: number }): void;
  /** Brings the programmer's view back to what it follows. */
  reveal(): void;
  /** Keeps what the view follows in view, after a keystroke, move, selection or point of the agent changed it. */
  follow(): void;
  /** Runs a command in a terminal the programmer can see. */
  runCommand(command: string, options: RunOptions): Promise<CommandOutcome>;
}

/** What a `Player` asks of the editor: the rest of `EditorPort` is the controller's. */
export type PlayerEditor = Omit<EditorPort, 'isDirty' | 'renderCursor' | 'reveal'>;

/** Something the panel shows: a session starting or ending, a status, a word to the programmer, a report. */
export type PanelEvent =
  /** `rules`: the project guides the agent was given (#23). */
  | { type: 'session'; active: true; task?: string; rules?: string[]; suspended?: true; resumed?: true }
  | { type: 'session'; active: false; reason: 'agent' | 'user' | 'disconnected'; summary?: string }
  | { type: 'say'; text: string }
  | { type: 'reading'; ms: number }
  | { type: 'state'; state: AgentState; turn: Turn; paused: boolean }
  | { type: 'user'; text: string; ref?: Ref }
  | { type: 'turn'; to: Turn; message?: string; ref?: Ref }
  | { type: 'interrupt' }
  | { type: 'point'; file: string; line: number }
  /** Files changed on disk outside the protocol, written close together (#15). As the agent names them. */
  | { type: 'outside'; files: string[] }
  | {
      type: 'run';
      id: number;
      command: string;
      /** `exited`: a command left running in the background has ended since. */
      phase: 'confirm' | 'running' | 'done' | 'declined' | 'background' | 'exited';
      exitCode?: number;
    };

/** The narration panel, as the controller sees it. */
export interface PanelPort {
  post(event: PanelEvent): void;
}

/** A change to a document, in the coordinates of the text before it. */
export interface Change {
  offset: number;
  deleteLength: number;
  text: string;
}
