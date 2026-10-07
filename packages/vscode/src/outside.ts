// Files changed on disk outside the protocol, marked until the programmer looks at them (#15,
// specs/Outside.tla). No VS Code here, so it can be tested on its own; extension.ts watches the
// files and draws the marks.

import { withinFolder } from "@ai-pair/protocol"

/**
 * Changes this close together are one history entry: a bulk rename, a branch switch. They are
 * decided when the group settles, by which time VS Code has told of its own saves.
 */
export const GROUP_MS = 500

export class OutsideChanges {
  private readonly marked = new Set<string>()
  /** Each file's text as VS Code last wrote it, or the programmer last saw it. */
  private readonly known = new Map<string, string>()
  private group: string[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * `read`: a file's text on disk, or undefined if it's gone. `report`: the history entry for a
   * group of files changed outside. `redraw`: files whose badge appeared or went.
   */
  constructor(
    private readonly read: (file: string) => Promise<string | undefined>,
    private readonly report: (files: string[]) => void,
    private readonly redraw: (files: string[]) => void,
  ) {}

  /** VS Code wrote `text` to the file: a document saved, or the extension creating the file. */
  saved(file: string, text: string): void {
    this.known.set(file, text)
  }

  /** The file watcher reported a write. It's decided once the group settles. */
  reported(file: string): void {
    if (!this.group.includes(file)) this.group.push(file)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.settle(), GROUP_MS)
  }

  /** The programmer opened the file, or its diff, and saw `text`: the mark clears. */
  seen(file: string, text: string): void {
    this.known.set(file, text)
    if (this.marked.delete(file)) this.redraw([file])
  }

  isMarked(file: string): boolean {
    return this.marked.has(file)
  }

  /** Promise of the group being decided, for tests. */
  settled: Promise<void> = Promise.resolve()

  /**
   * Decides a group: a file written outside the protocol is one that differs from what we know of
   * it. The watcher reports saves too, late, and may report several writes as one.
   */
  private settle(): Promise<void> {
    const files = this.group
    this.group = []
    this.settled = (async () => {
      const changed: string[] = []
      for (const file of files) {
        const text = await this.read(file)
        if (text === undefined || text === this.known.get(file)) continue
        changed.push(file)
        if (!this.marked.has(file)) {
          this.marked.add(file)
          this.redraw([file])
        }
      }
      if (changed.length > 0) this.report(changed)
    })()
    return this.settled
  }
}

/** Folders whose files change by the hundred, from git or a package manager: not marked. */
const UNWATCHED = new Set([".git", "node_modules"])

/** Whether a change to `file` is marked: it is in one of `folders`, and not under an unwatched folder. */
export function watched(file: string, folders: readonly string[]): boolean {
  const inside = folders.map((f) => ({ folder: f, path: withinFolder(f, file) })).find((f) => f.path !== undefined)
  if (!inside?.path) return false
  const parts = inside.path.slice(inside.folder.length).split(/[\\/]/)
  return !parts.some((p) => UNWATCHED.has(p))
}
