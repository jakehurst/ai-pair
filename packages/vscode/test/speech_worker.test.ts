import { afterEach, expect, it, vi } from 'vitest';
import { loadSpeechEngine } from '../src/speech_engine';

const fake = vi.hoisted(() => {
  const reply: { current?: (message: unknown) => void } = {};
  return {
    on: vi.fn<(event: string, callback: (message: unknown) => void) => void>(),
    postMessage: vi.fn(),
    receive: vi.fn(),
    reply,
  };
});
const load = vi.hoisted(() => ({ current: undefined as ((modelPath: string) => Promise<unknown>) | undefined }));
vi.mock('node:worker_threads', () => ({ parentPort: { on: fake.on, postMessage: fake.postMessage }, workerData: { modelPath: '/model' } }));
vi.mock('../src/speech_engine', () => ({ loadSpeechEngine: vi.fn() }));
vi.mock('../src/speech_worker_host', () => ({
  SpeechWorkerHost: class {
    receive = fake.receive;
    constructor(loader: (modelPath: string) => Promise<unknown>, reply: (message: unknown) => void) {
      load.current = loader;
      fake.reply.current = reply;
    }
  },
}));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('node:worker_threads');
});

it('connects worker messages and replies to the validated host', async () => {
  await import('../src/speech_worker');
  expect(fake.on).toHaveBeenCalledWith('message', expect.any(Function));
  const handler = fake.on.mock.calls[0]?.[1];
  if (handler === undefined || fake.reply.current === undefined) throw new Error('No worker handler');
  const init = { type: 'init', version: 1, epoch: 1, modelPath: '/model' };
  handler(init);
  expect(fake.receive).toHaveBeenCalledWith(init);
  const failure = { type: 'failure', version: 1, epoch: 1, category: 'load' };
  fake.reply.current(failure);
  expect(fake.postMessage).toHaveBeenCalledWith(failure);
});

it('refuses to run the worker entry outside a worker thread', async () => {
  const parentPort: unknown = JSON.parse('null');
  vi.doMock('node:worker_threads', () => ({ parentPort }));
  await expect(import('../src/speech_worker')).rejects.toThrow('parent port');
});

it.each([
  [{ modelPath: '/model' }, false],
  [{ modelPath: '/model', device: 'coreml' }, true],
  [undefined, false],
  ['coreml', false],
])('CoreMlCompute Load: loads on CoreML only when the host asked for it (%j)', async (workerData, coreMl) => {
  vi.doMock('node:worker_threads', () => ({ parentPort: { on: fake.on, postMessage: fake.postMessage }, workerData }));
  await import('../src/speech_worker');
  await load.current?.('/model');
  expect(vi.mocked(loadSpeechEngine)).toHaveBeenLastCalledWith('/model', coreMl);
});
