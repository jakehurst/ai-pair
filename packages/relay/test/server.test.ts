// The relay's MCP server on its own: createServer, serve, and their helpers. Solitary: the MCP SDK's McpServer, the
// link, the guides, the rendering, the tool table, the protocol's AI Pair home, and the home folder are mocks, so a
// test calls a tool's handler as the SDK would, and sees what the server asked of each.

import { ok } from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILE_CONTENT_SCHEMA, REPORT_SCHEMA, type FileContent, type Report } from '@ai-pair/protocol';
import { readGuides, renderGuides } from '../src/guide';
import { EditorLink, RelayError } from '../src/link';
import { renderFile, renderReport } from '../src/render';
import { agentGuide, createServer, INSTRUCTIONS, MAX_ANSWERED, serve, startPrompt } from '../src/server';
import { TOOLS } from '../src/tools';

/** A report with nothing in it, built by its schema, so the fake can't drift from what the editor sends. */
const EMPTY_REPORT: Report = REPORT_SCHEMA.parse({ batches: [], events: [], turn: 'agent' });

/** A file as `read` answers, built by its schema. */
const FILE: FileContent = FILE_CONTENT_SCHEMA.parse({ file: 'a.ts', dirty: false, lines: [{ number: 1, text: 'x' }] });

/** The tools the server registers, in order. */
const TOOL_NAMES = ['start', 'step', 'listen', 'end', 'read', 'calibrate'] as const;

/** The fakes the mocked modules hand out, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** The SDK's server, faked: it records each tool and the prompt, and what reaches the transport it connects. */
  class FakeMcpServer {
    /** Every one made, in order. */
    static readonly made: FakeMcpServer[] = [];
    readonly tools = new Map<string, { config: unknown; handler: ToolHandler }>();
    prompt: { name: string; config: unknown; handler: PromptHandler } | undefined;
    /** What reached the transport's handler that `connect` set. */
    readonly received: unknown[] = [];
    /** Every transport `connect` was given. */
    readonly connected: Transport[] = [];
    /** Whether `connect` sets the transport's handler, as the SDK does. */
    setsHandler = true;
    readonly server = { getClientCapabilities: vi.fn(), listRoots: vi.fn() };
    readonly close = vi.fn(() => Promise.resolve());
    readonly connect = vi.fn((transport: Transport) => {
      this.connected.push(transport);
      if (this.setsHandler) {
        // A Transport has only this one handler, which the SDK sets in connect().
        // oxlint-disable-next-line unicorn/prefer-add-event-listener
        transport.onmessage = (message) => {
          this.received.push(message);
        };
      }
      return Promise.resolve();
    });

    constructor(
      readonly info: unknown,
      readonly options: unknown,
    ) {
      FakeMcpServer.made.push(this);
    }

    registerTool(name: string, config: unknown, handler: ToolHandler): void {
      this.tools.set(name, { config, handler });
    }

    registerPrompt(name: string, config: unknown, handler: PromptHandler): void {
      this.prompt = { name, config, handler };
    }
  }

  /** The link, faked: each method a mock the test answers. */
  class FakeEditorLink {
    /** Every one made, in order. */
    static readonly made: FakeEditorLink[] = [];
    readonly call = vi.fn<EditorLink['call']>();
    readonly locate = vi.fn<EditorLink['locate']>();
    readonly workspace = vi.fn<EditorLink['workspace']>();
    readonly handBack = vi.fn<EditorLink['handBack']>();
    readonly close = vi.fn<EditorLink['close']>();

    constructor(
      readonly cwd: string,
      readonly dir: string,
    ) {
      FakeEditorLink.made.push(this);
    }
  }

  /** The link's error, whose code the server reads. */
  class FakeRelayError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  return { FakeMcpServer, FakeEditorLink, FakeRelayError };
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({ McpServer: fakes.FakeMcpServer }));
vi.mock('../src/link', () => ({ EditorLink: fakes.FakeEditorLink, RelayError: fakes.FakeRelayError }));
vi.mock('../src/guide', () => ({ readGuides: vi.fn(() => []), renderGuides: vi.fn(() => 'the rules') }));
vi.mock('../src/render', () => ({ renderFile: vi.fn(() => 'the file'), renderReport: vi.fn(() => 'the report') }));
vi.mock('../src/tools', () => ({
  TOOLS: {
    start: 'start schema',
    step: 'step schema',
    listen: 'listen schema',
    end: 'end schema',
    read: 'read schema',
    calibrate: 'calibrate schema',
  },
}));
vi.mock(import('@ai-pair/protocol'), async (importOriginal) => ({
  ...(await importOriginal()),
  aiPairHome: vi.fn(() => '/home/me/.ai-pair'),
}));
vi.mock('node:os', () => ({ homedir: vi.fn(() => '/home/me') }));

