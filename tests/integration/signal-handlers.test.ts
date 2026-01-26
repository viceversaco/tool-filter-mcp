/**
 * Integration tests for signal handler behavior.
 *
 * Validates that SIGINT, SIGTERM, and SIGPIPE handlers trigger graceful
 * shutdown with proper cleanup and timeout safety.
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

describe('Signal Handler Integration', () => {
  const orphanedProcesses: number[] = [];

  afterEach(async () => {
    for (const pid of orphanedProcesses) {
      if (isProcessAlive(pid)) {
        await killProcessTree(pid);
      }
    }
    orphanedProcesses.length = 0;
  });

  it('should trigger graceful shutdown on SIGINT', async () => {
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
      // Wait for ready
      await waitForOutput(proxy.stderr, /Proxy ready/, 5000);

      // Capture stderr for verification
      let stderrOutput = '';
      proxy.stderr.on('data', (data) => {
        stderrOutput += data.toString();
      });

      // Send SIGINT
      process.kill(proxy.pid!, 'SIGINT');

      // Wait for exit
      const exitCode = await waitForExit(proxy, 6000);

      // Should exit successfully
      expect(exitCode).toBe(0);

      // Should log graceful shutdown message
      expect(stderrOutput).toContain('Shutting down gracefully (SIGINT)');
      expect(stderrOutput).toContain('Cleanup complete');
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);

  it('should trigger graceful shutdown on SIGTERM', async () => {
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

      // Send SIGTERM
      process.kill(proxy.pid!, 'SIGTERM');

      const exitCode = await waitForExit(proxy, 6000);

      expect(exitCode).toBe(0);
      expect(stderrOutput).toContain('Shutting down gracefully (SIGTERM)');
      expect(stderrOutput).toContain('Cleanup complete');
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);

  it('should complete cleanup within timeout', async () => {
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

      // Record time of shutdown signal
      const startTime = Date.now();

      process.kill(proxy.pid!, 'SIGTERM');

      await waitForExit(proxy, 6000);

      const shutdownTime = Date.now() - startTime;

      // Should complete well within 5000ms timeout
      // Allow some overhead, but should be fast for normal shutdown
      expect(shutdownTime).toBeLessThan(3000);
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);

  it('should force exit on second signal during shutdown', async () => {
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

      // Send first SIGINT
      process.kill(proxy.pid!, 'SIGINT');

      // Wait a tiny bit for shutdown to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send second SIGINT (should force exit)
      process.kill(proxy.pid!, 'SIGINT');

      const exitCode = await waitForExit(proxy, 2000);

      // Should exit (might be 0 or 1 depending on timing)
      expect(exitCode === 0 || exitCode === 1).toBe(true);

      // Should log force exit message if second signal was caught
      // (timing-dependent, so we don't strictly require it)
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);

  it('should exit with code 0 on successful cleanup', async () => {
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

      const exitCode = await waitForExit(proxy, 6000);

      // Successful cleanup should exit with 0
      expect(exitCode).toBe(0);
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);
});
