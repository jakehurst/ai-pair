// Tests for scripts/lint-tla.mjs (#148): a fake spec that follows the guide passes, and each rule fires on a fake spec
// that breaks that rule alone.

import { expect, it } from "vitest"
import { checkConfig, checkModule } from "./lint-tla.mjs"

const COLUMN_LIMIT = 80
const FOOTER = "=".repeat(COLUMN_LIMIT)
const SEPARATOR = "-".repeat(COLUMN_LIMIT)

/** A module that follows every rule the checker checks. */
const MODULE = [
  "---- MODULE Fake ".padEnd(COLUMN_LIMIT, "-"),
  "\\* A fake module for the checker's tests.",
  "EXTENDS Naturals",
  "",
  "CONSTANTS",
  "    MaxCount    \\* how far it counts",
  "",
  "VARIABLES",
  "    count    \\* how far it has counted",
  "",
  "vars == <<count>>",
  "",
  SEPARATOR,
  "",
  "TypeOK == count \\in 0..MaxCount",
  "",
  "Init == count = 0",
  "",
  "Next == count' = count + 1",
  "",
  "Spec == Init /\\ [][Next]_vars",
  "",
  FOOTER,
  "",
].join("\n")

/** A config for MODULE that follows every rule the checker checks. */
const CONFIG = [
  "\\* Fake model: counts to 2. Expected to pass.",
  "",
  "SPECIFICATION Spec",
  "",
  "CONSTANTS",
  "    MaxCount = 2",
  "",
  "INVARIANTS",
  "    TypeOK",
  "",
  "\\* Counting stops at MaxCount, by design.",
  "CHECK_DEADLOCK FALSE",
  "",
].join("\n")

/** `text` with `from` replaced by `to`; throws if `from` is not in it, so a case cannot pass by changing nothing. */
function edit(text, from, to) {
  if (!text.includes(from)) throw new Error(`not in the fake spec: ${from}`)
  return text.replace(from, to)
}

/** The guide sections that `problems` cite, in order. */
function rules(problems) {
  return problems.map((problem) => problem.rule)
}

it("reports nothing for a module and a config that follow the guide", () => {
  expect(checkModule("Fake", MODULE)).toEqual([])
  expect(checkConfig(CONFIG, true)).toEqual([])
})

/** For each rule, the section, the break, and a change to MODULE that breaks that rule alone. */
const MODULE_CASES = [
  ["3.2", "a header with three dashes first", "---- MODULE Fake -", "--- MODULE Fake --"],
  ["3.10", "a short footer", FOOTER, "===="],
  ["2.2", "no newline at the end", `${FOOTER}\n`, FOOTER],
  ["4.1", "a tab", "    count", "\tcount"],
  ["4.2", "a line over the column limit", "how far it counts", "how far it counts".padEnd(COLUMN_LIMIT, ".")],
  ["7.1", "no space after a comment's start", "\\* how far it counts", "\\*how far it counts"],
  ["3.4, 3.6", "the singular CONSTANT", "CONSTANTS", "CONSTANT"],
  ["4.4", "no space after ==", "Init == count", "Init ==count"],
  ["4.6", "a short separator", SEPARATOR, "----"],
  ["4.6", "two blank lines in a row", "\nInit ==", "\n\nInit =="],
  ["3.6", "a second VARIABLES block", "vars == <<count>>", "vars == <<count, other>>\n\nVARIABLES\n    other    \\* another count"],
  ["3.6", "a vars tuple missing a variable", "vars == <<count>>", "vars == <<>>"],
  ["6.1", "no TypeOK", "TypeOK ==", "TypeInvariant =="],
]

it.each(MODULE_CASES)("reports %s for %s in a module", (rule, _description, from, to) => {
  expect(rules(checkModule("Fake", edit(MODULE, from, to)))).toEqual([rule])
})

/** For each rule, the section, the break, and a change to CONFIG that breaks that rule alone. */
const CONFIG_CASES = [
  ["8.2", "no leading comment", "\\* Fake model: counts to 2. Expected to pass.\n", ""],
  ["8.1", "no blank line before a keyword", "\n\nCONSTANTS", "\nCONSTANTS"],
  [
    "8.1",
    "CONSTANTS before SPECIFICATION",
    "SPECIFICATION Spec\n\nCONSTANTS\n    MaxCount = 2",
    "CONSTANTS\n    MaxCount = 2\n\nSPECIFICATION Spec",
  ],
  ["8.3, 8.4, 8.5", "INIT for SPECIFICATION", "SPECIFICATION Spec", "INIT Init"],
  ["8.3, 8.4, 8.5", "the singular INVARIANT", "INVARIANTS\n", "INVARIANT\n"],
  ["8.4, 8.5", "an entry indented 2 spaces", "    MaxCount = 2", "  MaxCount = 2"],
  ["8.4, 8.5", "an entry on the keyword's line", "INVARIANTS\n    TypeOK", "INVARIANTS TypeOK"],
  ["8.5", "two names on one line", "    TypeOK", "    TypeOK Counted"],
  ["7.2, 8.6", "the deadlock check off with no reason", "\\* Counting stops at MaxCount, by design.\n", ""],
  ["6.1, 8.5", "TypeOK not the first invariant", "    TypeOK", "    Counted\n    TypeOK"],
  ["4.2", "a line over the column limit", "Expected to pass.", "Expected to pass.".padEnd(COLUMN_LIMIT, ".")],
]

it.each(CONFIG_CASES)("reports %s for %s in a config", (rule, _description, from, to) => {
  expect(rules(checkConfig(edit(CONFIG, from, to), true))).toEqual([rule])
})

it("does not ask for TypeOK in a config for a module with no variables", () => {
  expect(checkConfig(edit(CONFIG, "    TypeOK", "    Counted"), false)).toEqual([])
})
