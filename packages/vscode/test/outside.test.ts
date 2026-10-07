// Marking files changed outside the protocol, as specs/Outside.tla has it (#15): when a group of
// watcher events settles, a file is marked only if it differs from the text we know of it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GROUP_MS, OutsideChanges, watched } from "../src/outside"

let disk: Map<string, string>
let reports: string[][]
let redraws: string[][]
let outside: OutsideChanges

beforeEach(() => {
  vi.useFakeTimers()
  disk = new Map()
  reports = []
  redraws = []
  outside = new OutsideChanges(
    async (file) => disk.get(file),
    (files) => reports.push(files),
    (files) => redraws.push(files),
  )
})
afterEach(() => {
  vi.useRealTimers()
})

/** The watcher reports `file`, after it was written with `text`. */
function written(file: string, text: string): void {
  disk.set(file, text)
  outside.reported(file)
}

async function settle(): Promise<void> {
  vi.advanceTimersByTime(GROUP_MS)
  await outside.settled
}

describe("OutsideChanges", () => {
  it("marks a file written outside once its writes settle, and reports it", async () => {
    written("/p/a.ts", "x")
    expect(outside.isMarked("/p/a.ts")).toBe(false)
    await settle()
    expect([outside.isMarked("/p/a.ts"), redraws, reports]).toEqual([true, [["/p/a.ts"]], [["/p/a.ts"]]])
  })

  it("doesn't mark a save, or a file the extension created", async () => {
    written("/p/a.ts", "saved")
    // VS Code tells of its save after the write, but before the group settles.
    outside.saved("/p/a.ts", "saved")
    outside.saved("/p/new.ts", "")
    written("/p/new.ts", "")
    await settle()
    expect([outside.isMarked("/p/a.ts"), outside.isMarked("/p/new.ts"), reports]).toEqual([false, false, []])
  })

  it("marks a write the watcher reports in one event with a save (the afterSave rule misses it)", async () => {
    outside.saved("/p/a.ts", "saved")
    written("/p/a.ts", "written outside after the save")
    await settle()
    expect(outside.isMarked("/p/a.ts")).toBe(true)
  })

  it("clears the mark when the programmer sees the file, and a late event for what they saw doesn't bring it back", async () => {
    written("/p/a.ts", "x")
    await settle()
    outside.seen("/p/a.ts", "x")
    expect([outside.isMarked("/p/a.ts"), redraws]).toEqual([false, [["/p/a.ts"], ["/p/a.ts"]]])
    outside.reported("/p/a.ts")
    await settle()
    expect(outside.isMarked("/p/a.ts")).toBe(false)
  })

  it("groups files written close together into one entry, and skips one gone again", async () => {
    written("/p/a.ts", "1")
    vi.advanceTimersByTime(GROUP_MS - 1)
    written("/p/b.ts", "2")
    outside.reported("/p/gone.ts")
    written("/p/a.ts", "3")
    await settle()
    expect(reports).toEqual([["/p/a.ts", "/p/b.ts"]])
  })
})

describe("watched", () => {
  it("watches files in a workspace folder, not under .git or node_modules", () => {
    expect(watched("/p/src/a.ts", ["/p"])).toBe(true)
    expect(watched("/p/.git/index", ["/p"])).toBe(false)
    expect(watched("/p/node_modules/x/index.js", ["/p"])).toBe(false)
    expect(watched("/q/a.ts", ["/p"])).toBe(false)
    expect(watched("/q/a.ts", ["/p", "/q"])).toBe(true)
  })
})
