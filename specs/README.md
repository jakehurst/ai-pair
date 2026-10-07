# TLA+ specs

Models of the code's state machines, checked with TLC (issue #19). Run them all with:

```sh
specs/check.sh            # TLC=<command> to use another TLC; default `tlc`
```

`check.sh` runs TLC on every `.cfg`. A config is named after its spec. `Spec.cfg` models the code as it is on `main`, and has to pass. `Spec_<commit>[_<issue>].cfg` models the code at that commit, before a fix, and has to find a violation: it is how each spec was validated, by reproducing a known bug.

## Results

| Config | Bounds | Result | Distinct states (when found, for a violation) |
|---|---|---|---|
| `Serialize.cfg` | `N = 2` calls | holds | 163 |
| `Serialize_57ac07f.cfg` | same | L2 `CancelReleases` violated (#1) | 199 |
| `Wire.cfg` | `S = 2` sockets, `C = 2` calls | holds | 2,100 |
| `Wire_57ac07f_3.cfg` | same | S8 `OwnCloseOnly` violated (#3) | 264 |
| `Wire_57ac07f_4.cfg` | same | S9 `RelayStaysUp` violated (#4) | 6 |
| `Wire_57ac07f_29.cfg` | same | `NoReportLost` violated (#29) | 120 |
| `Panel.cfg` | `N = 5` events | holds | 21 |
| `Panel_57ac07f.cfg` | same | S13 `NewestFirst` violated (#18) | 10 |
| `Controller.cfg` | `B = 2` batches, `E = 1` event, `MaxCancels = 1` | holds | 1,488 |
| `Controller_57ac07f.cfg` | same | S1 `BatchesDelivered` violated (#28) | 1,533 |
| `Discovery.cfg` | `W = 2` windows, one junk file | holds | 146 |
| `Discovery_57ac07f_31.cfg` | same | `NoInternal` violated (#31) | 4 |
| `EditorAdapter.cfg` | `N = 5` changes | holds | 311 |
| `EditorAdapter_57ac07f_40.cfg` | `N = 3` changes | S12 `RightAuthor` violated (#40) | 25 |
| `Bridge.cfg` | `S = 2` sockets | holds | 64 |
| `Bridge_57ac07f_42.cfg` | same | S5 `OwnedByOpenSocket` violated (#42) | 17 |
| `Timeline.cfg` | `N = 3` sleeps | holds | 88 |
| `Player.cfg` | `Edits = 2` | holds | 26 |
| `Player_57ac07f_49.cfg` | same | S11 `DeletesTheSelection` violated (#49) | 12 |
| `LineIdentity.cfg` | texts up to 4 characters, inserts up to 2 | holds (checked as `ASSUME`s) | |
| `Places.cfg` | texts up to 5 characters, needles up to 3 | holds (`ASSUME`s) | |
| `Typing.cfg` | texts up to 7 characters | holds (`ASSUME`s) | |

`Controller.tla` also passes at `B = 3, MaxCancels = 2` (14,699 states) and `B = 3, E = 2, MaxCancels = 3` (91,414 states).

Each violation's trace was checked against the code step by step before it was reported. The traces are in the issues.

## Specs and the code they model

### `Serialize`: the chain of tool calls

`packages/core/src/controller.ts`. A constant `Fixed` switches the abort check at the top of `block()` (#1).

| Spec | Code |
|---|---|
| `Guard` | `serialize`: `guarded` checks `signal.aborted` once the call before has settled |
| `Rehearsed` | `step`: `await this.rehearse(...)`, the batch pushed onto the queue, then `block()` |
| `Abort` | the `AbortSignal` firing; its listener in `block()` runs only if attached, and checks `this.call === call` |
| `Play` | the player finishing batches in queue order |
| `Ready`, `Timeout`, `Commit` | `finishCall` from `ready()` or the `maxBlockMs` timer; clears `this.call` |
| `Resolve` | `withCursor(...).then(call.resolve)`: the report handed back after the commit |

### `Wire`: the relay's side of the WebSocket

`packages/relay/src/link.ts`, with the editor's replies from `packages/core/src/bridge.ts`. Constants: `PerSocket` (#3), `GuardedParse` (#4, #30), `CheckAbort` (#29).

| Spec | Code |
|---|---|
| `Open`, `Welcome` | `connect()` → `open()` → `openWindow()`, one attempt at a time; `welcome` sets `this.ws` |
| `Request`, `Abort` | the agent's tool call reaching `call()`, which awaits `connect()`; the agent cancelling |
| `Send` | `call()` registering the call in its socket's map and sending it |
| `Close`, `Closed` | `locate()` closing `this.ws`, or the editor's end closing; the `close` handler rejecting `Victims` |
| `Reply` | a `result` frame: `result`, or `return` for a call the relay marked cancelled |
| `Garbage` | a frame that isn't a message (`parseEditorMessage`) |

### `Panel`: the history

`packages/vscode/src/panelHtml.ts`. `Fix = 1` is the code since #18.

| Spec | Code |
|---|---|
| `Say` | `setNow` |
| `Entry` | `addYou`, `addRun`, the interrupt and turn dividers: `add()` |
| `Edge` | the `session` event, start and end |
| `band`, `flag`, `Flushed` | `current`, `filed`, `fileCurrent()` |

### `Controller`: what reaches the agent

`packages/core/src/controller.ts`, with `return` in `link.ts`. `RestoreRejected` is the fix for #28.

| Spec | Code |
|---|---|
| `Submit`, `Listen` | `step` with a batch; `listen` |
| `RehearseFails`, `RehearseOk` | `reject()`; the batch queued, or discarded when `stale`, then `block()` |
| `Play`, `Finish` | `run()` |
| `Programmer` | an interrupting event: `interrupt()` discards what is queued and sets `stale` |
| `Commit` | `finishCall` → `snapshot`, which also hands out one `held` rejection |
| `Cancel` | the agent cancelling a call |
| `Answer`, `Bounce`, `Restore` | the report reaching the agent; the relay's `return`; `restore()` |

### `Discovery`: finding a window

`writeDiscovery` and `dispose` in `bridge.ts`, `findWindows` and `open` in `link.ts`. `CheckFiles` is the fix for #31.

| Spec | Code |
|---|---|
| `OpenW`, `CloseW`, `Crash`, `Reuse` | a window writing its file; `dispose()` removing it; a crash leaving it; its `pid` reused |
| `Start` | `locate` → `findWindows`: files that hold a `Discovery` with a live `pid` |
| `Try` | `openWindow` on one candidate, best first |
| `Disconnect` | the socket closing, so the next call opens again |

### `EditorAdapter`: who made a change

`edit`, `save`, `onChange`, and `byProgrammer` in `packages/vscode/src/editor.ts`, which call the controller's `userEdit` or `otherEdit`. `FlushBeforeSave` is the fix for #40. VS Code delivers a change event before the call that made it resolves, and replies after the events sent before them: one channel, in order.

| Spec | Code |
|---|---|
| `AgentEdit`, `AgentResolved` | `edit()`: the entry in `own`, VS Code applying it, `finally` |
| `Programmer` | a keystroke: its change event is queued for the extension host |
| `SaveStart`, `Participant`, `ParticipantsDone`, `SaveDone` | `save()`: the round trip, `saving`, the save participants (format on save), the write |
| `Handle` | `onChange`: the agent's own edit, or `byProgrammer` |

A keystroke made while the save participants run can't be told from their edits, since VS Code doesn't say who made a change. The spec allows that one wrong attribution by name (`"programmer during save"`).

### `Bridge`: who drives the session

`dispatch` and the socket's `close` handler in `packages/core/src/bridge.ts`, with the controller's session. `CheckOpen` is the fix for #42.

| Spec | Code |
|---|---|
| `BeginStart`, `FinishStart` | `dispatch("start")`: refused while another socket's session is active; `controller.start()`; `this.owner = ws` |
| `Close` | the `close` handler: aborts the socket's calls, and `disconnect()` if it owns the session |
| `EndSession`, `Closed` | the programmer ending the session from the panel; its last report closing it |

### `Timeline`: pausing

`packages/core/src/timeline.ts`, with the pause reasons in `Controller.pause` and `Controller.resume`, and where they come from: the Pause button, the reply box's draft, sending a reply, and the turn button (`panel.ts`), and looking away (`editor.ts`). No validation config: no known bug was in this code.

| Spec | Code |
|---|---|
| `Sleep`, `Fire` | `sleep(ms)` and its timer |
| `Pause`, `Resume` | `Controller.pause(reason)` with `Timeline.pause()`; `Controller.resume(reason)`, or with no reason all of them, then `Timeline.resume()` |
| `Interrupt`, `Reset` | `interrupt()`; `reset()` for the next batch |

A pause lasts until a resume, as PROTOCOL.md says: looking back at the code doesn't end the `away` pause, and the agent isn't told about pauses.

### `Player`: a delete while the programmer edits

The `delete` action in `packages/core/src/player.ts`, between its awaits, while the programmer types in front of the selection or behind it. `ReadAfterAwait` and `CheckInterrupt` are the fix for #49.

| Spec | Code |
|---|---|
| `Begin`, `Finish` | the delete: before #49 it copied the selection, then awaited `show` and `getText` |
| `TypeBefore`, `TypeAfter` | a programmer's edit: `transform` moves the live selection, and the edit interrupts |

### Pure functions: `LineIdentity`, `Places`, `Typing`

These have no state or concurrency, so each spec is a model of the function and `ASSUME`s that TLC checks over every small input. Each also has an exhaustive test that checks the same properties on the code itself, so the model and the code are held to one contract.

| Spec | Code | Contract | Test |
|---|---|---|---|
| `LineIdentity` | `applyChange` in `core/src/lines.ts` | one identity per line, none named twice; lines outside the change keep theirs; a line break at the end of a line keeps it in place, at its start moves it down | `core/test/lines.exhaustive.test.ts` |
| `Places` | `resolveSpot`, `resolveSpan` in `core/src/places.ts` | a spot or span resolves exactly when one match is on its line, and lies there; a range ends at the first `through` after `from` | `core/test/places.exhaustive.test.ts` |
| `Typing` | `planTyping` in `core/src/typing.ts` | the chunks concatenate to the text; each is one character, a line break with its indentation, or the leading indentation | `core/test/typing.exhaustive.test.ts` |

### Contracts checked by tests: `ActionValidation`, `Render`, `AgentSetup`

These three contracts from #19 are about what the code accepts or writes, not about states, so they are tests on the code, not TLA+.

| Contract | Test |
|---|---|
| The relay's schema and the player's checks accept the same actions (#45) | `relay/test/validation.test.ts`: 68 actions through both |
| Every field of a `Report` appears in its rendered text | `relay/test/render.fields.test.ts` |
| Setting up an agent changes only its `pair` entry, and twice equals once | `vscode/test/setup.properties.test.ts`: TOML and JSON configs |

## Keeping specs and code in step

Nothing ties a spec to its code but the tables above. When code in one of the files above changes, update its spec, and run `specs/check.sh`.
