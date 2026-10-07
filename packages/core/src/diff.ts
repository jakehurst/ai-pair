import { createPatch, diffLines } from "diff"
import type { Change } from "./ports"

/** A unified diff of the change, hunks only (the file is named in the event). */
export function fileDiff(file: string, before: string, after: string): string {
  const patch = createPatch(file, before, after, undefined, undefined, { context: 2 })
  const firstHunk = patch.indexOf("\n@@")
  return firstHunk === -1 ? "" : patch.slice(firstHunk + 1).trimEnd()
}

/**
 * Splits each change into one per run of changed lines, leaving the same text. VS Code reloads a
 * file changed on disk with one change from the first line that differs to the last, so the
 * unchanged lines between them would lose their identities, and positions on them would move (#65).
 * `changes` apply in order, each to the result of the previous, and so do the ones returned.
 */
export function lineChanges(before: string, changes: Change[]): Change[] {
  const split: Change[] = []
  let text = before
  for (const change of changes) {
    const removed = text.slice(change.offset, change.offset + change.deleteLength)
    // Left to right, each at its offset in the text the ones before it leave.
    let at = change.offset
    let hunk: Change | undefined
    for (const part of diffLines(removed, change.text)) {
      if (!part.added && !part.removed) {
        if (hunk) split.push(hunk)
        hunk = undefined
        at += part.value.length
        continue
      }
      hunk ??= { offset: at, deleteLength: 0, text: "" }
      if (part.removed) hunk.deleteLength += part.value.length
      else {
        hunk.text += part.value
        at += part.value.length
      }
    }
    if (hunk) split.push(hunk)
    text = text.slice(0, change.offset) + change.text + text.slice(change.offset + change.deleteLength)
  }
  return split
}
