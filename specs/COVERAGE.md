# What the specs cover

Every source file under `packages/*/src`, function by function, and selected
test harness scripts: the spec that
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
| `step`, `listen`, `block`, `finishCall`, `callReady`, `ready`, `pump`, `update`, `serialize` | `Serialize`, `Controller`, `NavigatorCommentary` (final projection), `NavigatorFollowup`, `CommandTracking` |
| `setNavigatorCommentary` | `NavigatorCommentary` |
| `snapshot`, `restore`, `withCursor`, `end`, `endSession`, `close` | `Controller`; `close` terminal cleanup: `QuietTerminals`; `snapshot`'s edit events: `EditEvents`; a held rejection in `restore` and `snapshot`: `Anchor` (`Restore`, `TakeHeld`); command news and origin: `CommandTracking` |
| `rehearse`, `rejectBatch`, `planned`, `saw`, `read` | `Rehearsal` |
| `cursorAnchor`, `rejectUnanchored`, `anchorNeeded` in `step` and `snapshot` | `Anchor` |
| `unnamedEdit` and its preflight in `step` | `BatchFile` (`EditRequiresNamed`) |
| `selectedSpeech` and admission in `step`; pause, resume and cancellation propagation | `Narration` (`Admit`, `Pause`, `Resume`, `Reply`); reminder counting and reporting: `SpeechReminder` |
| `interrupt`, `discard`, `interrupting`, `userInterrupt`, `userMessage`, `flushDeferred` | `Controller` (`Interrupt`), `Actions` (`Interrupt`); deferred replies: `DeferredMessage` |
| `userEdit` | `EditorAdapter`, `Navigator` (the programmer's turn), `Player` (`TypeBefore`, `TypeAfter`: the interrupt in the agent's turn) |
| navigator notice generation, `finishCall` and `restore` | `Navigator`, `Attention`, `ListenGrace`; timeout retention and canceled notice redelivery: controller and scripted MCP regressions |
| `otherEdit`, `recordEdit` | `Reload`, `Rehearsal`, `EditEvents` |
| `takeTurn`, `handBack`, `turn` | `Turns` |
| `pause`, `resume`, `isPaused` | `Timeline`; `resume`'s `reveal`: `Scroll`, a stale point, and the reply's resume without one: `PointFocus` |
| `requestAttention`, `attentionBoundary`, `releaseAttention`; derived work and speech pause projections | `Attention`; renewal, reply, replay and session identity: solitary and composed tests |
| `revealCursor` | `RevealCursor`; editor navigation is delegated without changing turn or playback |
| `kick`, `run`, `startHead` | `Controller` (`Play`), `Turns` (`StartHead`); diagnostics after playback: `Diagnostics` (`Finish`) |
| `confirm`, `decideRun` | `RunBox` (`Go`, `Decline`) |
| `start`, `disconnect` | `Bridge`, `Resume` |
| `resumeSession`, `open`, `saved`, `revive`, `isSuspended`, `onChange` | `Resume` |
| `textOrMissing` | `FileText` (`MissingIsReported`) |
| `state`, `startGrace`, `endGrace`, `startQuiet`, `endQuiet`, and the grace and the quiet in `serialize`, `read`, `block`, `finishCall`, and `close` | `ListenGrace` |
| `describeReport`, `cancelled`, `isRecorded`, `pendingEdit` | Pure, Format |
| `render`, `cursorView` | Format: what the editor and panel draw |
| `excerpt`, `ref`, `displayPath`, `resolvePath`, `requireSession`, `activeSession`, `isActive` | Pure |
| `setSpeed`, `setReadingSpeed`, `setCodePlayback`, `setTimeouts`, `setTiming`, `setConfirmCommands`, `glideMs` | Glue: settings; `glideMs` is `glideDuration` in `timing.ts`, a duration `Scroll` does not model |
| `calibrate`, with the bridge's `calibrate` option, `resolveFile` | `Calibration` (`Supply`); the file read: Glue |

### `player.ts`

