#!/usr/bin/env node

/**
 * Simple MCP server for testing stdio transport cleanup.
 * Provides a single "echo" tool that echoes back the input message.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'echo-test-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Echo test tool',
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message to echo back',
          },
        },
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'echo') {
    const message = (args?.message as string) || '';
    return {
      content: [
        {
          type: 'text',
          text: `Echo: ${message}`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start the server
const transport = new StdioServerTransport();

async function main() {
  await server.connect(transport);

  // Log PID for test verification (to stderr so it doesn't interfere with MCP protocol)
  console.error(`Echo server started (PID: ${process.pid})`);

  // Handle cleanup signals
  process.on('SIGINT', async () => {
    console.error('Echo server received SIGINT, shutting down...');
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('Echo server received SIGTERM, shutting down...');
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Echo server error:', error);
  process.exit(1);
});
