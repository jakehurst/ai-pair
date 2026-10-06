# Adding the gate and the lock to ai-pair

How code-review-driven development (the gate, the lock, the record) fits into
ai-pair's existing code with the fewest new concepts. Companion to
`code-review-driven-development.md`. Line references are to ai-pair at commit
`0defe98` (2026-10-05).

Status: draft, written from reading the source, not from running it.

## Summary

Four additions, each attached to a seam that already exists:

| Addition | Existing seam it uses |
|---|---|
| Block boundary | The batch. A batch already ends with a report and the controller already decides what plays next in `Controller.run`. |
| The gate | The `confirm` mechanism for `run`: playback already knows how to stop and wait for a panel decision. |
| Reject as revert | `Playing.span` already tracks the text a batch changed and keeps it in place through later edits. Edits go through `EditorPort.edit` with undo stops. |
| The lock | The rehearsal pass. A batch is already played in memory before queuing and rejected with `line_not_seen` when it targets a line the agent has not seen. `locked` is the same check on a different predicate. |

Nothing is removed. With the feature off (a setting, like `confirmCommands`),
behavior is byte-for-byte today's.

## Vocabulary, mapped to code

| CRDD term | In ai-pair |
|---|---|
| block | one or more consecutive batches; a new `Block` record in `Session` |
| on the table | `Session.gate` is set: the block has played and awaits a decision |
| accept | `Controller.decideBlock(id, "accept")` |
| amend | existing: `userEdit` or `userMessage` while `gate` is set |
| reject | `Controller.decideBlock(id, "reject", reason?)`: reverts the block's spans |
| redirect | existing: `userMessage` plus implicit reject of the open block |
| locked | `Session.locks`: accepted spans the rehearsal refuses to edit |
| unlock | `Controller.unlockBlock(id)`: removes the lock, reopens the block on the table |
| the record | `Session.record: BlockRecord[]`, surfaced in the panel history |

## 1. Block boundaries

### Agent side: a flag on `step`

Today `step` takes `actions` only. Add one optional field:

```ts
step(actions, { continues?: true, argument?: string })
```

