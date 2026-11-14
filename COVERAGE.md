# Coverage

What each coverage tool last measured, for every source file, in one place.
Each run rewrites its own column: `npm run test:coverage` the unit column
(vitest, v8) and the CSS column (the stylesheet's rules the page matched),
`npm run test:integration:coverage` the integration column (c8 over the
extension host, mapped back to the sources), `npm run coverage:tla` the TLC
column (how many of a spec's actions fired in any of its configs),
`npm run test:swift:coverage` the Swift column (llvm-cov), and
`npm run test:shell:coverage` the Shell column (kcov over the bats tests).
A run with `--check` fails below the minimums in
[coverage_thresholds.json](coverage_thresholds.json), each file's measured
coverage rounded down; a change that raises a file's coverage raises its
minimum in the same PR (#161).
L, B, R, and F are lines, branches, regions, and functions covered. `-` is a
file no tool measures; `test` is a test. Which spec covers which source file
is in [specs/COVERAGE.md](specs/COVERAGE.md).

Last updated: integration, 2026-11-14.

| File | Type | Unit | Integration | TLC | Swift | Shell | CSS |
|---|---|---|---|---|---|---|---|
| `.claude/skills/reload-extension/scripts/reload.sh` | Shell | - | - | - | - | L 100.0% (16 of 16) | - |
| `packages/audio-native/native/macos/main.swift` | Swift | - | - | - | - | - | - |
| `packages/audio-native/src/admission.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 40.7% B 100.0% F 20.0% | - | - | - | - |
| `packages/audio-native/src/factory.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 81.8% B 50.0% F 100.0% | - | - | - | - |
| `packages/audio-native/src/helper_backend.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 9.8% B 100.0% F 0.0% | - | - | - | - |
| `packages/audio-native/src/helper_catalog.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 28.6% B 100.0% F 0.0% | - | - | - | - |
| `packages/audio-native/src/helper_location.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 28.6% B 100.0% F 0.0% | - | - | - | - |
| `packages/audio-native/src/helper_manifest.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 27.8% B 100.0% F 0.0% | - | - | - | - |
| `packages/audio-native/src/index.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/audio-native/src/linux_backend.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 51.9% B 60.0% F 50.0% | - | - | - | - |
| `packages/audio-native/src/linux_default.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 19.6% B 100.0% F 0.0% | - | - | - | - |
| `packages/audio-native/src/native_adapter.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 39.3% B 80.0% F 33.3% | - | - | - | - |
| `packages/audio-native/src/ownership.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 41.7% B 100.0% F 20.0% | - | - | - | - |
| `packages/audio-native/src/playback.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 36.9% B 100.0% F 25.0% | - | - | - | - |
| `packages/audio-native/src/protocol.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 35.5% B 100.0% F 0.0% | - | - | - | - |
| `packages/audio-native/src/stage.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/audio-native/src/verified_backend.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 57.9% B 100.0% F 0.0% | - | - | - | - |
| `packages/audio-native/test/admission.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/admission.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/factory.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/factory.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/helper_backend.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/helper_catalog.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/helper_location.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/helper_manifest.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/helper_manifest.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/linux_backend.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/linux_default.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/multipart_native_adapter.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/native_adapter.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/native_adapter.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/ownership.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/ownership.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/playback.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/protocol.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/stage.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/stage.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-native/test/verified_backend.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/scripts/build.mts` | TypeScript | - | - | - | - | - | - |
| `packages/audio-ui/scripts/build_identity.mts` | TypeScript | - | - | - | - | - | - |
| `packages/audio-ui/scripts/gpu_manifest.mts` | TypeScript | - | - | - | - | - | - |
| `packages/audio-ui/scripts/gpu_manifest.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/scripts/gpu_runtime.mts` | TypeScript | - | - | - | - | - | - |
| `packages/audio-ui/scripts/gpu_runtime.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/scripts/speech_runtime.mts` | TypeScript | - | - | - | - | - | - |
| `packages/audio-ui/scripts/speech_runtime.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/src/attachment_gate.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 98.1% B 75.0% F 100.0% | - | - | - | - |
| `packages/audio-ui/src/companion_narration.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 73.1% B 29.4% F 81.8% | - | - | - | - |
| `packages/audio-ui/src/companion_output.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 46.4% B 63.6% F 53.8% | - | - | - | - |
| `packages/audio-ui/src/companion_session.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 82.2% B 87.5% F 54.2% | - | - | - | - |
| `packages/audio-ui/src/extension.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 87.2% B 67.5% F 100.0% | - | - | - | - |
| `packages/audio-ui/src/local_connection.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 95.5% B 60.0% F 100.0% | - | - | - | - |
| `packages/audio-ui/src/speech_host.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 72.9% B 57.0% F 54.4% | - | - | - | - |
| `packages/audio-ui/test/attachment_gate.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/bridge.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/build_identity.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/companion_narration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/companion_output.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/companion_session.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/companion_session.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/extension.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/local_connection.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/native_output.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/packaging.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/sentence_pipeline.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/speech_context_flow.e2e.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/audio-ui/test/speech_host.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/speech_host.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/speech_restart_handshake.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/speech_tempo_composed.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/audio-ui/test/worker_diagnostics.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/core/src/bridge.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/config.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/constants.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/controller.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/diagnostic_delivery.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/diff.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 95.5% F 100.0% | - | - | - | - |
| `packages/core/src/index.ts` | TypeScript | - | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/lines.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 95.7% F 100.0% | - | - | - | - |
| `packages/core/src/paths.ts` | TypeScript | - | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/places.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/player.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 99.3% F 100.0% | - | - | - | - |
| `packages/core/src/ports.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/rehearsal.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/speech_context.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 75.0% B 100.0% F 83.3% | - | - | - | - |
| `packages/core/src/speech_reminder.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/structural_typing.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 66.7% F 100.0% | - | - | - | - |
| `packages/core/src/text.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/timeline.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 97.4% F 100.0% | - | - | - | - |
| `packages/core/src/timing.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/typing.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/test/bridge.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/controller.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/diagnostic_delivery.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/core/test/diagnostics_bridge.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/core/test/diff.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/fake.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/lines.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/places.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/player.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/rehearsal.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/session.e2e.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/core/test/speech_context.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/core/test/speech_reminder.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/core/test/structural_typing.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/core/test/text.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/timeline.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/timing.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/typing.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/protocol/src/command_channel.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 88.5% B 77.3% F 100.0% | - | - | - | - |
| `packages/protocol/src/diagnostics.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/gpu_diagnostics.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/index.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/local_audio.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/local_diagnostics.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/openrouter.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/panel_action.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/panel_chunks.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 33.3% F 100.0% | - | - | - | - |
| `packages/protocol/src/panel_update.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/paths.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 84.6% F 100.0% | - | - | - | - |
| `packages/protocol/src/schemas.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/speech_decode.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/wire.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/test/command_channel.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/protocol/test/diagnostics.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/protocol/test/gpu_diagnostics.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/protocol/test/index.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/protocol/test/local_audio.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/protocol/test/local_diagnostics.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/protocol/test/openrouter.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/protocol/test/panel_action.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/protocol/test/panel_chunks.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/protocol/test/panel_update.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/protocol/test/paths.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/protocol/test/speech_decode.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/protocol/test/wire.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/src/guide.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 98.6% B 88.9% F 100.0% | - | - | - | - |
| `packages/relay/src/link.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/relay/src/main.ts` | TypeScript | - | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/relay/src/md.d.ts` | TypeScript | - | - | - | - | - | - |
| `packages/relay/src/render.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 87.5% B 78.8% F 100.0% | - | - | - | - |
| `packages/relay/src/server.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 97.0% B 87.2% F 100.0% | - | - | - | - |
| `packages/relay/src/timings.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 50.0% F 100.0% | - | - | - | - |
| `packages/relay/src/tools.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/relay/test/agent_guide.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/relay/test/guide.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/link.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/relay.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/render.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/scripted_agent.e2e.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/relay/test/scripted_agent_harness.ts` | TypeScript | test | test | - | - | - | test |
| `packages/relay/test/server.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/skills.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/relay/test/speech_overlap.e2e.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/relay/test/timings.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/relay/test/tools.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/validation.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/scripts/build.mts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/scripts/build.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/scripts/icon/Package.swift` | Swift | - | - | - | - | - | - |
| `packages/vscode/scripts/icon/Sources/IconDrawing/Icon.swift` | Swift | - | - | - | L 100.0% R 93.2% F 100.0% | - | - |
| `packages/vscode/scripts/icon/Sources/icon/main.swift` | Swift | - | - | - | - | - | - |
| `packages/vscode/scripts/icon/Tests/IconDrawingTests/IconDrawingTests.swift` | Swift | - | - | - | L 99.4% R 98.6% F 98.2% | - | - |
| `packages/vscode/scripts/integration.sh` | Shell | - | - | - | - | L 89.7% (35 of 39) | - |
| `packages/vscode/scripts/integration_companion.sh` | Shell | - | - | - | - | L 95.6% (43 of 45) | - |
| `packages/vscode/scripts/integration_speech_faults.sh` | Shell | - | - | - | - | L 96.9% (31 of 32) | - |
| `packages/vscode/scripts/speech_runtime.mts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/scripts/vscode_bin.mts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/scripts/vscode_bin.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/src/agents.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 83.0% B 68.8% F 89.7% | - | - | - | - |
| `packages/vscode/src/calibration.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 95.2% F 100.0% | - | - | - | - |
| `packages/vscode/src/demo.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 95.8% B 83.9% F 100.0% | - | - | - | - |
| `packages/vscode/src/diagnostics.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 96.5% B 72.1% F 100.0% | - | - | - | - |
| `packages/vscode/src/diagnostics_collector.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 96.3% B 90.5% F 100.0% | - | - | - | - |
| `packages/vscode/src/editor.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 98.1% B 88.7% F 100.0% | - | - | - | - |
| `packages/vscode/src/extension.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 96.3% B 92.3% F 94.5% | - | - | - | - |
| `packages/vscode/src/output.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/outside.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 95.5% F 100.0% | - | - | - | - |
| `packages/vscode/src/outside_watch.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 96.5% F 100.0% | - | - | - | - |
| `packages/vscode/src/panel.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 88.3% B 84.9% F 94.6% | - | - | - | - |
| `packages/vscode/src/panel_html.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 80.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/panel_messages.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `packages/vscode/src/panel_placement.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 90.9% B 67.6% F 100.0% | - | - | - | - |
| `packages/vscode/src/panel_update_sender.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 91.5% B 82.6% F 100.0% | - | - | - | - |
| `packages/vscode/src/passage.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/python_diagnostics.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 88.3% B 62.5% F 100.0% | - | - | - | - |
| `packages/vscode/src/remote_narration.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 78.6% B 39.4% F 86.7% | - | - | - | - |
| `packages/vscode/src/session_speech_cost.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 66.3% B 90.9% F 66.7% | - | - | - | - |
| `packages/vscode/src/setup.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 85.1% B 85.4% F 83.3% | - | - | - | - |
| `packages/vscode/src/speech_catalog.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 98.9% B 89.7% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_compute_types.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `packages/vscode/src/speech_context_capabilities.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_credentials.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_decode_bridge.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 59.9% B 40.5% F 63.1% | - | - | - | - |
| `packages/vscode/src/speech_decode_lifecycle.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 81.0% B 68.4% F 78.6% | - | - | - | - |
| `packages/vscode/src/speech_elevenlabs.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 89.2% B 75.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_engine.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_asset_fs.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 26.1% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_assets.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 38.3% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_binding.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 25.2% B 100.0% F 25.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_bundled_assets.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 75.0% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_capability.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 40.5% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_check.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 41.5% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_client.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 23.5% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_driver.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 36.7% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_driver_identity.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_elf.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_engine.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_environment.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 28.6% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_host_binding.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 33.3% | - | - | - | - |
| `packages/vscode/src/speech_gpu_ipc.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 41.9% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_loader.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_loader_allowlist.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 66.7% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_model.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 15.1% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_model_error.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 66.7% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_model_manifest.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_negative.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_options.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_phonemizer_bridge.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_physical.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 25.6% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_preflight.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_process.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 15.4% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_profile.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_proof_runner.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 12.9% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_proof_worker.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_selftest.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_setup.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 45.1% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_setup_flow.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 29.8% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_slot.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 89.3% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_system.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 30.5% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_tiny.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_transport.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 49.2% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_trust.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 38.9% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_gpu_verified_engine.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_worker.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_worker_host.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_gpu_worker_runtime.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_lifecycle.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 56.6% B 56.7% F 54.2% | - | - | - | - |
| `packages/vscode/src/speech_local_client.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 43.9% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_local_protocol.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 88.2% B 100.0% F 50.0% | - | - | - | - |
| `packages/vscode/src/speech_model_manifest.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_native_output.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 29.7% B 66.7% F 36.4% | - | - | - | - |
| `packages/vscode/src/speech_openrouter.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 76.1% B 43.6% F 86.7% | - | - | - | - |
| `packages/vscode/src/speech_openrouter_catalog.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 88.6% B 83.3% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_openrouter_usage.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 25.3% B 100.0% F 50.0% | - | - | - | - |
| `packages/vscode/src/speech_output_preferences.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 85.7% B 75.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_output_router.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 68.9% B 50.0% F 80.0% | - | - | - | - |
| `packages/vscode/src/speech_output_types.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `packages/vscode/src/speech_pcm.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 52.0% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_phonemizer_bridge.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_platform.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 82.4% B 62.5% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_pricing.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_readiness.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 68.6% B 65.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_runtime_status.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 90.9% B 33.3% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_segments.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 94.9% B 22.2% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_service.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 65.5% B 51.0% F 74.5% | - | - | - | - |
| `packages/vscode/src/speech_setup.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 33.5% B 36.4% F 57.1% | - | - | - | - |
| `packages/vscode/src/speech_synthesis.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_tempo.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_tempo_client.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 36.0% B 66.7% F 25.0% | - | - | - | - |
| `packages/vscode/src/speech_tempo_messages.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_tempo_pcm.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 37.5% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_tempo_worker.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_tempo_worker_host.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_types.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/speech_waveform.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 57.8% B 100.0% F 0.0% | - | - | - | - |
| `packages/vscode/src/speech_worker.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_worker_host.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/terminal.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 98.5% F 100.0% | - | - | - | - |
| `packages/vscode/src/timings.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/view.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 88.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/voice_indicator.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/webview/approval_sound.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/webview/panel.css` | CSS | - | - | - | - | - | 166 of 166 rules matched |
| `packages/vscode/src/webview/panel.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/webview/speech_audio.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/webview/speech_decode.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/workspace_panel_bridge.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 89.1% B 68.4% F 100.0% | - | - | - | - |
| `packages/vscode/src/workspace_session.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 98.6% B 95.0% F 93.3% | - | - | - | - |
| `packages/vscode/test/agents.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/attention_audio_composed.e2e.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/attention_composed.e2e.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/calibration.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/command_approval_composed.e2e.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/css.e2e.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/demo.e2e.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/demo.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/demo_skill.e2e.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/diagnostics.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/diagnostics_collector.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/editor.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/extension.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/fixtures/packaged_mcp_check.mts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/fixtures/tempo_schema_fake.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/integration_attention_paths.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/integration_bad_speech_settings.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_catalog_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_cloud_companion_host.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_cloud_service_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_code_playback.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_command_delivery.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_companion_faults.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_companion_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_companion_version.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_core_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_deferred_settlement.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_diagnostic_coverage_paths.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/integration_flow_gate.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/integration_gap_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_gpu_process.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_guided_diagnostics.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_invalid_calibration.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_legacy_speech_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_model_status.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_no_workspace.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_notification.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_panel_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_paths.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/integration_player_faults.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_player_gap_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_preserved_playback.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_recovery_restart.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_release_extension_owner_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_release_extension_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_render_diagnostic.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_restricted_runtime.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_runtime_identity.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_speech_coverage_paths.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/integration_speech_reminder.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_startup_paths.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_terminal_cleanup.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/integration_vscode_coverage_paths.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/integration_workspace_incompatible.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/launcher.e2e.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/navigator_editor.e2e.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/output.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/outside.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/outside_watch.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/page.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/panel.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/panel_html.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/panel_placement.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/panel_placement.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/panel_update_sender.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/panel_update_sender.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/passage.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/python_diagnostics.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/python_diagnostics.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/remote_narration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/session_speech_cost.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/setup.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/smoke_integration.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_audio.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_cached_assets.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_catalog.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_context_capabilities.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/speech_credentials.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_decode_bridge.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_decode_lifecycle.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_decode_output.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_decode_panel.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_decode_webview.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_elevenlabs.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_elevenlabs.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_engine.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_admission.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_asset_fs.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_asset_fs.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_assets.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_binding.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_binding.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_bundled_assets.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_capability.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_capability.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_check.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_client.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_driver.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_driver_identity.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_elf.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_elf.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_engine.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_environment.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_host_binding.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_ipc.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_loader.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_loader_allowlist.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_model.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_model.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_model_error.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_model_manifest.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_native.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_negative.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_options.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_phonemizer_bridge.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_physical.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_preflight.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_process.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_process.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_profile.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_proof_abort.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_proof_runner.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_proof_runner.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_proof_worker.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_selftest.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_setup.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_setup.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_setup_flow.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_slot.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_system.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_tiny.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_transport.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_trust.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_verified_engine.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_worker.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_worker_host.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_gpu_worker_runtime.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_handoff.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_lifecycle.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_lifecycle_acceptance.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_lifecycle_trace.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_local.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_local_client.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_local_protocol.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_native_output.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_native_spawn.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_openrouter.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_openrouter_catalog.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_openrouter_composed.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_openrouter_usage.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_output_discovery.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_output_preferences.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_output_router.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_pcm.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_pcm.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_phonemizer_bridge.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_platform.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_pricing.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_readiness.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_runtime.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_segments.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_service.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_setup.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_setup_fs.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_smoke_integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_smoke_integration.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_synthesis.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_tempo.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_tempo_client.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_tempo_client.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_tempo_framing.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_tempo_messages.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_tempo_pcm.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_tempo_worker.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_tempo_worker_host.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_warmup.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_waveform.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_worker.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/speech_worker_host.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/terminal.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/terminal_encoding.e2e.test.ts` | TypeScript | test | test | - | - | - | test |
| `packages/vscode/test/terminal_smoke_integration.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/timings.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/view.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/visual/chat_order.spec.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/visual/panel.spec.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/voice_indicator.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/webview/approval_sound.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/webview/panel.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/workspace_panel_bridge.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/workspace_session.integration.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/test/workspace_session.test.ts` | TypeScript | test | test | test | - | - | test |
| `packages/vscode/vendor/kokoro_phonemize.d.mts` | TypeScript | - | - | - | - | - | - |
| `playwright.config.ts` | TypeScript | - | - | - | - | - | - |
| `scripts/check_ascii.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/check_ascii.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/coverage_report.e2e.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/coverage_report.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/coverage_report.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/coverage_shell.sh` | Shell | - | - | - | - | - | - |
| `scripts/coverage_swift.sh` | Shell | - | - | - | - | - | - |
| `scripts/download_shfmt.sh` | Shell | - | - | - | - | L 100.0% (18 of 18) | - |
| `scripts/download_tlc.sh` | Shell | - | - | - | - | L 82.3% (14 of 17) | - |
| `scripts/lint_shell.sh` | Shell | - | - | - | - | L 57.7% (15 of 26) | - |
| `scripts/lint_tla.test.ts` | TypeScript | test | test | test | test | test | test |
| `scripts/lint_tla.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/lint_web.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/lint_web.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/normalize_architecture.e2e.test.ts` | TypeScript | test | test | test | - | - | test |
| `scripts/normalize_architecture.test.ts` | TypeScript | test | test | test | - | - | test |
| `scripts/normalize_architecture.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/release.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/release.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/release_docs.e2e.test.ts` | TypeScript | test | test | - | - | - | test |
| `scripts/specs_needed.sh` | Shell | - | - | - | - | L 92.3% (12 of 13) | - |
| `scripts/stylelint.config.ts` | TypeScript | - | - | - | - | - | - |
| `specs/ActionValidation.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ActionValidation.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Actions.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Actions.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Anchor.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Anchor.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Attention.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Attention.tla` | TLA+ | - | - | - | - | - | - |
| `specs/AttentionCache.cfg` | TLC config | - | - | - | - | - | - |
| `specs/AttentionCache.tla` | TLA+ | - | - | - | - | - | - |
| `specs/AudioOutput.cfg` | TLC config | - | - | - | - | - | - |
| `specs/AudioOutput.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/BatchFile.cfg` | TLC config | - | - | - | - | - | - |
| `specs/BatchFile.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Bridge.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Bridge.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/BuildIdentity.cfg` | TLC config | - | - | - | - | - | - |
| `specs/BuildIdentity.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Calibration.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Calibration.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/CloudNarration.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CloudNarration.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/CloudNarration_Healthy.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CodePlayback.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CodePlayback.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/CodePlayback_Progress.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CommandApproval.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CommandApproval.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/CommandCue.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CommandCue.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/CommandDelivery.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CommandDelivery.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/CommandEncoding.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CommandEncoding.tla` | TLA+ | - | - | - | - | - | - |
| `specs/CommandTracking.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CommandTracking.tla` | TLA+ | - | - | - | - | - | - |
| `specs/Controller.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Controller.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/CostReplay.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CostReplay.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/DeferredMessage.cfg` | TLC config | - | - | - | - | - | - |
| `specs/DeferredMessage.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Diagnostics.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Diagnostics.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/DiagnosticsCopy.cfg` | TLC config | - | - | - | - | - | - |
| `specs/DiagnosticsCopy.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/DiagnosticsFaultIsolation.cfg` | TLC config | - | - | - | - | - | - |
| `specs/DiagnosticsFaultIsolation.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/DiagnosticsPrivacy.cfg` | TLC config | - | - | - | - | - | - |
| `specs/DiagnosticsPrivacy.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/DiagnosticsPrivacy_Speech.cfg` | TLC config | - | - | - | - | - | - |
| `specs/DiagnosticsRequest.cfg` | TLC config | - | - | - | - | - | - |
| `specs/DiagnosticsRequest.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Discovery.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Discovery.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Discovery_InPlace.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Draft.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Draft.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/EditEvents.cfg` | TLC config | - | - | - | - | - | - |
| `specs/EditEvents.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/EditorAdapter.cfg` | TLC config | - | - | - | - | - | - |
| `specs/EditorAdapter.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/FileText.cfg` | TLC config | - | - | - | - | - | - |
| `specs/FileText.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/FollowMode.cfg` | TLC config | - | - | - | - | - | - |
| `specs/FollowMode.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/GpuMappedIcd.cfg` | TLC config | - | - | - | - | - | - |
| `specs/GpuMappedIcd.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/GpuProcessSlot.cfg` | TLC config | - | - | - | - | - | - |
| `specs/GpuProcessSlot.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/GpuProofAbort.cfg` | TLC config | - | - | - | - | - | - |
| `specs/GpuProofAbort.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/GpuSetup.cfg` | TLC config | - | - | - | - | - | - |
| `specs/GpuSetup.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/GpuSynthesisProcess.cfg` | TLC config | - | - | - | - | - | - |
| `specs/GpuSynthesisProcess.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/IntegrationFixture.cfg` | TLC config | - | - | - | - | - | - |
| `specs/IntegrationFixture.tla` | TLA+ | - | - | - | - | - | - |
| `specs/LineEndGuard.cfg` | TLC config | - | - | - | - | - | - |
| `specs/LineEndGuard.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/LineIdentity.cfg` | TLC config | - | - | - | - | - | - |
| `specs/LineIdentity.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/ListenGrace.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ListenGrace.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/ListeningHint.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ListeningHint.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/LocalAudioAdmission.cfg` | TLC config | - | - | - | - | - | - |
| `specs/LocalAudioAdmission.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/LocalAudioOwnership.cfg` | TLC config | - | - | - | - | - | - |
| `specs/LocalAudioOwnership.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/LocalPanelReplay.cfg` | TLC config | - | - | - | - | - | - |
| `specs/LocalPanelReplay.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/LocalPanelReplay_Delivery.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ModelStatus.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ModelStatus.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/MultipartAudioLease.cfg` | TLC config | - | - | - | - | - | - |
| `specs/MultipartAudioLease.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/MultipartAudioLease_Healthy.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Narration.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Narration.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Navigator.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Navigator.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/NavigatorCommentary.cfg` | TLC config | - | - | - | - | - | - |
| `specs/NavigatorCommentary.tla` | TLA+ | - | - | - | - | - | - |
| `specs/NavigatorFollowup.cfg` | TLC config | - | - | - | - | - | - |
| `specs/NavigatorFollowup.tla` | TLA+ | - | - | - | - | - | - |
| `specs/OpenRouterBoot.cfg` | TLC config | - | - | - | - | - | - |
| `specs/OpenRouterBoot.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/OpenRouterCatalog.cfg` | TLC config | - | - | - | - | - | - |
| `specs/OpenRouterCatalog.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/OpenRouterDecode.cfg` | TLC config | - | - | - | - | - | - |
| `specs/OpenRouterDecode.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/OpenRouterSpeech.cfg` | TLC config | - | - | - | - | - | - |
| `specs/OpenRouterSpeech.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/OpenRouterSpeech_Failure.cfg` | TLC config | - | - | - | - | - | - |
| `specs/OutputAdmission.cfg` | TLC config | - | - | - | - | - | - |
| `specs/OutputAdmission.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/OutputDiscoveryLifecycle.cfg` | TLC config | - | - | - | - | - | - |
| `specs/OutputDiscoveryLifecycle.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/OutputHandoff.cfg` | TLC config | - | - | - | - | - | - |
| `specs/OutputHandoff.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/OutputPreference.cfg` | TLC config | - | - | - | - | - | - |
| `specs/OutputPreference.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/OutputReplacement.cfg` | TLC config | - | - | - | - | - | - |
| `specs/OutputReplacement.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Outside.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Outside.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/PairDefs.tla` | TLA+ | - | - | - | - | - | - |
| `specs/Panel.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Panel.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/PanelMenus.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PanelMenus.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/PanelPlacement.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PanelPlacement.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/PanelReplay.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PanelReplay.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/PanelScroll.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PanelScroll.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Places.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Places.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/PlaybackAnchor.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PlaybackAnchor.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/PlaybackAnchor_Progress.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PlaybackPreference.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PlaybackPreference.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Player.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Player.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/PointFocus.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PointFocus.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/ProjectGuide.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ProjectGuide.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/ProviderChoice.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ProviderChoice.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/QuietTerminals.cfg` | TLC config | - | - | - | - | - | - |
| `specs/QuietTerminals.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/QuietTerminals_Visible.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ReadingGesture.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ReadingGesture.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/ReadingHold.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ReadingHold.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/ReadingSkip.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ReadingSkip.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/ReadyCount.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ReadyCount.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/RecoveryBatchIds.cfg` | TLC config | - | - | - | - | - | - |
| `specs/RecoveryBatchIds.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Rehearsal.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Rehearsal.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Reload.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Reload.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/RemoteCue.cfg` | TLC config | - | - | - | - | - | - |
| `specs/RemoteCue.tla` | TLA+ | - | - | - | - | - | - |
| `specs/Resume.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Resume.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/RevealCursor.cfg` | TLC config | - | - | - | - | - | - |
| `specs/RevealCursor.tla` | TLA+ | - | - | - | - | - | - |
| `specs/RunBox.cfg` | TLC config | - | - | - | - | - | - |
| `specs/RunBox.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/RuntimeIdentity.cfg` | TLC config | - | - | - | - | - | - |
| `specs/RuntimeIdentity.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/RuntimeIdentity_Mismatch.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Scroll.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Scroll.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SentencePipeline.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SentencePipeline.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SentencePipeline_Canceled.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SentencePipeline_Healthy.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Serialize.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Serialize.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SessionSpeechCost.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SessionSpeechCost.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SettingsAccess.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SettingsAccess.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/ShfmtDownload.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ShfmtDownload.tla` | TLA+ | - | - | - | - | - | - |
| `specs/ShellIdentity.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ShellIdentity.tla` | TLA+ | - | - | - | - | - | - |
| `specs/SpeechBackendHandoff.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechBackendHandoff.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SpeechContext.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechContext.tla` | TLA+ | - | - | - | - | - | - |
| `specs/SpeechLifecycle.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechLifecycle.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SpeechOverlap.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechOverlap.tla` | TLA+ | - | - | - | - | - | - |
| `specs/SpeechOverlap_Continue.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechPage.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechPage.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SpeechPlatformEvidence.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechPlatformEvidence.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SpeechReminder.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechReminder.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SpeechSettings.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechSettings.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SpeechSetup.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechSetup.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SpeechTempo.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechTempo.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SpeechTempo_Canceled.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechTempo_Healthy.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechWarmup.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechWarmup.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/SpeechWorker.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechWorker.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Start.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Start.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/StartDirectory.cfg` | TLC config | - | - | - | - | - | - |
| `specs/StartDirectory.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/StatusTransport.cfg` | TLC config | - | - | - | - | - | - |
| `specs/StatusTransport.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/StatusTransport_Matching.cfg` | TLC config | - | - | - | - | - | - |
| `specs/StructuralTyping.cfg` | TLC config | - | - | - | - | - | - |
| `specs/StructuralTyping.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/TerminalPanel.cfg` | TLC config | - | - | - | - | - | - |
| `specs/TerminalPanel.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/TerminalReuse.cfg` | TLC config | - | - | - | - | - | - |
| `specs/TerminalReuse.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Terminals.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Terminals.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Timeline.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Timeline.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Turns.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Turns.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Typing.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Typing.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/TypingEol.cfg` | TLC config | - | - | - | - | - | - |
| `specs/TypingEol.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/VoiceIndicator.cfg` | TLC config | - | - | - | - | - | - |
| `specs/VoiceIndicator.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/WarmSynthesisWorker.cfg` | TLC config | - | - | - | - | - | - |
| `specs/WarmSynthesisWorker.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/WarmSynthesisWorker_Cancellation.cfg` | TLC config | - | - | - | - | - | - |
| `specs/WarmSynthesisWorker_Healthy.cfg` | TLC config | - | - | - | - | - | - |
| `specs/WarmSynthesisWorker_Retirement.cfg` | TLC config | - | - | - | - | - | - |
| `specs/WarmSynthesisWorker_Watchdog.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Wire.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Wire.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/check.sh` | Shell | - | - | - | - | L 100.0% (49 of 49) | - |
| `vitest.config.ts` | TypeScript | - | - | - | - | - | - |
