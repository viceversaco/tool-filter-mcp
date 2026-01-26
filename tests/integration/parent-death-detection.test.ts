import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isProcessAlive,
  waitForProcessDeath,
  waitForOutput,
  killProcessTree,
} from '../utils/process-helpers.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DIST_DIR = join(__dirname, '../../dist');
const FIXTURES_DIR = join(__dirname, '../fixtures');

/**
 * Integration tests for parent death detection mechanisms.
 *
 * These tests verify that tool-filter-mcp properly detects and responds
 * to parent process termination, preventing process orphaning.
 */
describe('Parent Death Detection', () => {
  /**
   * Test PPID monitoring mechanism.
   * Spawns a Node.js parent that spawns tool-filter-mcp, then kills the parent.
   * Verifies tool-filter-mcp detects parent death via PPID change and exits.
   *
   * This simulates the real scenario where OpenCode worker spawns tool-filter-mcp.
   */
  it('orphaning - detects parent death via PPID monitoring', async () => {
    // Create a Node.js parent process that spawns tool-filter-mcp
    // This simulates how OpenCode worker spawns tool-filter-mcp as a direct child
    const parentScript = `
const { spawn } = require('node:child_process');

const child = spawn('node', [
  '${DIST_DIR}/index.js',
  '--upstream-stdio',
  '--',
  'npx',
  'tsx',
  '${FIXTURES_DIR}/echo-server.ts'
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

console.error('PARENT_CHILD_PID:' + child.pid);

// Forward child output
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

// Keep parent alive until killed
setInterval(() => {}, 1000);
`;

    const tmpParent = '/tmp/tool-filter-mcp-parent-test.js';
    await import('node:fs/promises').then(fs =>
      fs.writeFile(tmpParent, parentScript)
    );

    let parentProc: ChildProcess | null = null;
    let toolFilterPid: number | null = null;

    try {
      // Spawn parent process
      parentProc = spawn('node', [tmpParent], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Extract tool-filter-mcp PID from parent output
      const pidMatch = await waitForOutput(
        parentProc,
        /PARENT_CHILD_PID:(\d+)/,
        5000
      );
      assert.ok(pidMatch, 'Failed to get tool-filter-mcp PID from parent');
      toolFilterPid = parseInt(pidMatch[1], 10);

      // Wait for tool-filter-mcp to fully start
      await waitForOutput(parentProc, /Proxy ready/, 5000);

      // Verify correct parent-child relationship
      const ppid = await import('node:child_process').then(({ execSync }) =>
        parseInt(execSync(`ps -o ppid= -p ${toolFilterPid}`, { encoding: 'utf-8' }).trim(), 10)
      );
      assert.strictEqual(ppid, parentProc.pid, 'tool-filter-mcp should be child of parent process');

      // Verify processes are alive
      assert.ok(isProcessAlive(parentProc.pid!), 'Parent should be alive');
      assert.ok(isProcessAlive(toolFilterPid), 'tool-filter-mcp should be alive');

      // Kill parent (simulates OpenCode worker dying)
      process.kill(parentProc.pid!, 'SIGKILL');

      // tool-filter-mcp should detect parent death and exit within reasonable time
      // (1 second PPID check interval + 2 second cleanup + buffer)
      const died = await waitForProcessDeath(toolFilterPid, 5000);
      assert.ok(died, 'tool-filter-mcp should exit when parent dies');

      // Verify no orphaned tool-filter-mcp process
      const stillAlive = isProcessAlive(toolFilterPid);
      assert.strictEqual(stillAlive, false, 'tool-filter-mcp should not be orphaned');

    } finally {
      // Cleanup
      if (toolFilterPid && isProcessAlive(toolFilterPid)) {
        killProcessTree(toolFilterPid);
      }
      if (parentProc?.pid && isProcessAlive(parentProc.pid)) {
        killProcessTree(parentProc.pid);
      }
      // Clean up temp file
      try {
        await import('node:fs/promises').then(fs => fs.unlink(tmpParent));
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  /**
   * Test SIGHUP signal handler.
   * Sends SIGHUP to tool-filter-mcp and verifies graceful shutdown.
   */
  it('signal - handles SIGHUP gracefully', async () => {
    let proc: ChildProcess | null = null;

    try {
      // Spawn tool-filter-mcp with stdio upstream
      proc = spawn(
        'node',
        [
          `${DIST_DIR}/index.js`,
          '--upstream-stdio',
          '--',
          'npx',
          'tsx',
          `${FIXTURES_DIR}/echo-server.ts`,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      // Wait for startup
      await waitForOutput(proc, /Proxy ready/, 5000);
      assert.ok(isProcessAlive(proc.pid!), 'Process should be running');

      // Send SIGHUP
      const startTime = Date.now();
      process.kill(proc.pid!, 'SIGHUP');

      // Wait for graceful exit
      const died = await waitForProcessDeath(proc.pid!, 6000);
      const duration = Date.now() - startTime;

      assert.ok(died, 'Process should exit on SIGHUP');
      assert.ok(duration < 6000, `Should exit within timeout (took ${duration}ms)`);

      // Verify clean exit (no orphans)
      const stillAlive = isProcessAlive(proc.pid!);
      assert.strictEqual(stillAlive, false, 'Process should be fully terminated');

    } finally {
      if (proc?.pid && isProcessAlive(proc.pid)) {
        killProcessTree(proc.pid);
      }
    }
  });

  /**
   * Test that nested child processes (stdio upstreams) also terminate.
   * When tool-filter-mcp exits, its child (echo-server) should also die.
   */
  it('orphaning - nested child process terminates with parent', async () => {
    let proc: ChildProcess | null = null;
    let childPids: number[] = [];

    try {
      // Spawn tool-filter-mcp with stdio upstream (spawns child)
      proc = spawn(
        'node',
        [
          `${DIST_DIR}/index.js`,
          '--upstream-stdio',
          '--',
          'npx',
          'tsx',
          `${FIXTURES_DIR}/echo-server.ts`,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      // Wait for startup
      await waitForOutput(proc, /Proxy ready/, 5000);

      // Find child processes (echo-server spawned by tool-filter-mcp)
      const { execSync } = await import('node:child_process');
      const psOutput = execSync(`ps --ppid ${proc.pid} -o pid --no-headers`, {
        encoding: 'utf-8',
      }).trim();

      if (psOutput) {
        childPids = psOutput.split('\n').map(pid => parseInt(pid.trim(), 10));
      }

      // Should have at least one child (echo-server)
      assert.ok(childPids.length > 0, 'Should have child process (echo-server)');

      // Kill tool-filter-mcp
      process.kill(proc.pid!, 'SIGTERM');

      // Wait for parent to exit
      await waitForProcessDeath(proc.pid!, 6000);

      // Verify all children also died (not orphaned)
      await new Promise(resolve => setTimeout(resolve, 500));  // Brief grace period

      for (const childPid of childPids) {
        const childAlive = isProcessAlive(childPid);
        assert.strictEqual(
          childAlive,
          false,
          `Child process ${childPid} should terminate with parent`
        );
      }

    } finally {
      // Cleanup any survivors
      if (proc?.pid && isProcessAlive(proc.pid)) {
        killProcessTree(proc.pid);
      }
      for (const childPid of childPids) {
        if (isProcessAlive(childPid)) {
          killProcessTree(childPid);
        }
      }
    }
  });

  /**
   * Test rapid parent death detection.
   * Kills parent immediately after startup to test race conditions.
   */
  it('orphaning - detects parent death even during startup', async () => {
    // Parent that spawns child and exits immediately
    const parentScript = `
const { spawn } = require('node:child_process');

const child = spawn('node', [
  '${DIST_DIR}/index.js',
  '--upstream-stdio',
  '--',
  'npx',
  'tsx',
  '${FIXTURES_DIR}/echo-server.ts'
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

console.error('PARENT_CHILD_PID:' + child.pid);

// Exit immediately (parent dies during child startup)
setTimeout(() => process.exit(0), 100);
`;

    const tmpParent = '/tmp/tool-filter-mcp-rapid-death-test.js';
    await import('node:fs/promises').then(fs =>
      fs.writeFile(tmpParent, parentScript)
    );

    let parentProc: ChildProcess | null = null;
    let toolFilterPid: number | null = null;

    try {
      parentProc = spawn('node', [tmpParent], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Extract PID
      const pidMatch = await waitForOutput(
        parentProc,
        /PARENT_CHILD_PID:(\d+)/,
        5000
      );
      assert.ok(pidMatch, 'Failed to get tool-filter-mcp PID');
      toolFilterPid = parseInt(pidMatch[1], 10);

      // Wait for parent to exit (parent death)
      await new Promise<void>((resolve) => {
        parentProc!.on('exit', () => resolve());
        setTimeout(() => resolve(), 2000);  // Timeout fallback
      });

      // tool-filter-mcp should detect parent death and exit within reasonable time
      await new Promise(resolve => setTimeout(resolve, 500));  // Brief delay
      const died = await waitForProcessDeath(toolFilterPid, 5000);

      assert.ok(died, 'tool-filter-mcp should exit even if parent dies during startup');

    } finally {
      if (toolFilterPid && isProcessAlive(toolFilterPid)) {
        killProcessTree(toolFilterPid);
      }
      try {
        await import('node:fs/promises').then(fs => fs.unlink(tmpParent));
      } catch {
        // Ignore
      }
    }
  });
});