/** A tool's handler, as the SDK calls it. */
type ToolHandler = (args: Record<string, unknown>, extra: { signal: AbortSignal; requestId: RequestId }) => Promise<CallToolResult>;

/** The prompt's handler. */
type PromptHandler = (args: { task?: string }) => { messages: Array<{ content: { text: string } }> };

/** A server under test: what `createServer` returned, the fake SDK server inside it, and the link it was given. */
interface Built {
  server: ReturnType<typeof createServer>;
  sdk: InstanceType<typeof fakes.FakeMcpServer>;
  link: InstanceType<typeof fakes.FakeEditorLink>;
}

/** Builds a server from `cwd` on a link (the fake one, at runtime), and returns it with what it was built on. */
function build(cwd = '/project/src'): Built {
  const link = new EditorLink(cwd, '/discovery');
  const server = createServer(link, 'THE GUIDE', cwd);
  const sdk = fakes.FakeMcpServer.made.at(-1);
  ok(sdk);
  const fake = fakes.FakeEditorLink.made.at(-1);
  ok(fake);
  return { server, sdk, link: fake };
}

/** Calls the tool `name` as the SDK would: with its arguments, a signal, and the request's id. */
function call(
  sdk: Built['sdk'],
  name: string,
  args: Record<string, unknown> = {},
  { requestId = 1, signal = new AbortController().signal }: { requestId?: RequestId; signal?: AbortSignal } = {},
): Promise<CallToolResult> {
  const tool = sdk.tools.get(name);
  ok(tool);
  return tool.handler(args, { requestId, signal });
}

/** Returns a result's texts, in order. */
function texts(result: CallToolResult): string[] {
  return result.content.map((c) => (c.type === 'text' ? c.text : ''));
}

/** Returns the notification a harness sends to cancel request `requestId`. */
function cancel(requestId: unknown): JSONRPCMessage {
  return { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  fakes.FakeMcpServer.made.length = 0;
});