- Default: every batch ends a block. That is the CRDD default ("every batch
  end is a proposed boundary") and it is what the AGENT_GUIDE already asks for
  ("one idea per batch").
- `continues: true`: this batch and the next belong to one block. The block
  ends at the first batch without it.
- `argument`: the agent's reasoning for the block as written, shown at the
  gate, after the code. See section 3.

In `packages/relay/src/tools.ts` the `step` schema gains the two fields; the
wire `call` message passes them through unchanged. `Batch` in
`controller.ts` gains `continues: boolean` and `argument?: string`.

### Human side: "Block here"

A new panel control, next to Interrupt. It calls a new
`Controller.userCut()`:

```ts
userCut(): void {
  const s = this.activeSession()
  if (!s || s.gate || s.scene.turn !== "agent") return
  s.events.push({ kind: "block", id: s.block.id, decision: "cut" })
  this.interrupt(s)              // existing: stops playback, discards the queue
  this.openGate(s)               // new: what has played so far is the block
}
```

It reuses `interrupt` exactly as `userInterrupt` does. The difference is only
what happens next: instead of the agent re-planning freely, the gate opens on
what is on screen. The interrupted batch's `unplayed` actions come back in
the report as they do today, so after an accept the agent can resume them.

## 2. The gate

### State

```ts
type Block = {
  id: number
  batches: number[]
  /** Per file: the text of the block's span before the block, and the span now, kept in place through edits. */
  spans: Map<string, { before: string; range: Range }>
  argument?: string
  /** Edits the programmer made inside the span while it was on the table. */
  amended: boolean
}

type Session = {
  …existing…
  /** The block being built by the playing and queued batches. */
  block: Block
  /** Set while a block is on the table. Playback holds. */
  gate?: Block
  locks: Map<string, { blockId: number; range: Range; before: string }[]>
  record: BlockRecord[]
}
```

`Range` is `{ file, start, end }` in offsets, the same representation
`Scene.cursor`, `Scene.point`, and `Playing.span` use.

### Holding playback

`Controller.run` is the loop that pulls the next batch off `s.queue`. Today,
after a batch completes, it calls `startHead(s)` and loops. Add one check:

```ts
batch.state = "done"
…
if (result.status === "completed") this.extendBlock(s, batch, result)
if (result.status === "completed" && !batch.continues && this.config.gate) {
  this.openGate(s)
  this.update()
  break                         // the loop resumes from kick() after a decision
}
this.startHead(s)
```

`openGate` moves `s.block` to `s.gate`, starts a fresh `s.block`, posts a
panel event, and renders. `kick` gains `if (s.gate) return`, so queued batches
wait. The agent is allowed to keep submitting batches while the gate is open,
exactly as it does while a batch plays: they queue, they were rehearsed
against the planned text, and they play after accept. On reject they are
discarded by the existing `interrupt`, which is already what happens when the
programmer interrupts.

### Reporting the gate to the agent

`Report` gains:

```ts
gate?: { block: number; batches: number[]; argument_shown: boolean }
```

`ready()` is unchanged for `step` with a batch: the batch is head of the
queue, so the call returns with `submitted: { status: "queued" }` and the
`gate` field. The agent then calls `step([])` or `listen` to wait. `listen`
returns when a `block` event arrives (see below). The existing 45 second
`maxBlockMs` timeout and `waiting: true` cover long gates without change.

`renderReport` in `packages/relay/src/render.ts` renders it:

> Block 7 (batches 12 to 13) is on the table. The programmer is reviewing it.
> Wait with `listen`; you may queue the next batch meanwhile, and it plays
> once they accept.

### The decision event

```ts
| { kind: "block"; id: number; decision: "accept" | "reject" | "cut" | "unlock" | "reopened"; reason?: string }
```

Amend and redirect need no event of their own: they are the existing
`message` and `edit` events, which the agent already handles, arriving while
`gate` is set. The AGENT_GUIDE tells the agent what they mean in that state.

`interrupting()` in `controller.ts` decides whether an event marks the
session stale (which discards batches planned before it). It must treat
`accept` as not interrupting, since accept is the one event after which the
planned batches are still valid:

```ts
function interrupting(e: PendingEvent): boolean {
  if (e.kind === "block") return e.decision !== "accept"
  return e.kind !== "edit" || e.by === "programmer" || e.interrupted === true
}
```

### Accept

```ts
decideBlock(id: number, decision: "accept" | "reject", reason?: string): void {
  const s = this.activeSession()
  const b = s?.gate
  if (!s || b?.id !== id) return
  s.gate = undefined
  if (decision === "accept") {
    for (const [file, span] of b.spans) this.lock(s, file, span.range, b.id, span.before)
    s.record.push({ …b, decision: "accept", at: Date.now() })
    s.events.push({ kind: "block", id, decision: "accept" })
    this.panel.post({ type: "block", id, phase: "accepted" })
    this.kick(s)                          // queued batches resume
  } else {
    void this.revert(s, b).then(() => {
      s.record.push({ …b, decision: "reject", reason, at: Date.now() })
      s.events.push({ kind: "block", id, decision: "reject", reason })
      this.panel.post({ type: "block", id, phase: "rejected" })
      this.interrupt(s)                   // existing: discards what was queued
      this.update()
    })
  }
  this.update()
}
```

### Reject as revert

`EditorPort` has no undo, and VS Code's undo stack is shared with the
programmer's own edits, so reject does not use undo. It replaces each span
the block changed with the text that was there before the block:

```ts
private async revert(s: Session, b: Block): Promise<void> {
  for (const [file, { before, range }] of b.spans) {
    await this.editor.edit(file, range.start, range.end - range.start, before,
      { undoStopBefore: true, undoStopAfter: true })
    await this.editor.save(file)
  }
}
```

Two existing pieces make this safe:

- The span is already tracked. `Playing.span` in `player.ts` records the text
  a batch changed and `Player.transform` keeps it in place through the
  programmer's edits using `mapThrough`. `extendBlock` merges each completed
  batch's span into the block's span per file (the same min/max merge
  `Player.touch` does), and the block's spans are transformed in
  `recordEdit` alongside the scene.
- `before` is captured when the block's first edit to a file lands:
  `Player.touch` is the hook, and it has the text at that moment.

Because the revert goes through `EditorPort.edit` with undo stops, the
programmer's own Cmd+Z undoes a reject. No new port method.

If the programmer edited inside the span while the block was on the table
(`amended` is true), the panel's Reject says so and asks once before
reverting, since the revert would take their edit with it.

### The panel

New band state while `gate` is set: status *Your call*, with four controls
in place of the reply box's usual position: **Accept**, **Reject**, and the
reply box labeled *Amend or redirect*. Amend and redirect are typed, as
today's replies are, or made by editing the code, as today's edits are. The
header shows "Block 7, batches 12 to 13, 2 files".

`FromPanel` in `packages/vscode/src/panel.ts` gains:

```ts
| { type: "blockDecision"; id: number; decision: "accept" | "reject"; reason?: string }
| { type: "cut" }
| { type: "unlock"; id: number }
```

`PanelEvent` in `ports.ts` gains:

```ts
| { type: "block"; id: number; phase: "open" | "accepted" | "rejected" | "reopened"
    files: string[]; argument?: string; diff?: string }
```

The webview's history already draws dividers for interrupts and turn
changes (`addDivider` in `panelHtml.ts`). A block entry is a divider with a
label and a disclosure showing the diff, using `fileDiff` from
`packages/core/src/diff.ts`, which already produces unified hunks for the
`edit` event.

Keyboard: `aiPair.acceptBlock` and `aiPair.rejectBlock` commands registered
in `extension.ts` next to `aiPair.interrupt`, so the gate can be worked
without the mouse.

## 3. The argument after the code

The `argument` field on `step` is not a `say`. A `say` plays during the batch
with a reading pause and goes into the band as the current message. The
argument is held until the gate opens, then shown in the band under the
block header, after the code is on screen. That is the ordering CRDD asks
for, and it costs nothing in playback: the gate is the pause.

The argument is also stored in `Block.argument` and goes into the record.

If `argument` is given on a batch with `continues: true`, it is kept and
shown when the block ends. If several batches of one block each give one,
the last wins; the AGENT_GUIDE says to give it once, on the last batch.

## 4. The lock

### Enforcement in rehearsal

`rehearse` in `rehearsal.ts` builds a `Player` with a `knows` predicate; the
player calls it in `unseen()` and returns `line_not_seen`. Add a second
predicate to `Stage`:

```ts
locked?(file: string, start: number, end: number): { blockId: number } | undefined
```

The controller supplies it from `s.locks`, transformed to the planned text
the same way `s.seen` is checked against the rehearsal's `LineIds`. The
player checks it at the three places that change text:

| Action | Where in `player.ts` | Check |
|---|---|---|
| `type` | `type()`, before the chunk loop | the insertion offset, or the selection being replaced |
| `delete` | the `delete` branch of `perform` | the selection |
| `select` | the `select` branch of `perform` | the resolved span, since a select precedes a replace or delete |

`move` and `point` inside a locked span stay allowed: reading and talking
about accepted code is fine.

New `ErrorKind`: `"locked"`. Message, in the style of `line_not_seen`:

> locked: lines 12 to 30 of src/todos.ts are block 7, accepted by the
> programmer. Accepted code doesn't change. If it must, say why and call
> `listen`: the programmer can unlock it.

The rehearsal fails, `Controller.reject` returns the report with `rejected`
set, and `renderRejected` already says "Nothing of it was queued." No new
rendering path.

The same check runs during real playback (the `Player` is the same class),
which covers an edit the rehearsal could not foresee, such as a lock added
by an accept that landed between rehearsal and play.

### Keeping locks in place

Locks are offset ranges per file. They are transformed through every change
in `recordEdit` (programmer and other edits) and in `Player.edit` (the
agent's), with `mapThrough`, exactly as `Scene.point` is. A lock whose range
collapses to zero length (the programmer deleted the block) is dropped and
the block is marked `reopened` in the record.

### The programmer's edits inside a lock

`recordEdit` checks each change against `s.locks` for the file. An overlap
means the programmer changed accepted code. The lock is removed, the block
goes back on the table with `amended: true`, and the agent gets
`{ kind: "block", decision: "reopened" }`. This is deliberate: the record
never claims a span is accepted when its text has changed since.

### Unlock

Panel: each accepted block in the history has an Unlock control. Controller:

```ts
unlockBlock(id: number): void {
  const s = this.activeSession()
  if (!s || s.gate) return               // one block on the table at a time
  const locks = this.removeLocks(s, id)
  s.gate = { id, batches: [], spans: locks, argument: undefined, amended: false }
  s.events.push({ kind: "block", id, decision: "unlock" })
  this.panel.post({ type: "block", id, phase: "open", … })
  this.update()
}
```

An unlocked block is on the table like a new one, with one difference: the
agent may now edit inside its span, since the lock is gone. When it is
accepted again, it gets a new lock covering its current span. The record
keeps both entries.

Asking for an unlock is a `say` and a `listen`, which the agent already
does for any question. The AGENT_GUIDE adds: "To change accepted code, say
which block and why, then `listen`."

## 5. The record

```ts
type BlockRecord = {
  id: number
  batches: number[]
  files: string[]
  diff: string                  // fileDiff per file, joined
  argument?: string
  narration: string[]           // the block's `say`s, taken from the batches
  decision: "accept" | "reject"
  reason?: string
  prior: ("amend" | "reject")[] // what happened to it before this decision
  turn: Turn
  at: number
}
```

Kept in `Session.record`, not in the panel's log, since the panel log is
capped at 400 events and replayed for rendering only.

Export: a command `aiPair.exportRecord` writes `ai-pair-record-<date>.md`
in the workspace root, one section per accepted block, with the diff in a
fence and the narration, argument, and decision under it. This is the
session's review log.

## 6. The programmer's turn

During the programmer's turn the agent is navigator and can only `say` and
`point`. The gate works the other way around:

- "That's a block" in the panel (the same Block here control, relabeled
  during the user turn) opens a gate on the programmer's edits since the
  last boundary. `userEdit` already accumulates them in `s.baselines` and
  `s.latest`, so the span and `before` text are there.
- The agent gets a `block` event with `decision: "cut"` and `turn: "user"`,
  reviews, and says its read. The report's `gate` field tells it which
  block.
- The programmer accepts or rejects their own block from the panel. Accept
  locks it against the agent's later edits, same as any block.

No new state. The gate and lock code paths are the same; only who typed the
text differs, and the record says so in `turn`.

## 7. Settings and compatibility

| Setting | Default | Effect |
|---|---|---|
| `aiPair.gate` | off | When off, no gate opens, no locks are created, `continues` and `argument` are accepted and ignored. ai-pair users see no change. |
| `aiPair.gateOnCut` | on | Whether Block here opens a gate (on) or acts like Interrupt (off). |

Protocol version 3 becomes 4. The relay and extension already reject a
version mismatch at `hello`.

## 8. Files touched

| File | Change |
|---|---|
| `packages/protocol/src/index.ts` | `Event` gains `block`; `Report` gains `gate`; `ErrorKind` gains `locked`; new `BlockRecord` |
| `packages/protocol/src/wire.ts` | `PROTOCOL_VERSION = 4` |
| `packages/core/src/controller.ts` | `Block`, `gate`, `locks`, `record` on `Session`; `openGate`, `extendBlock`, `decideBlock`, `revert`, `unlockBlock`, `userCut`; the hold in `run`; `interrupting` treats accept as not interrupting; `recordEdit` transforms spans and locks and detects reopen |
| `packages/core/src/player.ts` | `Stage.locked`; checks in `type`, `delete`, `select`; `touch` captures `before` on first edit to a file |
| `packages/core/src/rehearsal.ts` | passes `locked` through to the in-memory player |
| `packages/core/src/ports.ts` | `PanelEvent` gains `block` |
| `packages/relay/src/tools.ts` | `step` schema: `continues`, `argument` |
| `packages/relay/src/render.ts` | renders `block` events, the `gate` field, and the `locked` error |
| `packages/vscode/src/panel.ts` | `FromPanel`: `blockDecision`, `cut`, `unlock` |
| `packages/vscode/src/panelHtml.ts` | gate band state, Accept and Reject, Block here, block entries in history with diff disclosure and Unlock |
| `packages/vscode/src/extension.ts` | `aiPair.gate` setting; commands `acceptBlock`, `rejectBlock`, `cutBlock`, `exportRecord` |
| `AGENT_GUIDE.md` | a section "The gate": what to do while a block is on the table, the argument, asking to unlock |
| `PROTOCOL.md`, `DESIGN.md` | the new fields, the band state, the history entries |

Untouched: `timing.ts`, `typing.ts`, `places.ts`, `lines.ts`, `text.ts`,
`timeline.ts`, `bridge.ts`, `editor.ts`, `terminal.ts`, and the relay's
`link.ts` and `server.ts`. The whole of playback, pacing, place resolution,
line identity, follow mode, and discovery is unchanged.

## 9. Tests

The core has a fake editor (`packages/core/test/fake.ts`) and fake timers.
Each addition gets controller tests in that style:

- A batch without `continues` opens a gate; the next batch stays queued;
  `step([])` returns with `gate` set.
- `continues: true` across two batches opens one gate after the second.
- Accept resumes the queue and the next batch plays.
- Accept locks the span; a later `type` inside it is rejected at rehearsal
  with `locked`; a `move` inside it is allowed.
- Reject restores the span's text and discards the queue; the report carries
  the `block` event with the reason and the discarded batches as `unplayed`.
- Programmer edits inside the block on the table set `amended`; reject still
  reverts.
- Programmer edits inside a lock remove the lock and emit `reopened`.
- Lock ranges follow a programmer's edit above them.
- `userCut` mid-batch opens a gate on what played; `unplayed` is reported.
- `unlockBlock` reopens; a `type` inside it is now allowed; accept re-locks.
- With `aiPair.gate` off, none of the above happens and existing tests pass
  unchanged.

The VS Code integration test (`npm run test:integration`) gets one scripted
session that accepts two blocks, rejects one, and exports the record.

## 10. Order of work

1. Gate with accept only, no lock, no reject. Hold, decision event, panel
   controls. This alone changes the experience: silence is no longer consent.
2. Reject as revert.
3. The lock, in rehearsal and playback, with reopen on programmer edits.
4. Block here, and the user-turn gate.
5. The argument field and its band placement.
6. The record and its export.
7. Unlock.

Each step leaves the tool working with the feature flag on or off.

## Open questions

- **Blocks across files.** A batch works in one file, so a block spanning
  files is several batches with `continues`. Accept locks each file's span.
  Is one Accept for a multi-file block enough, or should each file's span
  be shown separately in the band before accepting?
- **Formatter on save.** ai-pair saves after each batch, and a formatter's
  change arrives as an `other` edit. A format inside an accepted span should
  not reopen the block. Treat `other` edits as transforming locks without
  reopening; only `programmer` edits reopen.
- **Lock granularity.** Offsets make a lock exact, but a block that adds a
  function and the next block that calls it will touch adjacent text.
  Insertions at the very end of a lock (offset equals `range.end`) should
  be allowed, otherwise nothing can ever be appended after an accepted
  block.
- **The agent's native tools.** ai-pair cannot stop the agent editing a
  file with its own Write tool outside the protocol. Such an edit arrives as
  `other` and is marked in the explorer today. Inside a lock, it should
  reopen the block and the history should say the agent did it outside the
  session, since the lock is only as strong as the agent's use of the pair
  tools.
