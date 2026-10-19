# What the specs cover

Every source file under `packages/*/src`, function by function: the spec that
models it, or why it has none (#19). The specs themselves are in
[README.md](README.md).

Code goes without a spec for one of these reasons:

| Reason | What it means | What checks it instead |
|---|---|---|
| Pure | A function of its arguments, no state or concurrency | Unit tests; exhaustive tests where a spec's `ASSUME`s state the contract |
| Format | Text or markup built from values | Unit tests, and `render.test.ts`'s every field test for reports |
| Glue | Wiring: registering, constructing, passing a call through | The integration test, which runs it in VS Code |
| Look | How the panel or the editor draws things, with no effect on what the agent or the programmer is told | Page tests (`packages/vscode/test/*.test.ts`) |
| Types | Declarations and re-exports, no code | `tsc` |

## core

### `controller.ts`

| Functions | Spec |
|---|---|
| `step`, `listen`, `block`, `finishCall`, `callReady`, `ready`, `pump`, `update`, `serialize` | `Serialize`, `Controller` |
| `snapshot`, `restore`, `withCursor`, `end`, `endSession`, `close` | `Controller`; `snapshot`'s edit events: `EditEvents`; a held rejection in `restore` and `snapshot`: `Anchor` (`Restore`, `Deliver`) |
| `rehearse`, `rejectBatch`, `planned`, `saw`, `read` | `Rehearsal` |
| `cursorAnchor`, `rejectUnanchored`, `anchorNeeded` in `step` and `snapshot` | `Anchor` |
| `interrupt`, `discard`, `interrupting`, `userInterrupt`, `userMessage` | `Controller` (`Interrupt`), `Actions` (`Interrupt`) |
| `userEdit` | `EditorAdapter`, `Navigator` (the programmer's turn), `Player` (`TypeBefore`, `TypeAfter`: the interrupt in the agent's turn) |
| `otherEdit`, `recordEdit` | `Reload`, `Rehearsal`, `EditEvents` |
| `takeTurn`, `handBack`, `turn` | `Turns` |
| `pause`, `resume`, `isPaused` | `Timeline`; `resume`'s `reveal`: `Scroll`, a stale point, and the reply's resume without one: `PointFocus` |
| `kick`, `run`, `startHead` | `Controller` (`Play`), `Turns` (`Begin`) |
| `confirm`, `decideRun` | `RunBox` (`Go`, `Decline`) |
| `start`, `disconnect` | `Bridge`, `Resume` |
| `resumeSession`, `open`, `saved`, `revive`, `isSuspended`, `onChange` | `Resume` |
| `textOrMissing` | `FileText` (`MissingFile`) |
| `state`, `startGrace`, `endGrace`, `startQuiet`, `endQuiet`, and the grace and the quiet in `serialize`, `read`, `block`, `finishCall`, and `close` | `ListenGrace` |
| `describeReport`, `cancelled`, `isRecorded`, `pendingEdit` | Pure, Format |
| `render`, `cursorView` | Format: what the editor and panel draw |
| `excerpt`, `ref`, `displayPath`, `resolvePath`, `requireSession`, `activeSession`, `isActive` | Pure |
| `setSpeed`, `setReadingSpeed`, `setTimeouts`, `setTiming`, `setConfirmCommands`, `glideMs` | Glue: settings; `glideMs` is `glideDuration` in `timing.ts`, a duration `Scroll` does not model |
| `calibrate`, with the bridge's `calibrate` option, `resolveFile` | `Calibration` (`Supply`); the file read: Glue |

### `player.ts`

| Functions | Spec |
|---|---|
| `play`, `actions`, `perform`, `stopped`, `failed`, `fail` | `Actions`, `Turns` |
| `names`, `fileOf` | `BatchFile` |
| `type`, `delay` | `Actions`, `Turns`; the chunks: `Typing` |
| `edit`, `transform`, `transformScene`, `mapThrough`, `touch` | `Player`, `Reload` |
| `unseen`, `locate`, `span` | `Rehearsal` (`Accept`); finding text: `Places` |
| `save`, `runCommand`, `confirm` | `RunBox`, `Actions`; the save: `EditorAdapter` |
| `follow` | `Scroll` (`Move`) |
| `code`, `codeAt`, `clearPoint`, `render`, `displayPath`, `resolvePath`, `agentPath`, `config`, `speed`, `readingSpeed` | Pure, Format |

### The rest of core

| File | Functions | Spec |
|---|---|---|
| `bridge.ts` | `start`, `accept`, `dispatch`, `dispose` | `Bridge` |
| | `connections` | Glue: what a test reads |
| | `writeDiscovery`, `focused`, `file` | `Discovery` |
| | `tokenMatches` | Pure: compares tokens in constant time |
| | `optionalNumber`, `optionalString`, `optionalStrings` | Pure: argument checks |
| | `describe`, `reported` | Format: trace lines |
| `lines.ts` | `applyChange`, `apply` | `LineIdentity` |
| | `fork`, `forget`, `adopt`, `fresh`, `of`, `editor`, `version`, `newlines` | `Rehearsal` |
| `rehearsal.ts` | `rehearse`, the in-memory editor | `Rehearsal` (`Submit`) |
| | `followChange` | `Rehearsal` (`EditAsOther`, `ShareIds`) |
| `timeline.ts` | all | `Timeline` |
| `places.ts` | `resolveSpot`, `resolveSpan`, and their helpers | `Places` |
| `typing.ts` | `planTyping`, `isIndent` | `Typing` |
| | `readingTime` | Pure |
| `diff.ts` | `lineChanges` | `Reload` (`Refine`) |
| | `fileDiff` | Format |
| `text.ts`, `timing.ts` | all | Pure |
| `ports.ts`, `config.ts`, `paths.ts`, `index.ts` | | Types; `config.ts` also holds the defaults and `TEST_TIMEOUTS` |

## relay

| File | Functions | Spec |
|---|---|---|
| `link.ts` | `call`, `connect`, `open`, `openWindow`, `handBack`, `close`, `locate` | `Wire` |
| | `findWindows`, `alive` | `Discovery` |
| | `workspace`, `contains`, `realpath` | Pure |
| | `EDITOR_DISCONNECTED`, `LINK_CLOSED` | Format |
| `guide.ts` | `projectGuides` | `ProjectGuide` |
| | `gitIgnores`, `readGuides` | Glue: git and the file system |
| | `renderGuides` | Format |
| `server.ts` | `createServer`, `agentGuide`, `startPrompt`, `shownPath` | Glue: registers the tools, each a call through `link.ts` |
| | `serve` | `Wire` (`Shutdown`) |
| `tools.ts` | `action`, `actionError`, `combined` | Pure: the tools' schemas; `validation.test.ts` holds them to the player's checks |
| `render.ts` | all | Format; `render.test.ts` |
| `main.ts` | the entry: `serve` with the process's stdio | Glue |
| `timings.ts` | `RELAY_TIMINGS` | Glue: the relay's delays, one set for tests |
| `md.d.ts` | | Types |

## protocol

| File | Functions | Spec |
|---|---|---|
| `wire.ts` | `frameJson`, `parseEditorMessage`, `parseRelayMessage` | `Wire` (`SendGarbage`) |
| | `aiPairHome`, `discoveryDir` | Pure |
| `index.ts` | `moveProblem`, `spanProblem` | `ActionValidation` |
| | `actionKinds`, `fieldsProblem`, `typeProblem` | Pure; `validation.test.ts` |
| `schemas.ts` | the schemas, and the types taken from them | Types: data declarations, which the parsers above apply (#163) |
| `paths.ts` | `samePath`, `withinFolder` | Pure |

## vscode

### `editor.ts`

| Functions | Spec |
|---|---|
| `edit`, `save`, `onChange`, `byProgrammer`, `track` | `EditorAdapter` |
| `getText`, `document`, `openDocument`, `exists`, `show`, `create`, `isDirty` | `FileText` |
| `show`, `selfNav`, `navigating`, `onActiveEditor` | `FollowMode` |
| `renderCursor`, `reveal`, `follow`, `keepInView`, `scroll`, `glide`, `onScroll` | `Scroll`; `onScroll`'s pause: `Timeline` |
| `landing`, `viewport`, `visibleEditor`, `scrollsBeyondEnd`, `revealLine`, `revealTop`, `target` | Pure, Glue: VS Code calls `Scroll` abstracts as a view's top line |
| `runCommand` | Glue: passes to `terminal.ts` |
| `onSelectionChange`, `programmerSelection`, `selectionRef` | Look: what the programmer can attach to a message |
| `redraw`, `updatePulse`, `cursorDecoration`, `labelDecoration`, `renderPoint`, `setAgentName` | Look |
| `displayPath`, `resolvePath`, `inWorkspace`, `eol`, `dispose` | Pure, Glue |

### The rest of vscode

| File | Functions | Spec |
|---|---|---|
| `panel.ts` | `post`, the `ready` message | `PanelReplay` |
| | `history`, `restoreHistory`, `onPost` | `Resume` (`Save`, `Reload`) |
| | the `draft` and `reply` messages, `onDidDispose` | `Draft`; the `reply` lifting the pause without a reveal: `PointFocus` |
| | `receive`'s other messages, `send` | Glue: each calls one controller function |
| | `openByName`, `openChange` | Glue: opens a file or its diff; `seen` for `Outside` |
| | `resolveWebviewView`, `reveal`, `focusReply`, `showSelection`, `showSpeed`, `showReadingSpeed`, `showTimings` | Glue |
| | the `reply` message while a calibration runs, `showCalibration`, cancel on dispose and session end | `Calibration` |
| | `askStart`, the `start` message, posting `startEnded` | `Start` |
| `webview/panel.ts` | `setNow`, `add`, `addYou`, `addRun`, `addDivider`, `addOutside`, `fileCurrent`, `entry` | `Panel`; the scroll position: `PanelScroll` |
| | `syncDraft`, `takeDraft` | `Draft` |
| | `handle`'s `run` case, `clearRun`, `setOutcome`, `setActive` | `RunBox`; `setActive` and replaying: `PanelReplay` |
| | `handle`'s `session` case for a suspended or resumed session | `Resume` (`ShownIsState`) |
| | `setState`, `syncStatus`, `arrive`, `startReading`, `syncReading`, `tick`, the tips, the speed menu, `syncAttach`, `takeAttach` | Look |
| | `showCalibration` | Look |
| | the `canStart` and `startEnded` messages, the Start a session button, its starting note | `Start` |
| | `esc`, `codeLink`, `refLink` | Format |
| `outside.ts`, `outside_watch.ts` | all | `Outside` |
| `terminal.ts` | all | `Terminals` |
| `view.ts` | `comfortable`, `landing`, `glideTop` | Pure; `Scroll` models `comfortable` and `landing` |
| | `row`, `viewport`, `isOwnEdit` | Pure |
| `output.ts` | `outcomeOf`, `push` | Pure: a command's output, cut to size |
| `agents.ts` | all | Pure, Glue: agents' config files; `agents.test.ts` |
| `setup.ts` | `claudeStarter` | `Start` (`Answer`, `Click`, `Exit`) |
| | the rest | Glue |
| `extension.ts` | saving the session and the panel's history, and reviving them | `Resume` (`Save`, `Reload`) |
| | the calibration's host: `store` applies the timing before it resolves | `Calibration` (`Stored`) |
| | asking the panel again after Set Up Agent | `Start` (`FlipSetUp`) |
| | the rest | Glue |
| `demo.ts` | all | Glue: plays a script through the controller's public calls |
| `calibration.ts` | all | `Calibration` |
| `passage.ts` | `builtInPassage` | Glue: reads the passage's media files |
| `timings.ts` | `setTimings` | Glue: the extension's delays, one set for tests |
| `panel_html.ts` | `panelHtml`, `settingSpeed` | Format |
| `webview/panel.css` | all | Look |
| `panel_messages.ts` | | Types |
