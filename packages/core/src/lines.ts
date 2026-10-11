// Line identities: which lines of a file stay the same lines through edits. A line number the agent
// was shown stays good only while its line keeps that number; see "Only numbers the agent has been
// shown" in PROTOCOL.md.

import type { Change } from './ports';

/** A file's text, and the identity of each of its lines. */
interface Version {
  text: string;
  ids: readonly number[];
}

/** Lines shown to the agent: their numbers in `file` (absolute) when it read `text`. */
export interface Sighting {
  file: string;
  text: string;
  lines: number[];
}

/** Shared by all trackers, so an identity never means two lines. */
let nextId = 1;

function fresh(): number {
  return nextId++;
}

/** Returns the identity of line `index` (from 0) in `ids`, which a change within the text always has. */
function identity(ids: readonly number[], index: number): number {
  const id = ids[index];
  if (id === undefined) throw new Error(`Line ${index + 1} has no identity: the text has ${ids.length} lines.`);
  return id;
}

function newlines(text: string, from = 0, to = text.length): number {
  let n = 0;
  for (let i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1)) {
    n++;
  }
  return n;
}

/**
 * Returns the version after `change`. A line keeps its identity wherever its text goes: typing a line
 * break after it leaves it in place, one before it moves it down. A line whose text is all
 * replaced keeps its place; lines the change makes are new.
 * specs/LineIdentity.tla, `Apply`, checks it over every small text and change.
 */
export function applyChange(version: Version, change: Change): Version {
  const { text } = version;
  const start = change.offset;
  const end = change.offset + change.deleteLength;
  const after = text.slice(0, start) + change.text + text.slice(end);
  const startLine = newlines(text, 0, start);
  const endLine = startLine + newlines(text, start, end);
  const inserted = newlines(change.text);
  // Within one line: every line keeps its place.
  if (startLine === endLine && inserted === 0) return { text: after, ids: version.ids };

  const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;
  if (lineEnd > end && text[lineEnd - 1] === '\r') lineEnd--;
  // What's left of the first line before the change, and of the last one after it.
  const prefix = start > lineStart;
  const suffix = end < lineEnd;

  const ids = Array.from({ length: inserted + 1 }, fresh);
  if (prefix) {
    ids[0] = identity(version.ids, startLine);
  } else if (startLine === endLine) {
    ids[suffix ? inserted : 0] = identity(version.ids, startLine);
  }
  if (endLine > startLine && suffix && (inserted > 0 || !prefix)) ids[inserted] = identity(version.ids, endLine);
  return { text: after, ids: [...version.ids.slice(0, startLine), ...ids, ...version.ids.slice(endLine + 1)] };
}

/** The identities of the lines of files, as they're edited. */
export class LineIds {
  private constructor(
    /** What a copy hasn't tracked itself comes from here: the editor's. */
    private readonly base: LineIds | undefined,
    private readonly versions: Map<string, Version>,
  ) {}

  /** Returns the tracker for the files in the editor. */
  static editor(): LineIds {
    return new LineIds(/* base= */ undefined, new Map());
  }

  /**
   * Returns the identities of the lines of `text`, the file's text now. A text it doesn't know, say
   * after a change it didn't hear about, gets new ones: nothing is known about its lines.
   */
  of(file: string, text: string): readonly number[] {
    return this.version(file, text).ids;
  }

  /** Follows a change to a file, if it tracks the file. Call `of` with the text before it first. */
  apply(file: string, change: Change): void {
    const v = this.versions.get(file);
    if (v) this.versions.set(file, applyChange(v, change));
  }

  /** Returns a copy to play batches in memory with: its changes don't affect this one. */
  fork(): LineIds {
    return this.base ? new LineIds(this.base, new Map(this.versions)) : new LineIds(this, new Map());
  }

  /** Drops this copy's own identities for a file, so it reads the ones it was forked from again. */
  forget(file: string): void {
    this.versions.delete(file);
  }

  /**
   * Takes the identities from a copy where batches played in memory, for the files that now read
   * as they did there: so the lines those batches typed are the same lines in both.
   */
  adopt(played: LineIds): void {
    for (const [file, v] of played.versions) {
      if (this.versions.get(file)?.text === v.text) this.versions.set(file, v);
    }
  }

  private version(file: string, text: string): Version {
    const known = this.versions.get(file);
    if (known?.text === text) return known;
    const v = this.base?.version(file, text) ?? { text, ids: Array.from({ length: newlines(text) + 1 }, fresh) };
    this.versions.set(file, v);
    return v;
  }
}
