#!/usr/bin/env node

import { ProxyOrchestrator } from './proxy.js';
import { createMCPServer } from './server.js';
import { formatStartupError } from './utils/error-handler.js';
import { formatCommandDisplay } from './utils/command-formatter.js';
import { formatToolsList } from './utils/tool-list-formatter.js';
import { createUpstreamClient, createStdioUpstreamClient, type WrappedClient } from './client.js';
import { parseCLIArgs, type CLIArgs } from './cli-args.js';
import { createProxyConfig } from './config.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Gracefully shutdown proxy and server with timeout safety.
 * Ensures cleanup completes or times out, never hangs indefinitely.
 */
async function gracefulShutdown(
  proxy: ProxyOrchestrator,
  server: Server,
  timeoutMs: number = 5000
): Promise<void> {
  const shutdownPromise = (async () => {
    const errors: string[] = [];

    // Shutdown proxy (disconnects upstream)
    try {
      await proxy.shutdown();
    } catch (error) {
      errors.push(`Proxy: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Close MCP server
    try {
      await server.close();
    } catch (error) {
      errors.push(`Server: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (errors.length > 0) {
      throw new Error(`Cleanup errors: ${errors.join('; ')}`);
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Shutdown timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  await Promise.race([shutdownPromise, timeoutPromise]);
}

async function listToolsMode(args: CLIArgs): Promise<void> {
  let upstreamClient: WrappedClient | null = null;

  try {
    const config = createProxyConfig(args);

    // Create upstream client based on config mode
    if (config.mode === 'http') {
      console.error(`Connecting to upstream MCP at ${config.upstreamUrl}...`);
      upstreamClient = await createUpstreamClient(config.upstreamUrl, config.headers);
    } else {
      const commandDisplay = formatCommandDisplay(config.upstreamCommand, config.upstreamArgs);
      console.error(`Connecting to upstream MCP via stdio: ${commandDisplay}...`);
      upstreamClient = await createStdioUpstreamClient(config.upstreamCommand, config.upstreamArgs, config.env);
    }
    await upstreamClient.connect()

    console.error('Fetching tools from upstream...');

    const result = await upstreamClient.listTools();
    let tools = result.tools;

    // Apply filtering if deny patterns are provided
    if (config.denyPatterns.length > 0) {
      const patterns = config.denyPatterns.map((pattern) => new RegExp(pattern));
      tools = tools.filter((tool) => {
        return !patterns.some((pattern) => pattern.test(tool.name));
      });
      console.error(`Applied ${config.denyPatterns.length} filter pattern(s)`);
    }

    // Output to stdout (not stderr) so it can be piped/redirected
    const formatted = formatToolsList(tools, args.format || 'table');
    // eslint-disable-next-line no-console
    console.log(formatted);
  } catch (error) {
    const errorMessage = formatStartupError(error);
    console.error(`Error: ${errorMessage}`);
    process.exit(1);
  } finally {
    if (upstreamClient) {
      try {
        await upstreamClient.disconnect();
      } catch (error) {
        console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function main(): Promise<void> {
  try {
    const args = parseCLIArgs();

    // Handle list-tools mode
    if (args.listTools) {
      await listToolsMode(args);
      return;
    }

    const config = createProxyConfig(args);

    // Create upstream client based on config mode
    let upstreamClient: WrappedClient;

    if (config.mode === 'http') {
      console.error(`Connecting to upstream MCP at ${config.upstreamUrl}...`);
      upstreamClient = await createUpstreamClient(config.upstreamUrl, config.headers);
    } else {
      const commandDisplay = formatCommandDisplay(config.upstreamCommand, config.upstreamArgs);
      console.error(`Connecting to upstream MCP via stdio: ${commandDisplay}...`);
      upstreamClient = await createStdioUpstreamClient(config.upstreamCommand, config.upstreamArgs, config.env);
    }

    const proxy = new ProxyOrchestrator(config, upstreamClient);
    try {
      await proxy.startup();
    } catch (error) {
      upstreamClient.disconnect();
      throw error;
    }

    const filteredTools = proxy.getCachedTools();
    console.error(
      `Proxy ready. Filtered ${filteredTools.length} tools from upstream.`
    );

    if (config.denyPatterns.length > 0) {
      console.error(`Deny patterns: ${config.denyPatterns.join(', ')}`);
    }

    if (config.mode === 'http' && config.headers && Object.keys(config.headers).length > 0) {
      console.error(`Custom headers: ${Object.keys(config.headers).join(', ')}`);
    }

    const server = await createMCPServer(proxy);

    console.error('MCP proxy server running on stdio');
    console.error('Press Ctrl+C to stop');

    let isShuttingDown = false;  // Prevent concurrent shutdown
    let parentMonitor: NodeJS.Timeout | null = null;  // Parent death monitor

    const handleShutdown = (signal: string) => {
      // Clear parent monitor if running
      if (parentMonitor !== null) {
        clearInterval(parentMonitor);
        parentMonitor = null;
      }

      if (isShuttingDown) {
        // Second signal during shutdown = force exit
        console.error(`\nForce exit (${signal} during shutdown)`);
        process.exit(1);
      }

      isShuttingDown = true;
      console.error(`\nShutting down gracefully (${signal})...`);

      gracefulShutdown(proxy, server, 5000)
        .then(() => {
          console.error('Cleanup complete');
          process.exit(0);
        })
        .catch((error) => {
          console.error(`Cleanup error or timeout: ${(error as Error).message}`);
          process.exit(1);  // Exit 1 on cleanup failure/timeout
        });
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGHUP', () => handleShutdown('SIGHUP'));

    // Handle parent closing stdio pipe
    process.on('SIGPIPE', () => {
      if (!isShuttingDown) {
        isShuttingDown = true;
        if (parentMonitor !== null) {
          clearInterval(parentMonitor);
          parentMonitor = null;
        }
        // Silent exit - stderr may be closed
        gracefulShutdown(proxy, server, 2000).finally(() => process.exit(0));
      }
    });

    // Monitor parent process ID to detect parent death
    // When parent dies, child gets reparented to init (ppid changes)
    const originalPPID = process.ppid;
    parentMonitor = setInterval(() => {
      if (process.ppid !== originalPPID) {
        console.error(`\nParent process died (PPID: ${originalPPID} → ${process.ppid})`);
        clearInterval(parentMonitor!);
        parentMonitor = null;

        if (!isShuttingDown) {
          isShuttingDown = true;
          // Shorter timeout since parent is already gone
          gracefulShutdown(proxy, server, 2000).finally(() => process.exit(0));
        }
      }
    }, 1000);  // Check every second
  } catch (error) {
    const errorMessage = formatStartupError(error);
    console.error(`Error: ${errorMessage}`);
    process.exit(1);
  }
}

void main();
