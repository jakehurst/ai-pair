import { parentPort, workerData } from 'node:worker_threads';
import { loadSpeechEngine } from './speech_engine';
import { SpeechWorkerHost } from './speech_worker_host';

if (parentPort === null) throw new Error('Speech worker requires a parent port.');
const port = parentPort;
const data: unknown = workerData;
// specs/CoreMlCompute.tla, Load: the host chose the CoreML provider for a GPU launch.
const coreMl = typeof data === 'object' && data !== null && 'device' in data && data.device === 'coreml';
const host = new SpeechWorkerHost(
  (modelPath) => loadSpeechEngine(modelPath, coreMl),
  (message) => {
    port.postMessage(message);
  },
);
port.on('message', (raw: unknown) => {
  void host.receive(raw);
});
