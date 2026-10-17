// pair-mcp: the MCP server the agent harness launches. It forwards tool calls to the editor.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { discoveryDir } from '@ai-pair/protocol';
import guideMarkdown from '../../../AGENT_GUIDE.md';
import { agentGuide, serve } from './server';

const cwd = process.cwd();
serve({
  transport: new StdioServerTransport(),
  guide: agentGuide(guideMarkdown),
  cwd,
  dir: discoveryDir(),
  stdin: process.stdin,
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
