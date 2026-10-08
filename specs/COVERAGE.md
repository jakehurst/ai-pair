# What the specs cover

Every source file under `packages/*/src`, function by function: the spec that models it, or why it has none (#19). The specs themselves are in [README.md](README.md).

Code goes without a spec for one of these reasons:

| Reason | What it means | What checks it instead |
|---|---|---|
| Pure | A function of its arguments, no state or concurrency | Unit tests; exhaustive tests where a spec's `ASSUME`s state the contract |
| Format | Text or markup built from values | Unit tests, and `render.fields.test.ts` for reports |
| Glue | Wiring: registering, constructing, passing a call through | The integration test, which runs it in VS Code |
| Look | How the panel or the editor draws things, with no effect on what the agent or the programmer is told | Page tests (`packages/vscode/test/*.test.ts`) |
| Types | Declarations and re-exports, no code | `tsc` |

## core

### `controller.ts`

| Functions | Spec |
|---|---|
| `step`, `listen`, `block`, `finishCall`, `ready`, `pump`, `update` | `Serialize`, `Controller` |
| `snapshot`, `restore`, `withCursor`, `end`, `endSession`, `close` | `Controller`; `snapshot`'s edit events: `EditEvents` |
| `rehearse`, `rejectBatch`, `planned`, `saw`, `read` | `Rehearsal` |
| `cursorAnchor`, `rejectUnanchored`, `anchorNeeded` in `step` and `snapshot` | `Anchor` |
| `interrupt`, `discard`, `interrupting`, `userInterrupt`, `userMessage` | `Controller` (`Programmer`), `Actions` (`Interrupt`) |
| `userEdit` | `EditorAdapter`, `Navigator` (the programmer's turn), `Rehearsal` (`Other`) |
| `otherEdit`, `recordEdit` | `Reload`, `Rehearsal`, `EditEvents` |
| `takeTurn`, `handBack`, `turn` | `Turns` |
| `pause`, `resume`, `isPaused` | `Timeline`; `resume`'s `reveal`: `Scroll` |
| `kick`, `run`, `startHead` | `Controller` (`Play`), `Turns` (`Begin`) |
| `confirm`, `decideRun` | `RunBox` (`Decided`) |
| `start`, `disconnect` | `Bridge`, `Resume` |
| `resumeSession`, `open`, `saved`, `revive`, `isSuspended`, `onChange` | `Resume` |
| `textOrMissing` | `FileText` (`MissingFile`) |
| `state`, `render`, `cursorView` | Format: what the editor and panel draw |
| `excerpt`, `ref`, `displayPath`, `resolvePath`, `requireSession`, `activeSession`, `isActive` | Pure |
| `setSpeed`, `setTiming`, `setConfirmCommands` | Glue: settings |
| `calibrate`, `onCalibrate`, `resolveFile` | `Calibration` (`Supply`); the file read: Glue |

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
| `code`, `clearPoint`, `render`, `displayPath`, `resolvePath`, `agentPath`, `config`, `speed` | Pure, Format |

### The rest of core

| File | Functions | Spec |
|---|---|---|
| `bridge.ts` | `start`, `accept`, `dispatch`, `dispose` | `Bridge` |
| | `writeDiscovery`, `focused`, `file` | `Discovery` |
| | `tokenMatches` | Pure: compares tokens in constant time |
| | `optionalNumber`, `optionalString`, `optionalStrings` | Pure: argument checks |
| | `describe`, `reported` | Format: trace lines |
| `lines.ts` | `applyChange`, `apply` | `LineIdentity` |
| | `fork`, `forget`, `adopt`, `fresh`, `of`, `editor`, `version`, `newlines` | `Rehearsal` |
| `rehearsal.ts` | `rehearse`, the in-memory editor | `Rehearsal` (`Submit`) |
| | `followChange` | `Rehearsal` (`Other`, `ShareIds`) |
| `timeline.ts` | all | `Timeline` |
| `places.ts` | `resolveSpot`, `resolveSpan`, and their helpers | `Places` |
| `typing.ts` | `planTyping`, `isIndent` | `Typing` |
| | `readingTime` | Pure |
| `diff.ts` | `lineChanges` | `Reload` (`Refine`) |
| | `fileDiff` | Format |
| `text.ts`, `timing.ts` | all | Pure |
| `ports.ts`, `config.ts`, `paths.ts`, `index.ts` | | Types |

## relay

| File | Functions | Spec |
|---|---|---|
| `link.ts` | `call`, `connect`, `open`, `openWindow`, `handBack`, `close`, `locate` | `Wire` |
| | `findWindows`, `alive`, `isDiscovery` | `Discovery` |
| | `workspace`, `contains`, `realpath` | Pure |
| `guide.ts` | `projectGuides` | `ProjectGuide` |
| | `gitIgnores`, `readGuides` | Glue: git and the file system |
| | `renderGuides` | Format |
| `server.ts` | `createServer`, `agentGuide`, `startPrompt`, `shownPath` | Glue: registers the tools, each a call through `link.ts` |
| `tools.ts` | `action`, `actionError`, `combined` | Pure: the tools' schemas; `validation.test.ts` holds them to the player's checks |
| `render.ts` | all | Format; `render.fields.test.ts` |
| `main.ts` | `main` | Glue |
| `md.d.ts` | | Types |

## protocol

| File | Functions | Spec |
|---|---|---|
| `wire.ts` | `parseFrame`, `parseEditorMessage`, `parseRelayMessage` | `Wire` (`Garbage`) |
| | `aiPairHome`, `discoveryDir` | Pure |
| `index.ts` | `actionKinds` and the `*Problem` checks | Pure; `validation.test.ts` |
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
| | the `draft` and `reply` messages, `onDidDispose` | `Draft` |
| | `receive`'s other messages, `send` | Glue: each calls one controller function |
| | `openByName`, `openChange` | Glue: opens a file or its diff; `seen` for `Outside` |
| | `resolveWebviewView`, `reveal`, `focusReply`, `showSelection`, `showSpeed` | Glue |
| | the `reply` message while a calibration runs, `showCalibration`, cancel on dispose and session end | `Calibration` |
| `webview/panel.ts` | `setNow`, `add`, `addYou`, `addRun`, `addDivider`, `addOutside`, `fileCurrent`, `entry` | `Panel` |
| | `syncDraft`, `takeDraft` | `Draft` |
| | `handle`'s `run` case, `clearRun`, `setOutcome`, `setActive` | `RunBox`; `setActive` and replaying: `PanelReplay` |
| | `setState`, `syncStatus`, `arrive`, `startReading`, `syncReading`, `tick`, the tips, the speed menu, `syncAttach`, `takeAttach` | Look |
| | `showCalibration` | Look |
| | `esc`, `codeLink`, `refLink` | Format |
| `outside.ts`, `outsideWatch.ts` | all | `Outside` |
| `terminal.ts` | all | `Terminals` |
| `view.ts` | `comfortable`, `landing`, `glideTop` | Pure; `Scroll` models `comfortable` and `landing` |
| | `row`, `viewport`, `isOwnEdit` | Pure |
| `output.ts` | `outcomeOf`, `push` | Pure: a command's output, cut to size |
| `agents.ts` | all | Pure, Glue: agents' config files; `setup.properties.test.ts` |
| `setup.ts` | all | Glue |
| `extension.ts` | saving the session and the panel's history, and reviving them | `Resume` (`Save`, `Reload`) |
| | the calibration's host: `store` applies the timing before it resolves | `Calibration` (`Stored`) |
| | the rest | Glue |
| `demo.ts` | all | Glue: plays a script through the controller's public calls |
| `calibration.ts` | all | `Calibration` |
| `passage.ts` | `builtInPassage` | Glue: reads the passage's media files |
| `panelHtml.ts` | `panelHtml`, `settingSpeed` | Format |
| `panelMessages.ts` | | Types |
