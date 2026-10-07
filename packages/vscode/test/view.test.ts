// Follow mode's arithmetic and own-edit matching, from editor.ts, without VS Code (#7).

import { describe, expect, it } from "vitest"
import { comfortable, glideTop, isOwnEdit, landing, row, viewport } from "../src/view"

describe("row", () => {
  // Lines 10 to 19 visible, with 13 to 16 folded away: 10-12 and 17-19.
  const folded = [
    { start: 10, end: 12 },
    { start: 17, end: 19 },
  ]

  it("counts the visible lines above a line in view, not the folded ones", () => {
    expect(row(folded, 10)).toBe(0)
    expect(row(folded, 12)).toBe(2)
    expect(row(folded, 17)).toBe(3)
    expect(row(folded, 19)).toBe(5)
  })

  it("puts a folded line where its fold is", () => {
    expect(row(folded, 14)).toBe(3)
  })

  it("is negative above the view, and the visible lines or more below it", () => {
    expect(row(folded, 7)).toBe(-3)
    expect(row(folded, 20)).toBe(6)
    expect(row(folded, 25)).toBe(11)
  })
})

describe("comfortable", () => {
  it("is out of the top and bottom quarters of the view", () => {
    expect([3, 4, 11, 12].map((at) => comfortable(at, 16))).toEqual([false, true, true, false])
  })
})

describe("landing", () => {
  it("puts the line a third of the way down", () => {
    expect(landing(100, 30, 1000, true)).toBe(90)
  })

  it("stops at the top of the document", () => {
    expect(landing(5, 30, 1000, true)).toBe(0)
  })

  it("stops with the last line at the top when the editor scrolls beyond the end, else at the bottom", () => {
    expect(landing(999, 30, 1000, true)).toBe(989)
    expect(landing(999, 30, 1000, false)).toBe(970)
    expect(landing(10, 30, 20, false)).toBe(0)
  })
})

describe("viewport", () => {
  it("measures the view's height where it doesn't reach the end", () => {
    expect(viewport([{ start: 40, end: 69 }], 1000, undefined)).toEqual({ top: 40, rows: 30, atEnd: false, height: 30 })
  })

  it("takes the height last seen at the document's end, where the view stops short", () => {
    expect(viewport([{ start: 990, end: 999 }], 1000, 30)).toEqual({ top: 990, rows: 10, atEnd: true, height: 30 })
    expect(viewport([{ start: 990, end: 999 }], 1000, undefined)).toEqual({ top: 990, rows: 10, atEnd: true, height: undefined })
  })

  it("has none without visible ranges", () => {
    expect(viewport([], 1000, 30)).toBeUndefined()
  })
})

describe("glideTop", () => {
  it("goes from start to end, faster at first", () => {
    expect([0, 0.5, 1].map((t) => glideTop(0, 80, t))).toEqual([0, 70, 80])
    expect(glideTop(80, 0, 0.5)).toBe(10)
  })
})

describe("isOwnEdit", () => {
  const own = { offset: 3, deleteLength: 1, text: "x" }

  it("matches a single change that is exactly the pending edit", () => {
    expect(isOwnEdit([{ ...own }], own)).toBe(true)
  })

  it("doesn't match another change, more changes, or no pending edit", () => {
    expect(isOwnEdit([{ ...own, text: "y" }], own)).toBe(false)
    expect(isOwnEdit([own, { offset: 0, deleteLength: 0, text: "a" }], own)).toBe(false)
    expect(isOwnEdit([own], undefined)).toBe(false)
    expect(isOwnEdit([], own)).toBe(false)
  })
})
