import { expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { AudioAdapter } from '../../audio-native/src';
import type { SpeechDiagnosticEvent } from '../../vscode/src/diagnostics';
import { createSpeechHost } from '../src/speech_host';

const callbacks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  config: undefined as ((event: { affectsConfiguration(key: string): boolean }) => void) | undefined,
  secret: undefined as ((event: { key: string }) => void) | undefined,
}));

vi.mock('vscode', () => ({
  env: { uiKind: 1 },
  UIKind: { Desktop: 1 },
  workspace: {
    getConfiguration: () => ({
      get: (key: string) => callbacks.values.get(key),
      inspect: (key: string) => ({ globalValue: callbacks.values.get(key) }),
      update: vi.fn(),
    }),
    onDidChangeConfiguration: (callback: typeof callbacks.config) => {
      callbacks.config = callback;
      return { dispose: vi.fn() };
    },
  },
  window: { showInputBox: vi.fn(), showErrorMessage: vi.fn() },
  ConfigurationTarget: { Global: 1 },
}));

it('keeps speech disabled by default and retains a missing local device', async () => {
  const secrets = {
    get: vi.fn(),
    store: vi.fn(),
    delete: vi.fn(),
    onDidChange: (callback: typeof callbacks.secret) => {
      callbacks.secret = callback;
      return { dispose: vi.fn() };
    },
  };
  // The integration fixture supplies only the VS Code methods used by this host.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const context = {
    extensionPath: '/extension',
    globalStorageUri: { fsPath: '/storage' },
    secrets,
    globalState: { get: () => ({ kind: 'native', backend: 'coreaudio', name: 'missing' }), update: vi.fn() },
  } as unknown as vscode.ExtensionContext;
  const admit = vi.fn();
  const capabilities = vi
    .fn()
    .mockResolvedValue({ backend: 'coreaudio', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true });
  const list = vi.fn().mockResolvedValue([]);
  const adapter: AudioAdapter = {
    capabilities,
    list,
    admit,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  };
  const panel = {
    showSpeechReadiness: vi.fn(),
    showSpeechKeyStatus: vi.fn(),
    showOpenRouterKeyStatus: vi.fn(),
    showOpenRouterCatalog: vi.fn(),
    showSpeechOutputCatalog: vi.fn(),
    showSpeechCatalog: vi.fn(),
    showSpeechSettings: vi.fn(),
    showSpeechComputeState: vi.fn(),
    showSpeechStatus: vi.fn(),
    showSpeechCost: vi.fn(),
    refreshSpeechSupport: vi.fn(),
  };
  const host = createSpeechHost({
    context,
    connectionEpoch: 'epoch',
    adapter,
    page: () => 1,
    panel: () => panel,
    diagnostic: vi.fn<(event: SpeechDiagnosticEvent) => void>(),
  });
  expect(host.audioDiagnostics()).toMatchObject({ enabled: false, output: 'override', routeAvailable: 'unknown' });
  expect(JSON.stringify(host.audioDiagnostics())).not.toContain('missing');
  expect(list).not.toHaveBeenCalled();
  host.panelSpeech.computeMode('gpu');
  await host.speech.preview();
  expect(panel.showSpeechStatus).toHaveBeenCalledWith(
    expect.any(Number),
    'unavailable',
    'GPU speech is unavailable on this computer. Choose CPU in Pair Settings.',
  );
  expect(host.panelSpeech.computeState().actualBackend).toBe('none');
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  });
  host.panelSpeech.computeMode('cpu');
  await host.speech.speak('hello');
  expect(admit).not.toHaveBeenCalled();
  expect(secrets.get).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(capabilities).toHaveBeenCalled();
  });
  await vi.waitFor(() => {
    expect(list).toHaveBeenCalledOnce();
  });
  expect(host.panelSpeech.outputReady()).toBe(false);
  list.mockResolvedValue([{ id: 'missing', label: 'Headset' }]);
  host.panelSpeech.outputRefresh();
  await vi.waitFor(() => {
    expect(panel.showSpeechOutputCatalog).toHaveBeenCalled();
  });
  expect(host.panelSpeech.outputView().selected).toEqual({ kind: 'native', backend: 'coreaudio', name: 'missing' });
  await vi.waitFor(() => {
    expect(host.panelSpeech.outputReady()).toBe(true);
  });
  list.mockResolvedValue([]);
  host.panelSpeech.outputRefresh();
  await vi.waitFor(() => {
    expect(list).toHaveBeenCalledTimes(3);
    expect(host.panelSpeech.outputView().devices).toEqual([]);
  });
  expect(host.panelSpeech.outputReady()).toBe(false);
  callbacks.values.set('speech.enabled', true);
  callbacks.values.set('speech.provider', 'elevenlabs');
  callbacks.values.set('speech.elevenLabsVoice', 'voice');
  await host.speech.speak('hello');
  expect(admit).not.toHaveBeenCalled();
  expect(secrets.get).not.toHaveBeenCalled();
  callbacks.values.clear();
  callbacks.config?.({ affectsConfiguration: () => true });
  expect(panel.showSpeechSettings).toHaveBeenCalled();
  await host.dispose();
});

