// Real Electron extension host to the companion's pinned standalone Node runtime.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createGpuSynthesisClient } from '../src/speech_gpu_client';
import { LOCAL_CAPABILITIES } from '../src/speech_local_protocol';

/** Waits for an observed state without leaving a test child running on timeout. */
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('GPU test worker did not settle.');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

/** Exercises JSON IPC across the actual Electron and bundled Node versions. */
export async function gpuProcessPaths(): Promise<void> {
  assert.ok(typeof process.versions.electron === 'string', 'fixture must run inside the Electron extension host');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-pair-gpu-ipc-'));
  const model = path.join(directory, 'model');
  const versionFile = path.join(directory, 'version');
  const node = process.env.AI_PAIR_TEST_GPU_NODE ?? path.resolve(__dirname, '../../audio-ui/dist/speech-gpu/node');
  await fs.mkdir(model);
  await fs.writeFile(
    path.join(directory, 'gpu_worker.mjs'),
    `
    import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(versionFile)}, process.versions.node);
    let epoch;
    process.on('message', (message) => {
      if (message.type === 'init') {
        epoch = message.epoch;
        process.send({ type: 'ready', version: 1, epoch, capabilities: ${JSON.stringify(LOCAL_CAPABILITIES)} });
      } else if (message.type === 'synthesize') {
        process.send({ type: 'result', version: 1, epoch, id: message.id, part: message.part,
          wav: Buffer.from(Array.from({length: 44}, (_, i) => i)).toString('base64'), durationMs: 1 });
      } else if (message.type === 'shutdown') process.disconnect();
    });
  `,
  );
  const client = createGpuSynthesisClient({
    listener: { ready: () => {}, retired: () => {} },
    capability: {
      runtimeDirectory: directory,
      modelDirectory: model,
      executablePath: node,
      loaderPath: path.join(directory, 'loader'),
      loaderSha256: 'a'.repeat(64),
      driverPath: path.join(directory, 'driver'),
      driverSha256: 'b'.repeat(64),
      driverDevice: '1',
      driverInode: '1',
      environment: {
        LANG: 'C',
        VK_DRIVER_FILES: path.join(directory, 'icd'),
        VK_LOADER_LAYERS_DISABLE: '~all~',
        LD_PRELOAD: path.join(directory, 'loader'),
      },
    },
  });
  try {
    client.load(model);
    await until(() => client.state() === 'ready' || client.state() === 'cold');
    assert.equal(client.state(), 'ready', 'GPU IPC child exited before readiness');
    const childVersion = await fs.readFile(versionFile, 'utf8');
    assert.notEqual(childVersion, process.versions.node, 'fixture must cross different Node versions');
    const result = await client.synthesize({ id: 1, part: 0, text: 'Synthetic.', voice: 'af_heart', speed: 1, final: true });
    assert.equal(result.status, 'audio');
    if (result.status === 'audio') {
      assert.deepEqual(
        result.wav,
        Uint8Array.from({ length: 44 }, (_, i) => i),
      );
    }
    console.log('GPU Electron-to-Node IPC regression passed.');
  } finally {
    client.retire('worker_exit');
    try {
      await until(() => client.state() === 'cold');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}
