// Checks the Pair panel against Google's HTML/CSS Style Guide (#132): the page, rendered from
// panelHtml.ts, with html-validate (.htmlvalidate.json) and the W3C's Nu Html Checker (vnu), and the
// stylesheet with vnu. `npm run lint:web` runs it after Stylelint.

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "esbuild"
import { FileSystemConfigLoader, formatterFactory, HtmlValidate } from "html-validate/node"

const TEMPLATE = "packages/vscode/src/panelHtml.ts"
const STYLESHEET = "packages/vscode/src/webview/panel.css"
const VNU_JAR = "node_modules/vnu-jar/build/dist/vnu.jar"
const PRETTIER_CONFIG = ".prettierrc.json"
/** The webview's `cspSource`, and the origin its resources load from, as VS Code gives them. */
const CSP_SOURCE = "https://*.vscode-cdn.net"
const RESOURCE_ORIGIN = "https://file.vscode-resource.vscode-cdn.net"
/** vnu's CSS check rejects a gradient as a `mask`, which CSS Masking allows: a validator bug. */
const VNU_CSS_BUG = ".*mask.*radial-gradient.*"

/** The page as `panelHtml` renders it, from the TypeScript source, bundled to a temporary module. */
async function renderPage() {
  const dir = mkdtempSync(join(tmpdir(), "lint-web-"))
  try {
    const outfile = join(dir, "panelHtml.mjs")
    await build({ entryPoints: [TEMPLATE], bundle: true, platform: "node", format: "esm", outfile, logLevel: "warning" })
    const { panelHtml } = await import(pathToFileURL(outfile).href)
    return panelHtml(CSP_SOURCE, `${RESOURCE_ORIGIN}/dist/panel.css`, `${RESOURCE_ORIGIN}/dist/panel.js`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Runs vnu on `args`, warnings counted as errors, and prints what it reports; returns whether it passed. */
function vnu(args, input) {
  const result = spawnSync("java", ["-jar", VNU_JAR, "--Werror", "--format", "gnu", ...args], { input, encoding: "utf8" })
  if (result.error) throw result.error
  process.stderr.write(result.stderr)
  return result.status === 0
}

/** The lines of `file` past Prettier's print width, which Prettier can't wrap inside a template literal. */
function longLines(file) {
  const { printWidth } = JSON.parse(readFileSync(PRETTIER_CONFIG, "utf8"))
  const lines = readFileSync(file, "utf8").split("\n")
  return lines.flatMap((line, i) => (line.length > printWidth ? [`${file}:${i + 1}: over ${printWidth} columns`] : []))
}

const page = await renderPage()
const report = await new HtmlValidate(new FileSystemConfigLoader()).validateString(page, "panel.html")
if (!report.valid) process.stderr.write(formatterFactory("text")(report.results))
const pageValid = vnu(["-"], page)
const stylesheetValid = vnu(["--css", "--filterpattern", VNU_CSS_BUG, STYLESHEET])
const long = longLines(TEMPLATE)
for (const line of long) console.error(line)
if (!report.valid || !pageValid || !stylesheetValid || long.length > 0) process.exitCode = 1
