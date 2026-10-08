// The passage read for the reading speed calibration (#109). Comma Gets a Cure, by Douglas N.
// Honorof, Jill McCullough and Barbara Somerville, 2000: a passage written for speech work, whose
// notice allows any use provided the notice goes with it. The programmer, or the agent through
// `calibrate`, can supply another; its license is theirs to settle, since it never ships.

import * as fs from "node:fs"
import * as path from "node:path"

export type Passage = {
  title: string
  text: string
  /** Shown with the passage, outside the timed text: a license notice, or where it is from. */
  notice?: string
}

/** The built-in passage, from the extension's media folder: data files, so no source file holds the text. */
export function builtInPassage(extensionPath: string): Passage {
  const read = (name: string) => fs.readFileSync(path.join(extensionPath, "media", name), "utf8").trim()
  return { title: "Comma Gets a Cure", text: read("comma-gets-a-cure.txt"), notice: read("comma-gets-a-cure-notice.txt") }
}
