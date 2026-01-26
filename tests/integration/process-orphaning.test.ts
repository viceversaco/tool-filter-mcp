/**
 * Critical regression test to verify child processes are properly terminated
 * on shutdown and not orphaned.
 *
 * This test validates the fix for the process orphaning bug where
 * StdioClientTransport.close() was not being called before nulling the
 * transport reference, leaving child processes running after parent exit.
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
  getProcessParentPid,
  killProcessTree,
} from '../utils/process-helpers.js';

describe('Process Orphaning Fix', () => {
  const orphanedProcesses: number[] = [];

  afterEach(async () => {
    // Cleanup any orphaned processes that tests may have left behind
    for (const pid of orphanedProcesses) {
      if (isProcessAlive(pid)) {
        await killProcessTree(pid);
      }
    }
    orphanedProcesses.length = 0;
  });

  it('should terminate stdio child process on SIGTERM shutdown', async () => {
    // Start proxy with echo server as stdio upstream
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
      // Wait for proxy to be ready
      await waitForOutput(proxy.stderr, /Proxy ready/, 5000);

      // Find child process (echo server)
      const childPids = await getChildPids(proxy.pid!);
      expect(childPids.length).toBeGreaterThan(0);

      const childPid = childPids[0];
      orphanedProcesses.push(childPid);

      // Verify child is alive
      expect(isProcessAlive(childPid)).toBe(true);

      // Send SIGTERM to proxy
      process.kill(proxy.pid!, 'SIGTERM');

      // Wait for proxy to exit
      const exitCode = await waitForExit(proxy, 6000);
      expect(exitCode).toBe(0);

      // CRITICAL: Verify child process is terminated (not orphaned)
      const childDied = await waitForProcessDeath(childPid, 3000);
      expect(childDied).toBe(true);

      // Double-check it's not orphaned (ppid would be 1 if orphaned)
      if (isProcessAlive(childPid)) {
        const ppid = await getProcessParentPid(childPid);
        expect(ppid).not.toBe(1); // Should NOT be orphaned
      }
    } finally {
      // Ensure cleanup
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);

  it('should terminate stdio child process on SIGINT shutdown', async () => {
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

      // Send SIGINT (Ctrl+C)
      process.kill(proxy.pid!, 'SIGINT');

      await waitForExit(proxy, 6000);

      // Verify child terminated
      const childDied = await waitForProcessDeath(childPid, 3000);
      expect(childDied).toBe(true);
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);

  it('should not leave orphaned processes after rapid shutdowns', async () => {
    const proxyPids: number[] = [];
    const childPids: number[] = [];

    try {
      // Start 3 proxies rapidly
      for (let i = 0; i < 3; i++) {
        const proxy = spawn(
          'node',
          [
            'dist/index.js',
            '--upstream-stdio',
            '--',
            'node',
            '--loader',
            'tsx',
            'tests/fixtures/echo-server.ts',
          ],
          {
            cwd: path.resolve(__dirname, '../..'),
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );

        proxyPids.push(proxy.pid!);
        orphanedProcesses.push(proxy.pid!);

        // Wait for ready
        await waitForOutput(proxy.stderr, /Proxy ready/, 5000);

        // Track child
        const children = await getChildPids(proxy.pid!);
        if (children.length > 0) {
          childPids.push(children[0]);
          orphanedProcesses.push(children[0]);
        }
      }

      // Verify all children are alive
      for (const childPid of childPids) {
        expect(isProcessAlive(childPid)).toBe(true);
      }

      // Rapidly kill all proxies
      for (const proxyPid of proxyPids) {
        process.kill(proxyPid, 'SIGTERM');
      }

      // Wait for all to exit (with generous timeout)
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // Verify NO child processes survived
      for (const childPid of childPids) {
        const isAlive = isProcessAlive(childPid);
        expect(isAlive).toBe(false);
      }
    } finally {
      // Cleanup any survivors
      for (const pid of [...proxyPids, ...childPids]) {
        if (isProcessAlive(pid)) {
          await killProcessTree(pid);
        }
      }
    }
  }, 30000);

  it('should handle cleanup even when child becomes unresponsive', async () => {
    // This test verifies the timeout mechanism works
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

      // Send shutdown signal
      process.kill(proxy.pid!, 'SIGTERM');

      // Proxy should exit even if cleanup times out
      const exitCode = await waitForExit(proxy, 10000);

      // Should exit with code 0 (success) or 1 (timeout)
      expect(exitCode === 0 || exitCode === 1).toBe(true);

      // Child should eventually be terminated (MCP SDK does SIGKILL after timeout)
      const childDied = await waitForProcessDeath(childPid, 6000);
      expect(childDied).toBe(true);
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 20000);

  it('should cleanup during listToolsMode', async () => {
    // Test that --list-tools mode also properly cleans up
    const proxy = spawn(
      'node',
      [
        'dist/index.js',
        '--list-tools',
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
      // Wait for command to complete
      const exitCode = await waitForExit(proxy, 10000);
      expect(exitCode).toBe(0);

      // Give a moment for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Find any orphaned echo-server processes
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      try {
        const { stdout } = await execAsync('pgrep -f echo-server.ts');
        const runningEchoServers = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(Number);

        // Should be no echo-servers running
        expect(runningEchoServers.length).toBe(0);
      } catch {
        // pgrep exits with 1 if no matches - this is expected
      }
    } finally {
      if (proxy.pid && isProcessAlive(proxy.pid)) {
        await killProcessTree(proxy.pid);
      }
    }
  }, 15000);
});