it('restores an available saved output without opening Settings', async () => {
  const secrets = {
    get: vi.fn(),
    store: vi.fn(),
    delete: vi.fn(),
    onDidChange: (callback: typeof callbacks.secret) => {
      callbacks.secret = callback;
      return { dispose: vi.fn() };
    },
  };
  // The integration fixture supplies only the VS Code methods used by this host.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const context = {
    extensionPath: '/extension',
    globalStorageUri: { fsPath: '/storage' },
    secrets,
    globalState: { get: () => ({ kind: 'native', backend: 'coreaudio', name: 'headset' }), update: vi.fn() },
  } as unknown as vscode.ExtensionContext;
  const admit = vi.fn();
  const capabilities = vi
    .fn()
    .mockResolvedValue({ backend: 'coreaudio', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true });
  const list = vi.fn().mockResolvedValue([{ id: 'headset', label: 'Headset' }]);
  const adapter: AudioAdapter = {
    capabilities,
    list,
    admit,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  };
  const panel = {
    showSpeechReadiness: vi.fn(),
    showSpeechKeyStatus: vi.fn(),
    showOpenRouterKeyStatus: vi.fn(),
    showOpenRouterCatalog: vi.fn(),
    showSpeechOutputCatalog: vi.fn(),
    showSpeechCatalog: vi.fn(),
    showSpeechSettings: vi.fn(),
    showSpeechComputeState: vi.fn(),
    showSpeechStatus: vi.fn(),
    showSpeechCost: vi.fn(),
    refreshSpeechSupport: vi.fn(),
  };
  const host = createSpeechHost({
    context,
    connectionEpoch: 'epoch',
    adapter,
    page: () => 1,
    panel: () => panel,
    diagnostic: vi.fn<(event: SpeechDiagnosticEvent) => void>(),
  });
  await vi.waitFor(() => {
    expect(host.panelSpeech.outputReady()).toBe(true);
  });
  expect(list).toHaveBeenCalledOnce();
  expect(host.panelSpeech.outputView().selected).toEqual({ kind: 'native', backend: 'coreaudio', name: 'headset' });
  await host.dispose();
});

it('retries a failed startup device listing from Settings', async () => {
  const secrets = {
    get: vi.fn(),
    store: vi.fn(),
    delete: vi.fn(),
    onDidChange: (callback: typeof callbacks.secret) => {
      callbacks.secret = callback;
      return { dispose: vi.fn() };
    },
  };
  // The integration fixture supplies only the VS Code methods used by this host.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const context = {
    extensionPath: '/extension',
    globalStorageUri: { fsPath: '/storage' },
    secrets,
    globalState: { get: () => ({ kind: 'native', backend: 'coreaudio', name: 'headset' }), update: vi.fn() },
  } as unknown as vscode.ExtensionContext;
  const admit = vi.fn();
  const capabilities = vi
    .fn()
    .mockResolvedValue({ backend: 'coreaudio', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true });
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error('device listing failed'))
    .mockResolvedValue([{ id: 'headset', label: 'Headset' }]);
  const adapter: AudioAdapter = {
    capabilities,
    list,
    admit,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  };
  const panel = {
    showSpeechReadiness: vi.fn(),
    showSpeechKeyStatus: vi.fn(),
    showOpenRouterKeyStatus: vi.fn(),
    showOpenRouterCatalog: vi.fn(),
    showSpeechOutputCatalog: vi.fn(),
    showSpeechCatalog: vi.fn(),
    showSpeechSettings: vi.fn(),
    showSpeechComputeState: vi.fn(),
    showSpeechStatus: vi.fn(),
    showSpeechCost: vi.fn(),
    refreshSpeechSupport: vi.fn(),
  };
  const host = createSpeechHost({
    context,
    connectionEpoch: 'epoch',
    adapter,
    page: () => 1,
    panel: () => panel,
    diagnostic: vi.fn<(event: SpeechDiagnosticEvent) => void>(),
  });
  await vi.waitFor(() => {
    expect(host.panelSpeech.outputView().reason).toBe('unavailable');
  });
  expect(host.panelSpeech.outputReady()).toBe(false);
  host.panelSpeech.outputRefresh();
  await vi.waitFor(() => {
    expect(host.panelSpeech.outputReady()).toBe(true);
  });
  expect(list).toHaveBeenCalledTimes(2);
  expect(host.panelSpeech.outputView().selected).toEqual({ kind: 'native', backend: 'coreaudio', name: 'headset' });
  await host.dispose();
});
