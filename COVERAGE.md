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

Last updated: tla, 2026-10-12.

| File | Type | Unit | Integration | TLC | Swift | Shell | CSS |
|---|---|---|---|---|---|---|---|
| `.claude/skills/reload-extension/scripts/reload.sh` | Shell | - | - | - | - | L 100.0% (16 of 16) | - |
| `packages/core/src/bridge.ts` | TypeScript | L 95.1% B 78.6% F 100.0% | L 88.4% B 64.0% F 94.1% | - | - | - | - |
| `packages/core/src/config.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/constants.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/controller.ts` | TypeScript | L 96.8% B 88.8% F 94.9% | L 90.4% B 84.5% F 86.6% | - | - | - | - |
| `packages/core/src/diff.ts` | TypeScript | L 100.0% B 92.8% F 100.0% | L 94.7% B 80.0% F 100.0% | - | - | - | - |
| `packages/core/src/index.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `packages/core/src/lines.ts` | TypeScript | L 100.0% B 95.0% F 100.0% | L 100.0% B 93.3% F 100.0% | - | - | - | - |
| `packages/core/src/paths.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `packages/core/src/places.ts` | TypeScript | L 100.0% B 93.1% F 100.0% | L 75.2% B 47.6% F 66.7% | - | - | - | - |
| `packages/core/src/player.ts` | TypeScript | L 99.2% B 92.4% F 97.4% | L 91.5% B 69.0% F 93.1% | - | - | - | - |
| `packages/core/src/ports.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/rehearsal.ts` | TypeScript | L 94.1% B 92.8% F 86.4% | L 98.5% B 93.3% F 86.4% | - | - | - | - |
| `packages/core/src/text.ts` | TypeScript | L 100.0% B 89.3% F 100.0% | L 98.0% B 75.0% F 87.5% | - | - | - | - |
| `packages/core/src/timeline.ts` | TypeScript | L 91.4% B 85.0% F 100.0% | L 85.5% B 85.7% F 80.0% | - | - | - | - |
| `packages/core/src/timing.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/typing.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 96.3% B 95.7% F 100.0% | - | - | - | - |
| `packages/core/test/bridge.discovery.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/controller.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/diff.exhaustive.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/fake.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/lines.exhaustive.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/places.exhaustive.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/places.scale.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/timing.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/typing.exhaustive.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/units.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/protocol/src/index.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 94.1% B 54.0% F 90.9% | - | - | - | - |
| `packages/protocol/src/paths.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 80.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/wire.ts` | TypeScript | L 91.7% B 83.3% F 83.3% | L 97.6% B 50.0% F 100.0% | - | - | - | - |
| `packages/relay/src/guide.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/relay/src/link.ts` | TypeScript | L 97.7% B 85.7% F 92.5% | - | - | - | - | - |
| `packages/relay/src/main.ts` | TypeScript | L 0.0% B 100.0% F 0.0% | - | - | - | - | - |
| `packages/relay/src/md.d.ts` | TypeScript | - | - | - | - | - | - |
| `packages/relay/src/render.ts` | TypeScript | L 98.9% B 91.7% F 100.0% | - | - | - | - | - |
| `packages/relay/src/server.ts` | TypeScript | L 98.3% B 84.4% F 100.0% | - | - | - | - | - |
| `packages/relay/src/tools.ts` | TypeScript | L 96.9% B 82.2% F 100.0% | - | - | - | - | - |
| `packages/relay/test/guide.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/link.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/relay.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/render.fields.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/render.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/validation.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/scripts/build.mts` | TypeScript | - | - | - | - | - | - |
| `packages/vscode/scripts/icon/Package.swift` | Swift | - | - | - | - | - | - |
| `packages/vscode/scripts/icon/Sources/IconDrawing/Icon.swift` | Swift | - | - | - | L 99.3% R 93.3% F 100.0% | - | - |
| `packages/vscode/scripts/icon/Sources/icon/main.swift` | Swift | - | - | - | - | - | - |
| `packages/vscode/scripts/icon/Tests/IconDrawingTests/IconDrawingTests.swift` | Swift | - | - | - | L 99.1% R 98.2% F 97.9% | - | - |
| `packages/vscode/scripts/integration.sh` | Shell | - | - | - | - | L 86.7% (26 of 30) | - |
| `packages/vscode/scripts/vscode_bin.mts` | TypeScript | - | - | - | - | - | - |
| `packages/vscode/src/agents.ts` | TypeScript | L 93.8% B 81.6% F 87.2% | L 42.8% B 66.7% F 12.8% | - | - | - | - |
| `packages/vscode/src/calibration.ts` | TypeScript | L 97.4% B 86.4% F 100.0% | L 58.6% B 66.7% F 33.3% | - | - | - | - |
| `packages/vscode/src/demo.ts` | TypeScript | L 32.5% B 44.0% F 40.0% | L 92.5% B 68.0% F 80.0% | - | - | - | - |
| `packages/vscode/src/editor.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | L 95.0% B 83.8% F 95.8% | - | - | - | - |
| `packages/vscode/src/extension.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | L 77.6% B 61.2% F 63.6% | - | - | - | - |
| `packages/vscode/src/output.ts` | TypeScript | L 100.0% B 92.8% F 100.0% | L 86.4% B 37.5% F 100.0% | - | - | - | - |
| `packages/vscode/src/outside.ts` | TypeScript | L 100.0% B 92.8% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/outside_watch.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | L 100.0% B 96.3% F 100.0% | - | - | - | - |
| `packages/vscode/src/panel.ts` | TypeScript | L 50.4% B 34.7% F 69.6% | L 61.9% B 46.5% F 70.6% | - | - | - | - |
| `packages/vscode/src/panel_html.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 80.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/panel_messages.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `packages/vscode/src/passage.ts` | TypeScript | L 0.0% B 100.0% F 0.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/setup.ts` | TypeScript | L 52.9% B 28.6% F 41.7% | L 66.0% B 55.5% F 60.0% | - | - | - | - |
| `packages/vscode/src/terminal.ts` | TypeScript | L 65.5% B 59.3% F 53.1% | L 89.1% B 81.1% F 92.3% | - | - | - | - |
| `packages/vscode/src/view.ts` | TypeScript | L 100.0% B 96.2% F 100.0% | L 100.0% B 88.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/webview/panel.css` | CSS | - | - | - | - | - | 115 of 115 rules matched |
| `packages/vscode/src/webview/panel.ts` | TypeScript | L 77.3% B 59.7% F 64.8% | - | - | - | - | - |
| `packages/vscode/test/a11y.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/agents.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/calibration.page.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/calibration.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/css.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/demo.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/draft.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/history.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/integration.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/launcher.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/output.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/outside.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/page.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/panel.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/replay.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/rich.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/runbox.page.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/setup.properties.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/speed.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/start.page.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/start.setup.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/start.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/terminal.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/view.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/visual/panel.spec.ts` | TypeScript | test | test | test | test | test | test |
| `playwright.config.ts` | TypeScript | - | - | - | - | - | - |
| `scripts/check_ascii.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `scripts/coverage_report.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/coverage_report.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `scripts/coverage_shell.sh` | Shell | - | - | - | - | - | - |
| `scripts/coverage_swift.sh` | Shell | - | - | - | - | - | - |
| `scripts/lint_shell.sh` | Shell | - | - | - | - | - | - |
| `scripts/lint_tla.test.ts` | TypeScript | test | test | test | test | test | test |
| `scripts/lint_tla.ts` | TypeScript | L 86.0% B 90.3% F 85.7% | - | - | - | - | - |
| `scripts/lint_web.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `scripts/release.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `scripts/stylelint.config.ts` | TypeScript | - | - | - | - | - | - |
| `specs/Actions.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Actions.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/Anchor.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Anchor.tla` | TLA+ | - | - | 6 of 6 actions | - | - | - |
| `specs/BatchFile.cfg` | TLC config | - | - | - | - | - | - |
| `specs/BatchFile.tla` | TLA+ | - | - | 4 of 4 actions | - | - | - |
| `specs/Bridge.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Bridge.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/Calibration.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Calibration.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/Controller.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Controller.tla` | TLA+ | - | - | 17 of 17 actions | - | - | - |
| `specs/Discovery.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Discovery.tla` | TLA+ | - | - | 11 of 11 actions | - | - | - |
| `specs/Discovery_InPlace.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Draft.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Draft.tla` | TLA+ | - | - | 7 of 7 actions | - | - | - |
| `specs/EditEvents.cfg` | TLC config | - | - | - | - | - | - |
| `specs/EditEvents.tla` | TLA+ | - | - | 4 of 4 actions | - | - | - |
| `specs/EditorAdapter.cfg` | TLC config | - | - | - | - | - | - |
| `specs/EditorAdapter.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/FileText.cfg` | TLC config | - | - | - | - | - | - |
| `specs/FileText.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/FollowMode.cfg` | TLC config | - | - | - | - | - | - |
| `specs/FollowMode.tla` | TLA+ | - | - | 8 of 8 actions | - | - | - |
| `specs/LineIdentity.cfg` | TLC config | - | - | - | - | - | - |
| `specs/LineIdentity.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/ListenGrace.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ListenGrace.tla` | TLA+ | - | - | 7 of 7 actions | - | - | - |
| `specs/Navigator.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Navigator.tla` | TLA+ | - | - | 8 of 8 actions | - | - | - |
| `specs/Outside.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Outside.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/Panel.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Panel.tla` | TLA+ | - | - | 5 of 5 actions | - | - | - |
| `specs/PanelReplay.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PanelReplay.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/PanelScroll.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PanelScroll.tla` | TLA+ | - | - | 4 of 4 actions | - | - | - |
| `specs/Places.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Places.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Player.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Player.tla` | TLA+ | - | - | 7 of 7 actions | - | - | - |
| `specs/PointFocus.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PointFocus.tla` | TLA+ | - | - | 8 of 8 actions | - | - | - |
| `specs/ProjectGuide.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ProjectGuide.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Rehearsal.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Rehearsal.tla` | TLA+ | - | - | 9 of 9 actions | - | - | - |
| `specs/Reload.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Reload.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/Resume.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Resume.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/RunBox.cfg` | TLC config | - | - | - | - | - | - |
| `specs/RunBox.tla` | TLA+ | - | - | 9 of 9 actions | - | - | - |
| `specs/Scroll.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Scroll.tla` | TLA+ | - | - | 6 of 6 actions | - | - | - |
| `specs/Serialize.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Serialize.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/Start.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Start.tla` | TLA+ | - | - | 12 of 12 actions | - | - | - |
| `specs/Terminals.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Terminals.tla` | TLA+ | - | - | 12 of 12 actions | - | - | - |
| `specs/Timeline.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Timeline.tla` | TLA+ | - | - | 8 of 8 actions | - | - | - |
| `specs/Turns.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Turns.tla` | TLA+ | - | - | 6 of 6 actions | - | - | - |
| `specs/Typing.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Typing.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Wire.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Wire.tla` | TLA+ | - | - | 13 of 13 actions | - | - | - |
| `specs/check.sh` | Shell | - | - | - | - | L 97.7% (43 of 44) | - |
| `vitest.config.ts` | TypeScript | - | - | - | - | - | - |