describe('createServer', () => {
  it('registers the six tools with their schemas from the tool table, and the start prompt', () => {
    const { sdk } = build();
    // The version is the build's define; vitest.config.ts defines "test".
    expect(sdk.info).toEqual({ name: 'ai-pair', version: 'test' });
    expect(sdk.options).toEqual({ instructions: INSTRUCTIONS });
    expect([...sdk.tools.keys()]).toEqual(TOOL_NAMES);
    for (const name of TOOL_NAMES) {
      expect(sdk.tools.get(name)?.config).toBe(TOOLS[name]);
    }
    expect(sdk.prompt?.name).toBe('start');
    expect(sdk.prompt?.handler({ task: 'a todos API' }).messages[0]?.content.text).toBe(startPrompt('a todos API'));
  });

  it("renders a tool's report from the link's answer", async () => {
    const { sdk, link } = build();
    vi.mocked(link.call).mockResolvedValueOnce(EMPTY_REPORT);
    const signal = new AbortController().signal;
    expect(texts(await call(sdk, 'listen', {}, { signal }))).toEqual(['the report']);
    expect(link.call).toHaveBeenCalledWith('listen', {}, signal);
    const [report, tool] = vi.mocked(renderReport).mock.lastCall ?? [];
    expect(REPORT_SCHEMA.parse(report)).toEqual(EMPTY_REPORT);
    expect(tool).toBe('listen');
  });

  it("renders `read`'s file, and answers an answer that fits no schema as an internal error", async () => {
    const { sdk, link } = build();
    vi.mocked(link.call).mockResolvedValueOnce(FILE);
    expect(texts(await call(sdk, 'read', { file: 'a.ts' }))).toEqual(['the file']);
    expect(FILE_CONTENT_SCHEMA.parse(vi.mocked(renderFile).mock.lastCall?.[0])).toEqual(FILE);
    vi.mocked(link.call).mockResolvedValueOnce({ nothing: true });
    const bad = await call(sdk, 'listen');
    expect(bad.isError).toBe(true);
    expect(texts(bad)[0]).toMatch(/^internal: /);
  });

  it("answers a failure as its code and message: a RelayError's code, else `internal`", async () => {
    const { sdk, link } = build();
    vi.mocked(link.call)
      .mockRejectedValueOnce(new RelayError('no_editor', 'No window has it open.'))
      .mockRejectedValueOnce(new TypeError('boom'))
      .mockRejectedValueOnce('plain text');
    expect(texts(await call(sdk, 'listen'))).toEqual(['no_editor: No window has it open.']);
    expect(texts(await call(sdk, 'listen'))).toEqual(['internal: boom']);
    expect(texts(await call(sdk, 'listen'))).toEqual(['internal: plain text']);
  });

  it('passes `step`, `end`, and `calibrate` to the link by name, with their arguments', async () => {
    const { sdk, link } = build();
    link.call.mockResolvedValue(EMPTY_REPORT);
    for (const name of ['step', 'end', 'calibrate']) {
      const signal = new AbortController().signal;
      expect(texts(await call(sdk, name, { given: name }, { signal }))).toEqual(['the report']);
      expect(link.call).toHaveBeenLastCalledWith(name, { given: name }, signal);
    }
  });

  it("starts in the folder the agent gives, then the harness's roots, then its own, with the guides it finds", async () => {
    const { sdk, link } = build();
    sdk.server.getClientCapabilities.mockReturnValueOnce({ roots: {} });
    sdk.server.listRoots.mockResolvedValueOnce({ roots: [{ uri: 'file:///root/a' }, { uri: 'https://example.com/b' }] });
    vi.mocked(link.locate).mockReturnValueOnce('/given');
    vi.mocked(link.workspace).mockReturnValueOnce({ folder: '/given', root: '/given' });
    const guides = [{ file: '/home/me/.ai-pair/GUIDE.md', text: 'Say hello.' }];
    vi.mocked(readGuides).mockReturnValueOnce(guides);
    vi.mocked(link.call).mockResolvedValueOnce(EMPTY_REPORT);
    const signal = new AbortController().signal;
    const result = await call(sdk, 'start', { cwd: '/given', task: 'a todos API' }, { signal });
    expect(texts(result)).toEqual(['the report', '# Pairing guide\n\nTHE GUIDE', 'the rules']);
    expect(sdk.server.listRoots).toHaveBeenCalledWith(undefined, { timeout: 2000 });
    expect(link.locate).toHaveBeenCalledWith(['/given', '/root/a', '/project/src']);
    expect(readGuides).toHaveBeenCalledWith('/home/me/.ai-pair', '/given', '/given');
    expect(link.call).toHaveBeenCalledWith('start', { task: 'a todos API', cwd: '/given', rules: ['~/.ai-pair/GUIDE.md'] }, signal);
    const [shown, show] = vi.mocked(renderGuides).mock.lastCall ?? [];
    expect(shown).toBe(guides);
    expect(show?.('/elsewhere/GUIDE.md')).toBe('/elsewhere/GUIDE.md');
  });

  it('leaves out a folder that is not absolute, the roots of a harness that has none or fails to list them, and rules with no guides', async () => {
    const { sdk, link } = build();
    vi.mocked(link.locate).mockReturnValue('/project/src');
    vi.mocked(link.workspace).mockReturnValue({ folder: '/project/src', root: '/project' });
    vi.mocked(link.call).mockResolvedValue(EMPTY_REPORT);
    expect(texts(await call(sdk, 'start', { cwd: 'relative' }))).toEqual(['the report', '# Pairing guide\n\nTHE GUIDE']);
    expect(link.locate).toHaveBeenLastCalledWith(['/project/src']);
    sdk.server.getClientCapabilities.mockReturnValueOnce({ roots: {} });
    sdk.server.listRoots.mockRejectedValueOnce(new Error('no roots today'));
    await call(sdk, 'start');
    expect(link.locate).toHaveBeenLastCalledWith(['/project/src']);
  });
});

