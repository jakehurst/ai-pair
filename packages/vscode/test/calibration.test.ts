// The reading speed calibration (#109, specs/Calibration.tla): the flow against a fake host.

import { expect, it } from "vitest"
import { Calibration, wordsPerMinute, type CalibrationView } from "../src/calibration"

const noop = (): void => {}

function setup() {
  const views: CalibrationView[] = []
  const calls: string[] = []
  const clock = { now: 0 }
  let release: () => void = noop
  const stored = () => new Promise<void>((resolve) => void (release = resolve))
  const host = {
    now: () => clock.now,
    pause: () => void calls.push("pause"),
    resume: () => void calls.push("resume"),
    store: (msPerChar: number) => {
      calls.push(`store ${msPerChar}`)
      return stored()
    },
    show: (view: CalibrationView) => void views.push(view),
  }
  const calibration = new Calibration(host, { title: "Sample", text: "one two three four", notice: "free" })
  return { calibration, views, calls, clock, release: () => release() }
}

it("measures the rate from go to x over the passage's characters, and holds the pause until the rate is stored", async () => {
  const { calibration, views, calls, clock, release } = setup()
  expect(calibration.arm()).toBe(true)
  expect(views).toEqual([{ phase: "armed", title: "Sample" }])
  clock.now = 1000
  expect(calibration.reply("go")).toBe(true)
  expect(views[1]).toEqual({ phase: "reading", title: "Sample", text: "one two three four", notice: "free" })
  clock.now = 1000 + 18 * 25
  expect(calibration.reply("x")).toBe(true)
  expect(calls).toEqual(["pause", "store 25"])
  release()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls).toEqual(["pause", "store 25", "resume"])
  expect(views[2]).toEqual({ phase: "done", msPerChar: 25, wordsPerMinute: 533 })
})

it("refuses a second passage while one is under way", () => {
  const { calibration, views } = setup()
  calibration.arm()
  expect(calibration.arm({ title: "Other", text: "x y" })).toBe(false)
  calibration.reply("go")
  expect(views[1]).toMatchObject({ phase: "reading", title: "Sample" })
})

it("refuses a passage with nothing to read", () => {
  const { calibration, calls } = setup()
  expect(calibration.arm({ title: "Blank", text: " \n " })).toBe(false)
  expect(calls).toEqual([])
})

it("cancels on any other reply, with nothing stored", () => {
  const { calibration, views, calls } = setup()
  calibration.arm()
  expect(calibration.reply("hello")).toBe(true)
  expect(calls).toEqual(["pause", "resume"])
  expect(views.at(-1)).toEqual({ phase: "idle" })
  expect(calibration.reply("go")).toBe(false)
})

it("rounds words per minute", () => {
  expect(wordsPerMinute("a b c d", 1000)).toBe(240)
})
