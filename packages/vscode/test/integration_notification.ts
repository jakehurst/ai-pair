// Reads only the isolated Electron workbench through its ephemeral loopback debugger.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import WebSocket from 'ws';

const ATTEMPTS = 100;
const INTERVAL_MS = 100;
const TIMEOUT_MS = 2000;

/** Evaluates an expression in one workbench renderer and reports whether it returned true. */
async function rendererTrue(url: string, expression: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Renderer notification check timed out'));
    }, TIMEOUT_MS);
    socket.once('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }),
      );
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('message', (data) => {
      clearTimeout(timer);
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data));
      const message: unknown = JSON.parse(bytes.toString('utf8'));
      socket.close();
      resolve(
        message !== null &&
          typeof message === 'object' &&
          'result' in message &&
          message.result !== null &&
          typeof message.result === 'object' &&
          'result' in message.result &&
          message.result.result !== null &&
          typeof message.result.result === 'object' &&
          'value' in message.result.result &&
          message.result.result.value === true,
      );
    });
  });
}

/** Polls every workbench renderer until the expression returns true in one of them, or fails with the message. */
async function untilRenderer(expression: string, failure: string): Promise<void> {
  const portFile = process.env.AI_PAIR_TEST_CDP_FILE;
  assert.ok(portFile !== undefined && portFile !== '', 'isolated debugger port file is missing');
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (fs.existsSync(portFile)) {
      const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
      assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535);
      const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const targets: unknown = await response.json();
      assert.ok(Array.isArray(targets));
      const entries: unknown[] = targets;
      for (const target of entries) {
        if (
          target !== null &&
          typeof target === 'object' &&
          'webSocketDebuggerUrl' in target &&
          typeof target.webSocketDebuggerUrl === 'string' &&
          target.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${port}/`)
        ) {
          // A renderer still loading may not answer; the next poll asks it again.
          if (await rendererTrue(target.webSocketDebuggerUrl, expression).catch(() => false)) return;
        }
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, INTERVAL_MS);
    });
  }
  assert.fail(failure);
}

/** Waits for the exact user-facing message in the disposable VS Code window. */
export async function expectNotification(expected: string): Promise<void> {
  await untilRenderer(
    `document.body.innerText.includes(${JSON.stringify(expected)})`,
    `The workbench did not show the expected notification: ${expected}`,
  );
}

/** Clicks a notification's button or action by its exact label or the start of its accessible name, which may add a keybinding, as the programmer would. */
export async function clickNotificationButton(label: string): Promise<void> {
  const find = `[...document.querySelectorAll('.notification-list-item a')].find((b) => b.textContent === ${JSON.stringify(label)} || (b.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(label)}))`;
  await untilRenderer(
    `(() => { const button = ${find}; button?.click(); return button !== undefined; })()`,
    `No notification button: ${label}`,
  );
}