| Functions | Spec |
|---|---|
| `play`, `actions`, `perform`, `stopped`, `failed`, `fail` | `Actions`, `Turns`; selected say gates: `Narration`; action boundary: `DeferredMessage` |
| `currentSpeech`, attention checkpoints in `actions` and grouped `type` | `Attention`; logical voice drain and safe work admission, with composed overlap tests |
| `names`, `fileOf` | `BatchFile` |
| `type`, `delay` | `Actions`, `Turns`; atomic chunks: `Typing`; grouped chunks and reading: `CodePlayback`; final marker: `PlaybackAnchor` |
| `edit`, `transform`, `transformScene`, `mapThrough`, `touch` | `Player`, `Reload` |
| `unseen`, `locate`, `span` | `Rehearsal` (`Accept`); finding text: `Places` |
| `save`, `runCommand`, `confirm` | `RunBox`, `Actions`; the save: `EditorAdapter` |
| `follow` | `Scroll` (`Move`); the highlighted reading target: `PlaybackAnchor` |
| `code`, `codeAt`, `clearPoint`, `render`, `displayPath`, `resolvePath`, `agentPath`, `config`, `speed`, `readingSpeed` | Pure, Format |

### The rest of core

| File | Functions | Spec |
|---|---|---|
| `bridge.ts` | `start`, `accept`, `dispatch`, `dispose` | `Bridge`; typed diagnostic events: `DiagnosticsPrivacy`; nonowner requests: `DiagnosticsRequest` |
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
| `structural_typing.ts` | `structuralNewline`, `isCode` | `StructuralTyping` abstracts context categories; concrete lexical scanning is checked by unit tests |
| `typing.ts` | `planTyping`, `isIndent` | `Typing` |
| | `groupTyping` | `CodePlayback` (abstract bounded groups); concrete line and whitespace preferences: Pure |
| | `readingTime` | Pure |
| `diff.ts` | `lineChanges` | `Reload` (`SplitRuns`) |
| | `fileDiff` | Format |
| `speech_reminder.ts` | batch count, due check and report reset | `SpeechReminder` (`Batch`, `Report`) |
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
| `index.ts` | `moveProblem`, `spanProblem`, `speechProblem` | `ActionValidation` |
| | `actionKinds`, `fieldsProblem`, `typeProblem` | Pure; `validation.test.ts` |
| `schemas.ts` | the schemas, and the types taken from them | Types: data declarations, which the parsers above apply (#163) |
| `paths.ts` | `samePath`, `withinFolder` | Pure |
| `local_audio.ts` | local-audio bridge schemas | Types; validated at boundaries |
| `diagnostics.ts` | strict snapshot and audio schemas | `DiagnosticsRequest` (`Allowlist`); concrete bounds checked by unit tests |
| `panel_chunks.ts` | bounded ordered local panel replay assembly | `LocalPanelReplay`; transport tests |

## audio-native

| File | Functions | Spec |
|---|---|---|
| `admission.ts` | logical route reservation and cancellation | `LocalAudioAdmission`; native device integration pending |
| `ownership.ts` | job ownership and retirement | `LocalAudioOwnership`; process integration tests pending |
| `playback.ts` | player lifecycle | `LocalAudioOwnership`, `MultipartAudioLease`; process integration tests pending |
| `protocol.ts` | helper event framing and sequence checks | `LocalAudioOwnership`; protocol unit tests |
| `index.ts` | adapter contracts | Types |
| `helper_location.ts` | helper path resolution | Glue; helper-location unit tests |

## audio-ui

| File | Functions | Spec |
|---|---|---|
| `local_connection.ts` | ordered frames and local lease | `LocalAudioOwnership`; physical retirement integration pending |
| `companion_session.ts`, `speech_host.ts` | readiness query and host facts | `SpeechReminder` abstracts readiness; concrete local checks: unit and integration tests |
| `speech_host.ts` | restored output discovery and disposal | `OutputPreference` (`Init`), `OutputDiscoveryLifecycle` (`Complete`); solitary and fake-adapter composed tests |
| `companion_output.ts` | page and job ownership | `LocalAudioAdmission`, `LocalAudioOwnership`, `MultipartAudioLease`; native integration pending |

## vscode

### `editor.ts`

| Functions | Spec |
|---|---|
| `edit`, `save`, `onChange`, `byProgrammer`, `track` | `EditorAdapter` |
| `renderCursor` outside-file interest and `programmerCursor` | `EditorAdapter` host eligibility assumption; actual native event through real adapter and controller: `navigator_editor.e2e.test.ts` |
| `diagnostics` | `Diagnostics`: advisory observations; stale source and provider availability are checked in the adapter |
| `getText`, `document`, `openDocument`, `exists`, `show`, `create`, `isDirty` | `FileText` |
| `show`, `selfNav`, `navigating`, `onActiveEditor` | `FollowMode` |
| `renderCursor`, `reveal`, `follow`, `keepInView`, `scroll`, `glide`, `onScroll` | `Scroll`; `onScroll`'s pause: `Timeline` |
| `revealCursor` | `RevealCursor`; asynchronous cursor identity and VS Code rejection: solitary adapter tests |
| `landing`, `viewport`, `visibleEditor`, `scrollsBeyondEnd`, `revealLine`, `revealTop`, `target` | Pure, Glue: VS Code calls `Scroll` abstracts as a view's top line |
| `runCommand`, `showTerminal`, `cleanupIdleTerminals` | Glue: pass to `terminal.ts`; `QuietTerminals`, `TerminalReuse` |
| `onSelectionChange`, `programmerSelection`, `selectionRef` | Look: what the programmer can attach to a message |
| `redraw`, `updatePulse`, `cursorDecoration`, `labelDecoration`, `renderPoint`, `setAgentName` | Look |
| `displayPath`, `resolvePath`, `inWorkspace`, `eol`, `dispose` | Pure, Glue |

### The rest of vscode

| File | Functions | Spec |
|---|---|---|
| `panel.ts` | `post`, the `ready` message | `PanelReplay` |
| | `history`, `restoreHistory`, `onPost` | `Resume` (`Store`, `ReloadWindow`) |
| | the `draft` and `reply` messages, `onDidDispose` | `Draft`; the `reply` lifting the pause without a reveal: `PointFocus`; deferred reply: `DeferredMessage` |
| | mode preference messages | `PlaybackPreference` (`Choose`, `Reload`) |
| | speech delivery and page lifecycle | `SpeechPage`; `Narration` |
| | `receive` diagnostics-copy message | `DiagnosticsCopy` (`Click`) |
| | `showTerminalPreference`, `receive` terminal messages | `TerminalPanel` (`SetAuto`, `Show`) |
| | `receive`'s other messages, `send` | Glue: each calls one controller function |
| | `openByName`, `openChange` | Glue: opens a file or its diff; `seen` for `Outside` |
| | `resolveWebviewView`, `reveal`, `focusReply`, `showSelection`, `showSpeed`, `showReadingSpeed`, `showTimings` | Glue |
| | the `reply` message while a calibration runs, `showCalibration`, cancel on dispose and session end | `Calibration` |
| | `askStart`, the `start` message, posting `startEnded` | `Start` |
| `extension.ts` | effective speech preferences, queued writes and key reset | `ProviderChoice` (`Select`, `Success`, `Failure`, `External`, `KeyChange`) |
| `extension.ts` | required narration cue forwarding and owner-ready generation gate | `RemoteCue` abstracts dispatch and retirement; actual activation adapter unit tests and `attention_audio_composed.e2e.test.ts` cover separate wiring and transport/output seams |
| `speech_setup.ts` | model status check | `ModelStatus` |
| `speech_credentials.ts` | key prompt, storage and invalidation | `SpeechSettings` |
| `speech_catalog.ts` | explicit catalog requests and invalidation | `SpeechSettings` |
| `webview/speech_audio.ts` | page, unit, audio and controls | `SpeechPage` |
| `voice_indicator.ts` | cached voice readiness projection | `VoiceIndicator` (`Observe`) |
| `webview/panel.ts` | toolbar voice status and settings focus | `VoiceIndicator` (`Observe`) |
| | `speedMenu` menu open and close transitions | `PanelMenus` (`Open`, `Close`) |
| | toolbar and Settings mode choice | `PlaybackPreference` (`Choose`, `SetPace`) |
| | diagnostics-copy button | `DiagnosticsCopy` (`Click`) |
| | `setNow`, `add`, `addYou`, `addRun`, `addDivider`, `addOutside`, `fileCurrent`, `entry` | `Panel`; the scroll position: `PanelScroll` |
| | `syncDraft`, `takeDraft` | `Draft`; deferred send: `DeferredMessage` |
| | `handle`'s `run` case, `clearRun`, `setOutcome`, `setActive` | `RunBox`; `setActive` and replaying: `PanelReplay` |
| | terminal setting and reveal controls | `TerminalPanel` (`SetAuto`, `Show`) |
| | `handle`'s `session` case for a suspended or resumed session | `Resume` (`ShownIsState`) |
| | `setState`, `syncStatus`, `statusText`, `arrive`, `startReading`, `syncReading`, `tick`, the tips, `syncAttach`, `takeAttach` | Look: status text gives actual pauses precedence while retaining confirmation or turn context |
| | `showCalibration` | Look |
| | the `canStart` and `startEnded` messages, the Start a session button, its starting note | `Start` |
| | `esc`, `codeLink`, `refLink` | Format |
| `speech_elevenlabs.ts` | cloud transport | `CloudNarration` |
| `speech_pcm.ts` | bounded PCM conversion and thinking interval | Pure; unit and integration tests |
| `speech_service.ts` | worker, audio and page lifecycle; pause, cancel, timeouts | `Narration`, `SpeechWorker`, `WarmSynthesisWorker`, `SpeechTempo`, `SentencePipeline`, `CloudNarration`, `OutputAdmission`, `OutputHandoff`; timer bounds and local platform checks: unit and integration tests |
| `speech_service.ts` | `attentionCue` and fixed waveform cache admission, invalidation and completion | `AttentionCache`; concrete settings, context exclusion, route and tempo reuse: solitary service tests |
| `remote_narration.ts`, companion `companion_narration.ts` | attention cue job and terminal acknowledgement | `RemoteCue`; connection, job and page identity: transport and companion tests; physical output leases retain their existing models |
| `speech_readiness.ts` | provider, settings and output readiness checks | `SpeechReminder` abstracts readiness; concrete checks: unit and integration tests |
| `speech_native_output.ts` | discovery and native process lifecycle | `AudioOutput`; isolated PipeWire integration and unit tests |
| `speech_output_router.ts` | route reservation and playback ownership | `AudioOutput`, `OutputAdmission`, `OutputHandoff`, `OutputReplacement` |
| `speech_output_types.ts` | route and device types | Types |
| `speech_output_preferences.ts` | selection, discovery and ordered persistence | `OutputPreference` |
| `speech_synthesis.ts`, `speech_waveform.ts` | complete-token and waveform bounds | `ActionValidation` (`TokenBounds`, `PhonemeCoverage`); PCM encoding: Pure |
| `speech_segments.ts` | sentence planning with exact source ranges | `SentencePipeline`; unit tests |
| `speech_tempo.ts`, `speech_tempo_pcm.ts` | pitch-preserving time stretch and PCM framing | `SpeechTempo` (ownership, bounds, tail); the signal processing itself: unit tests and synthetic signals, not listening quality |
| `speech_tempo_client.ts`, `speech_tempo_messages.ts`, `speech_tempo_worker.ts`, `speech_tempo_worker_host.ts` | tempo worker ownership, messages and bootstrap | `SpeechTempo`; unit and real-worker tests |
| `speech_engine.ts` | `loadSpeechEngine` | Glue: loads the local model, tokenizer and phonemizer; offline worker integration |
| `speech_gpu_setup_flow.ts`, `speech_gpu_model.ts` | preflight, download and atomic GPU cache installation | `GpuSetup`, `SpeechSetup`; unit and temporary-files integration tests |
| `speech_gpu_driver_identity.ts`, `speech_gpu_elf.ts` | mapped ICD classification and identity | `GpuMappedIcd`, `GpuSetup`; unit and native proof tests |
| `speech_gpu_slot.ts`, `speech_gpu_proof_runner.ts`, `speech_gpu_proof_worker.ts`, `speech_gpu_options.ts` | shared child lease, proof and retirement | `GpuProcessSlot`, `GpuSetup`; unit and native proof tests |
| `speech_service.ts`, `speech_local_client.ts` | planned backend handoff after the previous worker exits | `SpeechBackendHandoff`; unit and composed worker tests |
| `speech_gpu_client.ts`, `speech_gpu_transport.ts`, `speech_gpu_ipc.ts` | verified launch, bounded IPC, cancel, process retirement | `GpuSynthesisProcess`; unit, real-child integration, and Electron-to-bundled Node JSON waveform fixture (`integration_gpu_process.ts`) |
| `speech_gpu_worker.ts`, `speech_gpu_worker_runtime.ts`, `speech_gpu_worker_host.ts` | isolated IPC, loader proof and disposal | `GpuSynthesisProcess`; unit and composed tests |
| `speech_gpu_verified_engine.ts`, `speech_gpu_engine.ts`, `speech_gpu_phonemizer_bridge.ts` | verified GPU engine and offline phonemizer | `GpuSynthesisProcess`; pinned assets, model format and audio fidelity: unit and hardware tests |
| `speech_local_client.ts` | worker epoch, ownership, cancellation and retirement until exit | `WarmSynthesisWorker`; unit and composed tests |
| `speech_worker_host.ts`, `speech_worker.ts` | worker admission, validation and dispatch | `WarmSynthesisWorker`; worker isolation and concrete messages: unit and integration tests |
| `speech_local_protocol.ts`, `speech_types.ts` | schemas and settings types | Types; validated at boundaries |
| `outside.ts`, `outside_watch.ts` | all | `Outside` |
| `terminal.ts` | all | `Terminals`, `QuietTerminals`, `TerminalReuse`, `CommandTracking`, `CommandEncoding`, `ShellIdentity`; typed diagnostic events: `DiagnosticsPrivacy` |
| `view.ts` | `comfortable`, `landing`, `glideTop` | Pure; `Scroll` models `comfortable` and `landing` |
| `python_diagnostics.ts` | `pythonDiagnostic` | `Diagnostics`: bounded advisory check, with Python parsing source on stdin |
| | `row`, `viewport`, `isOwnEdit` | Pure |
| `output.ts` | `outcomeOf`, `push` | `CommandTracking` (completion observation); pure output tail conversion |
| `diagnostics.ts` | all | `DiagnosticsPrivacy`: bounded allowlisted event history, speech-only events and independent snapshots |
| `diagnostics_collector.ts` | all | `DiagnosticsRequest` (`Complete`): bounded, independently validated companion reads |
| `agents.ts` | all | Pure, Glue: agents' config files; `agents.test.ts` |
| `setup.ts` | `claudeStarter` | `Start` (`AnswerCheck`, `Click`, `AgentExits`) |
| | the rest | Glue |
| `extension.ts` | legacy restored output discovery | `OutputPreference` (`Init`); ownership-gated startup unit tests |
| | diagnostic snapshot wiring | `DiagnosticsRequest` (`Complete`); unit tests cover observed local audio facts |
| | saving the session and the panel's history, and reviving them | `Resume` (`Store`, `ReloadWindow`) |
| | integration speech status observation | `Narration` (`CompletionCurrent`); Glue: exposes accepted state without text or audio |
| | the calibration's host: `store` applies the timing before it resolves | `Calibration` (`ApplyRate`) |
| | asking the panel again after Set Up Agent | `Start` (`FlipSetUp`) |
| | the rest | Glue |
| `demo.ts` | all | Glue: plays a script through the controller's public calls |
| `calibration.ts` | all | `Calibration` |
| `passage.ts` | `builtInPassage` | Glue: reads the passage's media files |
| `timings.ts` | `setTimings` | Glue: the extension's delays, one set for tests |
| `panel_placement.ts` | panel prepare, commit and fallback | `PanelPlacement` |
| `panel_html.ts` | `panelHtml`, `settingSpeed` | Format |
| `webview/panel.css` | all | Look |
| `panel_messages.ts` | | Types |

### `speech_openrouter.ts`

| Functions | Spec |
|---|---|
| `models`, `catalog`, `synthesize` | `OpenRouterSpeech` (account eligibility, narrowing and sampled policy); solitary tests cover parsing and PCM validation. |
| `request` | `OpenRouterSpeech` abstracts request failure; solitary tests cover bounds, cancellation and timeout. |

### `openrouter.ts` in protocol

| Functions | Spec |
|---|---|
| Schema declarations | Types; `openrouter.test.ts` checks the bounded provider catalog and request shapes. |

### `speech_openrouter_catalog.ts`

| Functions | Spec |
|---|---|
| `load`, `invalidate`, `contains`, eligibility admission | `OpenRouterCatalog` (identity, stale replies and remembered-pair eligibility). |

## Native test harness

| Script | Spec |
|---|---|
| `packages/vscode/scripts/integration.sh` | `IntegrationFixture`: selected extension identity and cleanup |
| `packages/vscode/scripts/integration_speech_faults.sh` | `IntegrationFixture`: per-fixture extension identity and cleanup |
