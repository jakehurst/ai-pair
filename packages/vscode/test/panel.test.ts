// The panel's page markup. Its script is a module of its own (webview/panel.ts, #6), run in a DOM
// by the other panel tests.

import { expect, it } from "vitest"
import { panelHtml, SPEEDS } from "../src/panelHtml"

it("loads its script from the file it is given, with the page's nonce, and has no inline script", () => {
  const html = panelHtml("vscode-resource:", "https://file.vscode-resource/dist/panel.js")
  const nonce = /script-src 'nonce-([^']+)'/.exec(html)![1]
  expect([...html.matchAll(/<script[^>]*>/g)].map((m) => m[0])).toEqual([
    `<script nonce="${nonce}" src="https://file.vscode-resource/dist/panel.js">`,
  ])
  expect(html).toMatch(/<script[^>]*><\/script>/)
})

it("offers the speeds with one decimal, so they line up", () => {
  const html = panelHtml("vscode-resource:", "panel.js")
  for (const s of SPEEDS) expect(html).toContain(`data-speed="${s}">${s.toFixed(1)}×</button>`)
})

it("gives controls the panel's own tooltips, since native ones show unreliably in a webview", () => {
  const html = panelHtml("vscode-resource:", "panel.js")
  expect(html).not.toMatch(/\stitle=|\.title = /)
  expect(html).toContain('data-tip="Interrupt"')
})