describe('a cancel after its answer', () => {
  it('DroppedHandedBack: hands back an answered report once, and passes every message on to the SDK (#67)', async () => {
    const { server, sdk, link } = build();
    const transport: Transport = { start: () => Promise.resolve(), send: () => Promise.resolve(), close: () => Promise.resolve() };
    await server.connect(transport);
    const report = REPORT_SCHEMA.parse({ batches: [], events: [{ kind: 'interrupt' }], turn: 'agent' });
    vi.mocked(link.call).mockResolvedValueOnce(report);
    await call(sdk, 'listen', {}, { requestId: 7 });
    transport.onmessage?.(cancel(7));
    transport.onmessage?.(cancel(7));
    expect(link.handBack).toHaveBeenCalledTimes(1);
    expect(link.handBack).toHaveBeenCalledWith(report);
    expect(sdk.received).toEqual([cancel(7), cancel(7)]);
  });

  it("keeps no answer to `read`, to a call aborted before its answer, or for a cancel with an id it doesn't know", async () => {
    const { server, sdk, link } = build();
    const transport: Transport = { start: () => Promise.resolve(), send: () => Promise.resolve(), close: () => Promise.resolve() };
    await server.connect(transport);
    vi.mocked(link.call).mockResolvedValueOnce(FILE).mockResolvedValueOnce(EMPTY_REPORT);
    await call(sdk, 'read', { file: 'a.ts' }, { requestId: 1 });
    const aborted = new AbortController();
    aborted.abort();
    await call(sdk, 'listen', {}, { requestId: 2, signal: aborted.signal });
    for (const id of [1, 2, { not: 'an id' }]) {
      transport.onmessage?.(cancel(id));
    }
    expect(link.handBack).not.toHaveBeenCalled();
  });

  it('keeps the last MAX_ANSWERED answers: a cancel for an older one hands nothing back', async () => {
    const { server, sdk, link } = build();
    const transport: Transport = { start: () => Promise.resolve(), send: () => Promise.resolve(), close: () => Promise.resolve() };
    await server.connect(transport);
    vi.mocked(link.call).mockImplementation(() => Promise.resolve(REPORT_SCHEMA.parse(EMPTY_REPORT)));
    for (let id = 1; id <= MAX_ANSWERED + 1; id++) {
      await call(sdk, 'listen', {}, { requestId: id });
    }
    transport.onmessage?.(cancel(1));
    expect(link.handBack).not.toHaveBeenCalled();
    transport.onmessage?.(cancel(MAX_ANSWERED + 1));
    expect(link.handBack).toHaveBeenCalledTimes(1);
  });

  it('hands back the report on a transport the SDK set no handler on', async () => {
    const { server, sdk, link } = build();
    sdk.setsHandler = false;
    const transport: Transport = { start: () => Promise.resolve(), send: () => Promise.resolve(), close: () => Promise.resolve() };
    await server.connect(transport);
    link.call.mockResolvedValueOnce(EMPTY_REPORT);
    await call(sdk, 'listen', {}, { requestId: 3 });
    transport.onmessage?.(cancel(3));
    expect(link.handBack).toHaveBeenCalledWith(EMPTY_REPORT);
    expect(sdk.received).toEqual([]);
  });

  it('passes on a message that is not a cancel, and a cancel with no params, handing nothing back', async () => {
    const { server, sdk, link } = build();
    const transport: Transport = { start: () => Promise.resolve(), send: () => Promise.resolve(), close: () => Promise.resolve() };
    await server.connect(transport);
    link.call.mockResolvedValueOnce(EMPTY_REPORT);
    await call(sdk, 'listen', {}, { requestId: 4 });
    const messages: JSONRPCMessage[] = [
      { jsonrpc: '2.0', id: 4, method: 'tools/list' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/cancelled' },
    ];
    for (const message of messages) {
      transport.onmessage?.(message);
    }
    expect(link.handBack).not.toHaveBeenCalled();
    expect(sdk.received).toEqual(messages);
  });
});

describe('agentGuide', () => {
  it('is everything after the first horizontal rule, whatever the line endings', () => {
    const lf = '# Agent Guide\n\nFor maintainers.\n\n---\n\n## You are pair programming\n\nDrive.\n';
    expect(agentGuide(lf)).toBe('## You are pair programming\n\nDrive.');
    expect(agentGuide(lf.replaceAll('\n', '\r\n'))).toBe('## You are pair programming\r\n\r\nDrive.');
  });

  it('is the whole text, trimmed, when there is no horizontal rule', () => {
    expect(agentGuide('\n## Drive\n')).toBe('## Drive');
  });
});

describe('startPrompt', () => {
  it('gives the task, trimmed', () => {
    expect(startPrompt('  a todos API ')).toMatch(/The task: a todos API\n/);
  });

  it("asks what we're working on when there is no task, or a blank one", () => {
    expect(startPrompt()).toMatch(/Ask me what we're working on/);
    expect(startPrompt('  ')).toMatch(/Ask me what we're working on/);
  });
});

describe('serve', () => {
  it('ExitsAfterShutdown: connects, and once stdin ends, closes the server and then the link (#163)', async () => {
    const transport: Transport = { start: () => Promise.resolve(), send: () => Promise.resolve(), close: () => Promise.resolve() };
    // The stdio transport reads stdin, so it flows, and its end is seen.
    const stdin = new PassThrough().resume();
    const served = serve({ transport, guide: 'THE GUIDE', cwd: '/project/src', dir: '/discovery', stdin });
    const sdk = fakes.FakeMcpServer.made.at(-1);
    const link = fakes.FakeEditorLink.made.at(-1);
    ok(sdk && link);
    expect([link.cwd, link.dir]).toEqual(['/project/src', '/discovery']);
    await vi.waitFor(() => {
      expect(sdk.connected).toEqual([transport]);
    });
    expect(sdk.close).not.toHaveBeenCalled();
    stdin.end();
    await served;
    const [closedServer] = sdk.close.mock.invocationCallOrder;
    const [closedLink] = link.close.mock.invocationCallOrder;
    ok(closedServer !== undefined && closedLink !== undefined);
    expect(closedServer).toBeLessThan(closedLink);
  });
});
