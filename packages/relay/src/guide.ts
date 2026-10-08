// Rules the programmer and the agent decided in earlier sessions, read when a session starts, so
// they needn't be repeated (#23): `~/.ai-pair/GUIDE.md` for every project, and `.ai-pair/GUIDE.md`
// in the project, from the workspace folder down to the agent's working directory.

import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

/** A project's guide, in a directory. */
export const GUIDE_FILE = path.join(".ai-pair", "GUIDE.md")

/** The most of one file read into the agent's instructions; the rest is cut, with a note. */
export const MAX_GUIDE = 20_000

/**
 * Whether git ignores `file`, by the project's `.gitignore` files. A file checked in is never
 * ignored, and outside a git repository nothing is (`git check-ignore` exits 0 for ignored, 1 for
 * not, 128 outside a repository).
 */
export function gitIgnores(file: string): boolean {
  return spawnSync("git", ["check-ignore", "-q", file], { cwd: path.dirname(file), stdio: "ignore" }).status === 0
}

/**
 * The project guides from `root` down to `cwd`, outer first, that git doesn't ignore: walking up
 * from `cwd`, it stops once it has looked in `root`, so none above the workspace folder is read
 * (specs/ProjectGuide.tla).
 */
export function projectGuides(cwd: string, root: string, ignored = gitIgnores): string[] {
  const found: string[] = []
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    const file = path.join(dir, GUIDE_FILE)
    if (fs.existsSync(file) && !ignored(file)) found.push(file)
    // A `root` that doesn't contain `cwd` stops at the file system's root instead.
    if (dir === root || path.dirname(dir) === dir) break
  }
  return found.toReversed()
}

export type Guide = { file: string; text: string }

/** The guides to read: the user's, then the project's, outer first. A file that can't be read is left out. */
export function readGuides(home: string, cwd: string, root: string): Guide[] {
  const files = [path.join(home, "GUIDE.md"), ...projectGuides(cwd, root)]
  const guides: Guide[] = []
  for (const file of files) {
    let text: string
    try {
      text = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    if (text.trim() === "") continue
    guides.push({
      file,
      text:
        text.length > MAX_GUIDE
          ? `${text.slice(0, MAX_GUIDE)}\n\n[Cut: the file goes on for ${text.length - MAX_GUIDE} more characters.]`
          : text,
    })
  }
  return guides
}

/** The guides as the agent reads them after the pairing guide. `show`: how to name a file. */
export function renderGuides(guides: Guide[], show: (file: string) => string): string {
  const intro =
    "Rules decided with the programmer in earlier sessions. Where they differ from the pairing guide, they take precedence, and a later file takes precedence over an earlier one."
  return [`# Project rules\n\n${intro}`, ...guides.map((g) => `## From ${show(g.file)}\n\n${g.text.trim()}`)].join("\n\n")
}
