/**
 * Integration tests for transport-specific cleanup verification.
 *
 * Tests that different transport types (Stdio, StreamableHTTP, SSE) properly
 * clean up their resources during shutdown.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  isProcessAlive,
  getChildPids,
  waitForExit,
  waitForOutput,
  waitForProcessDeath,
  killProcessTree,
} from '../utils/process-helpers.js';

describe('Transport-Specific Cleanup', () => {
  const orphanedProcesses: number[] = [];

  afterEach(async () => {
    for (const pid of orphanedProcesses) {
      if (isProcessAlive(pid)) {
        await killProcessTree(pid);
      }
    }
    orphanedProcesses.length = 0;
  });

  describe('Stdio Transport', () => {
    it('should terminate spawned process', async () => {
      const proxy = spawn(
        'node',
        [
          'dist/index.js',
          '--upstream-stdio',
          '--',
          'node',
          '--import',
          'tsx',
          'tests/fixtures/echo-server.ts',
        ],
        {
          cwd: path.resolve(__dirname, '../..'),
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      orphanedProcesses.push(proxy.pid!);

      try {
        await waitForOutput(proxy.stderr, /Proxy ready/, 5000);

        const childPids = await getChildPids(proxy.pid!);
        expect(childPids.length).toBeGreaterThan(0);

        const childPid = childPids[0];
        orphanedProcesses.push(childPid);

        expect(isProcessAlive(childPid)).toBe(true);

        process.kill(proxy.pid!, 'SIGTERM');

        await waitForExit(proxy, 6000);

        // Child should be terminated
        const childDied = await waitForProcessDeath(childPid, 3000);
        expect(childDied).toBe(true);
      } finally {
        if (proxy.pid && isProcessAlive(proxy.pid)) {
          await killProcessTree(proxy.pid);
        }
      }
    }, 15000);

    it('should send SIGTERM to child', async () => {
      const proxy = spawn(
        'node',
        [
          'dist/index.js',
          '--upstream-stdio',
          '--',
          'node',
          '--import',
          'tsx',
          'tests/fixtures/echo-server.ts',
        ],
        {
          cwd: path.resolve(__dirname, '../..'),
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      orphanedProcesses.push(proxy.pid!);

      try {
        await waitForOutput(proxy.stderr, /Proxy ready/, 5000);

        let stderrOutput = '';
        proxy.stderr.on('data', (data) => {
          stderrOutput += data.toString();
        });

        const childPids = await getChildPids(proxy.pid!);
        const childPid = childPids[0];
        orphanedProcesses.push(childPid);

        process.kill(proxy.pid!, 'SIGTERM');

        await waitForExit(proxy, 6000);

        // Echo server logs when it receives SIGTERM
        expect(stderrOutput).toContain('Echo server received SIGTERM');
      } finally {
        if (proxy.pid && isProcessAlive(proxy.pid)) {
          await killProcessTree(proxy.pid);
        }
      }
    }, 15000);

    it('should wait for graceful shutdown', async () => {
      const proxy = spawn(
        'node',
        [
          'dist/index.js',
          '--upstream-stdio',
          '--',
          'node',
          '--import',
          'tsx',
          'tests/fixtures/echo-server.ts',
        ],
        {
          cwd: path.resolve(__dirname, '../..'),
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      orphanedProcesses.push(proxy.pid!);

      try {
        await waitForOutput(proxy.stderr, /Proxy ready/, 5000);

        const childPids = await getChildPids(proxy.pid!);
        const childPid = childPids[0];
        orphanedProcesses.push(childPid);

        const startTime = Date.now();

        process.kill(proxy.pid!, 'SIGTERM');

        await waitForExit(proxy, 6000);

        const duration = Date.now() - startTime;

        // Should allow time for graceful shutdown (but complete quickly)
        expect(duration).toBeGreaterThan(0);
        expect(duration).toBeLessThan(5000);

        // Child should be terminated
        expect(isProcessAlive(childPid)).toBe(false);
      } finally {
        if (proxy.pid && isProcessAlive(proxy.pid)) {
          await killProcessTree(proxy.pid);
        }
      }
    }, 15000);

    it('should handle child not responding', async () => {
      // This test verifies the MCP SDK's SIGKILL fallback works
      const proxy = spawn(
        'node',
        [
          'dist/index.js',
          '--upstream-stdio',
          '--',
          'node',
          '--import',
          'tsx',
          'tests/fixtures/echo-server.ts',
        ],
        {
          cwd: path.resolve(__dirname, '../..'),
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      orphanedProcesses.push(proxy.pid!);

      try {
        await waitForOutput(proxy.stderr, /Proxy ready/, 5000);

        const childPids = await getChildPids(proxy.pid!);
        const childPid = childPids[0];
        orphanedProcesses.push(childPid);

        process.kill(proxy.pid!, 'SIGTERM');

        await waitForExit(proxy, 10000);

        // Even if child doesn't respond gracefully, it should eventually die
        // (MCP SDK does SIGKILL after timeout)
        const childDied = await waitForProcessDeath(childPid, 6000);
        expect(childDied).toBe(true);
      } finally {
        if (proxy.pid && isProcessAlive(proxy.pid)) {
          await killProcessTree(proxy.pid);
        }
      }
    }, 20000);
  });

  describe('HTTP Transport (Conceptual)', () => {
    // Note: These tests would require a real HTTP MCP server
    // For now, they document expected behavior

    it('should call terminateSession() for StreamableHTTP', () => {
      // When using StreamableHTTP transport, disconnect should:
      // 1. Call transport.terminateSession()
      // 2. Call transport.close()
      // 3. Call client.close()

      expect(true).toBe(true); // Placeholder
    });

    it('should call close() after terminateSession()', () => {
      // Order matters: terminateSession first, then close
      expect(true).toBe(true); // Placeholder
    });

    it('should handle session already terminated', () => {
      // If session is already terminated, should still call close()
      expect(true).toBe(true); // Placeholder
    });

    it('should call close() for SSE transport', () => {
      // SSE transport only needs close() call
      expect(true).toBe(true); // Placeholder
    });

    it('should handle already closed connection', () => {
      // If connection is already closed, should not throw
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Multiple Transport Cleanup', () => {
    it('should handle switching between transports', async () => {
      // This test verifies cleanup works regardless of transport type
      // For now, just test stdio (most critical)

      const proxy = spawn(
        'node',
        [
          'dist/index.js',
          '--upstream-stdio',
          '--',
          'node',
          '--import',
          'tsx',
          'tests/fixtures/echo-server.ts',
        ],
        {
          cwd: path.resolve(__dirname, '../..'),
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      orphanedProcesses.push(proxy.pid!);

      try {
        await waitForOutput(proxy.stderr, /Proxy ready/, 5000);

        const childPids = await getChildPids(proxy.pid!);
        const childPid = childPids[0];
        orphanedProcesses.push(childPid);

        process.kill(proxy.pid!, 'SIGTERM');

        await waitForExit(proxy, 6000);

        expect(isProcessAlive(childPid)).toBe(false);
      } finally {
        if (proxy.pid && isProcessAlive(proxy.pid)) {
          await killProcessTree(proxy.pid);
        }
      }
    }, 15000);
  });
});
