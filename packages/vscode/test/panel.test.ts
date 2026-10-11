// @vitest-environment happy-dom
// The panel's page markup. Its script is a module of its own (webview/panel.ts, #6), run in a DOM
// by the other panel tests.

import { expect, it } from "vitest"
import type { Window } from "happy-dom"
import { SPEED_SUFFIX } from "@ai-pair/core/constants"
import { panelHtml, SPEEDS } from "../src/panelHtml"

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window } = globalThis as unknown as { window: Window }

it("loads its script from the file it is given, with the page's nonce, and has no inline script", () => {
  const html = panelHtml("vscode-resource:", "https://file.vscode-resource/dist/panel.css", "https://file.vscode-resource/dist/panel.js")
  const page = new window.DOMParser().parseFromString(html, "text/html")
  const csp = page.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute("content")!
  const scripts = [...page.querySelectorAll("script")]
  expect(scripts).toHaveLength(1)
  expect(csp).toContain(`script-src 'nonce-${scripts[0]!.getAttribute("nonce")}'`)
  expect(scripts[0]!.getAttribute("src")).toBe("https://file.vscode-resource/dist/panel.js")
  expect(scripts[0]!.textContent).toBe("")
})

it("loads its styles from the file it is given, and allows no inline style", () => {
  const html = panelHtml("vscode-resource:", "https://file.vscode-resource/dist/panel.css", "panel.js")
  const page = new window.DOMParser().parseFromString(html, "text/html")
  const csp = page.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute("content")!
  expect(csp).toContain("style-src vscode-resource:;")
  expect(csp).not.toContain("unsafe-inline")
  const links = [...page.querySelectorAll('link[rel="stylesheet"]')]
  expect(links.map((l) => l.getAttribute("href"))).toEqual(["https://file.vscode-resource/dist/panel.css"])
  expect(page.querySelectorAll("style")).toHaveLength(0)
})

it("offers the speeds with one decimal, so they line up", () => {
  const html = panelHtml("vscode-resource:", "panel.css", "panel.js")
  for (const s of SPEEDS) expect(html).toContain(`data-speed="${s}">${s.toFixed(1)}${SPEED_SUFFIX}</button>`)
})

it("offers the same speeds for reading, in a menu of its own", () => {
  const html = panelHtml("vscode-resource:", "panel.css", "panel.js")
  const page = new window.DOMParser().parseFromString(html, "text/html")
  expect(page.querySelectorAll("#reading-menu [data-speed]")).toHaveLength(SPEEDS.length)
})

it("gives controls the panel's own tooltips, since native ones show unreliably in a webview", () => {
  const html = panelHtml("vscode-resource:", "panel.css", "panel.js")
  expect(html).not.toMatch(/\stitle=|\.title = /)
  expect(html).toContain('data-tip="Interrupt"')
})
