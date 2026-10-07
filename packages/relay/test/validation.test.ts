// The relay's schema and the player's own checks accept the same actions (ActionValidation in #19):
// every action below goes through both, and they must agree on whether it's malformed.

import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { Action } from "@ai-pair/protocol"
import { setup, until } from "../../core/test/fake"
import { TOOLS } from "../src/tools"

const M = "\u{258c}"
const places = {
  move: [{ to: "line_end" }, { line: 1, to: "line_end" }, { line: 1, at: `x${M}` }, { at: "x" }, { at: `${M}${M}` }, { line: 0, to: "line_end" },
    { line: 1.5, to: "line_end" }, { to: "start" }, { at: `x${M}`, to: "line_end" }, {}, { before: "x" }, { to: "line_end", extra: 1 }, { line: "1", to: "line_end" }],
  span: [{ text: "x" }, { line: 1, text: "x" }, { from: "x", through: "y" }, { from: "x" }, { text: "" }, { text: "x", from: "x", through: "y" }, {},
    { near_line: 1, text: "x" }, { to: "y", from: "x" }, { text: 5 }, { text: "x", extra: 1 }, { line: -1, text: "x" }],
  type: [`x${M}`, "x", `${M}${M}`, 5, [`x${M}`], ""],
}

const actions: unknown[] = [
  ...places.move.map((move) => ({ move })),
  ...places.span.map((select) => ({ select })),
  ...places.span.map((point) => ({ point })),
  ...places.type.map((type) => ({ type })),
  ...places.type.map((type_fast) => ({ type_fast })),
  { delete: true }, { delete: false }, { delete: 1 },
  { say: "hi" }, { say: "" }, { say: 3 },
  { run: "true" }, { run: "true", wait: 5 }, { run: "true", wait: -1 }, { run: "true", wait: "5" }, { run: 3 },
  { say: "a", extra: 1 }, { run: "true", extra: 1 }, { delete: true, extra: 1 },
  { say: "a", type: `b${M}` }, { foo: 1 }, {}, "say", null,
]

const schema = z.object(TOOLS.step.inputSchema)

/** Whether the player rejects the action as malformed, played after a move that gives it a cursor and a selection. */
async function playerRejects(action: unknown): Promise<string | undefined> {
  vi.useFakeTimers()
  try {
    const { controller } = setup({ "a.ts": "xy\nx\n" })
    await controller.start()
    await controller.read("a.ts")
    const prefix: Action[] = [{ move: { file: "a.ts", line: 1, to: "line_end" } }, { select: { line: 1, text: "x" } }]
    // The player is reached from the bridge, which checks only that `actions` is an array: these
    // actions are malformed on purpose.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const report = await until(controller.step([...prefix, action as Action]))
    const r = report.rejected
    return r && r.index === 3 && r.error.kind === "invalid_action" ? r.error.message : undefined
  } finally {
    vi.useRealTimers()
  }
}

describe("action validation", () => {
  for (const action of actions) {
    it(`agrees on ${JSON.stringify(action)}`, async () => {
      const relay = schema.safeParse({ actions: [action] }).success
      const player = await playerRejects(action)
      expect({ relayAccepts: relay, playerRejects: player !== undefined, player }).toMatchObject({ relayAccepts: player === undefined })
    })
  }
})
