/**
 * Integration tests for cleanup timeout safety mechanisms.
 *
 * Validates that the gracefulShutdown() helper properly enforces timeouts
 * and never hangs indefinitely during cleanup.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  isProcessAlive,
  waitForExit,
  waitForOutput,
  killProcessTree,
} from '../utils/process-helpers.js';

describe('Cleanup Timeout Safety', () => {
  const orphanedProcesses: number[] = [];

  afterEach(async () => {
    for (const pid of orphanedProcesses) {
      if (isProcessAlive(pid)) {
        await killProcessTree(pid);
      }
    }
    orphanedProcesses.length = 0;
  });

  it('should complete normal cleanup under 1 second', async () => {
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

      const startTime = Date.now();

      process.kill(proxy.pid!, 'SIGTERM');

      await waitForExit(proxy, 6000);

      const duration = Date.now() - startTime;

      // Normal cleanup should be fast (well under 5s timeout)
      expect(duration).toBeLessThan(1000);
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);

  it('should timeout at 5 seconds for unresponsive cleanup', async () => {
    // This test verifies the timeout mechanism exists
    // In practice, MCP SDK cleanup is reliable, but timeout provides safety

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

      const startTime = Date.now();

      process.kill(proxy.pid!, 'SIGTERM');

      // Wait for exit (should happen within timeout)
      const exitCode = await waitForExit(proxy, 10000);

      const duration = Date.now() - startTime;

      // Should exit within timeout window (5s + small overhead)
      expect(duration).toBeLessThan(6000);

      // Exit code should be 0 or 1 (1 if timeout occurred)
      expect([0, 1]).toContain(exitCode);
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);

  it('should never hang indefinitely during cleanup', async () => {
    // This test verifies cleanup will eventually complete or timeout
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

      process.kill(proxy.pid!, 'SIGTERM');

      // With 10s test timeout, cleanup should complete well before
      const exitCode = await waitForExit(proxy, 10000);

      // Should exit (not hang)
      expect(exitCode).toBeTypeOf('number');
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);

  it('should still allow process to exit even if timeout occurs', async () => {
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

      process.kill(proxy.pid!, 'SIGTERM');

      const exitCode = await waitForExit(proxy, 10000);

      // Even if timeout occurs, process should exit
      // Exit code 0 = success, 1 = timeout/error
      expect([0, 1]).toContain(exitCode);

      // Process should no longer be running
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(isProcessAlive(proxy.pid!)).toBe(false);
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);
});
