// pair-mcp: the MCP server the agent harness launches. It forwards tool calls to the editor.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { discoveryDir } from '@ai-pair/protocol';
import guideMarkdown from '../../../AGENT_GUIDE.md';
import { EditorLink } from './link';
import { agentGuide, createServer } from './server';

async function main(): Promise<void> {
  const cwd = process.cwd();
  const server = createServer(new EditorLink(cwd, discoveryDir()), agentGuide(guideMarkdown), cwd);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
