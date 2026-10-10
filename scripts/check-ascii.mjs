// Checks that every file git tracks is ASCII, except for the characters ALLOWED names for a file (#116).
// Code spells a character it needs as an escape, markup as an entity, and prose as a word.
//
//   npm run check:ascii

import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const SKIPPED = /^(package-lock\.json|.*\.(png|gif))$/

const ASCII_DELETE = 0x7f // the last ASCII code point

// The characters ALLOWED names, by their Unicode names.
const CURSOR_MARKER = 0x258c // LEFT HALF BLOCK
const BOX_DOWN_RIGHT = 0x250c
const BOX_DOWN_LEFT = 0x2510
const BOX_UP_RIGHT = 0x2514
const BOX_UP_LEFT = 0x2518
const BOX_HORIZONTAL = 0x2500
const BOX_VERTICAL = 0x2502
const RIGHT_TRIANGLE = 0x25b6 // BLACK RIGHT-POINTING TRIANGLE
const S_CARON = 0x0160 // LATIN CAPITAL LETTER S WITH CARON
const EM_DASH = 0x2014

/** The characters a file may hold beyond ASCII, as code points, with why. */
const ALLOWED = {
  // The cursor marker, shown to the agent as it types it.
  "AGENT_GUIDE.md": [CURSOR_MARKER],
  "PROTOCOL.md": [CURSOR_MARKER],
  // The components diagram's box drawing.
  "ARCHITECTURE.md": [BOX_DOWN_RIGHT, BOX_DOWN_LEFT, BOX_UP_RIGHT, BOX_UP_LEFT, BOX_HORIZONTAL, BOX_VERTICAL, RIGHT_TRIANGLE],
  // The upstream author's name.
  LICENSE: [S_CARON],
  // The dash before the quote's source, and the diagram's line and arrowhead.
  "README.md": [EM_DASH, BOX_HORIZONTAL, RIGHT_TRIANGLE],
  "packages/vscode/README.md": [EM_DASH],
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0")
const files = tracked.filter((file) => file && !SKIPPED.test(file) && fs.existsSync(path.join(ROOT, file)))

let found = 0
for (const file of files) {
  const allowed = new Set(ALLOWED[file] ?? [])
  const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n")
  lines.forEach((line, i) => {
    let column = 0
    for (const char of line) {
      column++
      const code = char.codePointAt(0)
      if (code > ASCII_DELETE && !allowed.has(code)) {
        console.error(`${file}:${i + 1}:${column}: U+${code.toString(16).toUpperCase().padStart(4, "0")}`)
        found++
      }
    }
  })
}

if (found > 0) {
  console.error(`\n${found} characters outside ASCII. Write each as an escape in code, an entity in markup, or a word in prose.`)
  process.exit(1)
}
console.log(`${files.length} files: ASCII, apart from what ALLOWED names.`)
