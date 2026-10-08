// The guides `start` reads (#23, specs/ProjectGuide.tla): the user's, then every project guide from
// the workspace folder down to the working directory, outer first, never one above the folder.

import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { GUIDE_FILE, MAX_GUIDE, projectGuides, readGuides, renderGuides } from "../src/guide"

let top: string
beforeEach(() => {
  top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ai-pair-guide-")))
})
afterEach(() => {
  fs.rmSync(top, { recursive: true, force: true })
})

/** A guide in `dir`, under the test's folder. */
function guide(dir: string, text: string): string {
  const file = path.join(top, dir, GUIDE_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

it("reads the guides from the workspace folder down to the working directory, outer first", () => {
  guide("", "above the folder")
  const outer = guide("ws", "outer")
  guide("ws/other", "off the path")
  const inner = guide("ws/app/src", "inner")
  fs.mkdirSync(path.join(top, "ws/app/src/deep"), { recursive: true })
  expect(projectGuides(path.join(top, "ws/app/src/deep"), path.join(top, "ws"))).toEqual([outer, inner])
  expect(projectGuides(path.join(top, "ws"), path.join(top, "ws"))).toEqual([outer])
})

it("leaves out a guide git ignores, and keeps one checked in though .gitignore names it", () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: path.join(top, "ws"), stdio: "ignore" })
  const outer = guide("ws", "outer")
  guide("ws/app", "ignored")
  const tracked = guide("ws/app/src", "checked in")
  fs.writeFileSync(path.join(top, "ws/.gitignore"), "app/.ai-pair/\napp/src/.ai-pair/\n")
  git("init", "-q")
  git("add", "-f", path.join("app/src", GUIDE_FILE))
  expect(projectGuides(path.join(top, "ws/app/src"), path.join(top, "ws"))).toEqual([outer, tracked])
})

it("puts the user's guide first, skips empty ones, and cuts a long one with a note", () => {
  const home = path.join(top, "home")
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(home, "GUIDE.md"), "everywhere")
  guide("ws", "   \n")
  guide("ws/app", "x".repeat(MAX_GUIDE + 5))
  const guides = readGuides(home, path.join(top, "ws/app"), path.join(top, "ws"))
  expect(guides.map((g) => path.relative(top, g.file))).toEqual(["home/GUIDE.md", path.join("ws/app", GUIDE_FILE)])
  expect(guides[1]!.text).toMatch(/\[Cut: the file goes on for 5 more characters\.\]$/)
})

it("renders them after an introduction that says which takes precedence", () => {
  const text = renderGuides(
    [
      { file: "/home/GUIDE.md", text: "a\n" },
      { file: "/ws/.ai-pair/GUIDE.md", text: "b" },
    ],
    (f) => f,
  )
  expect(text).toBe(
    "# Project rules\n\nRules decided with the programmer in earlier sessions. Where they differ from the pairing guide, they take precedence, and a later file takes precedence over an earlier one.\n\n## From /home/GUIDE.md\n\na\n\n## From /ws/.ai-pair/GUIDE.md\n\nb",
  )
})
