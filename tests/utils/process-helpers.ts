import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';

const execAsync = promisify(exec);

/**
 * Check if a process is still alive
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all child process PIDs for a parent PID
 */
export async function getChildPids(parentPid: number): Promise<number[]> {
  try {
    const { stdout } = await execAsync(`pgrep -P ${parentPid}`);
    return stdout.trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

/**
 * Get the parent PID of a process
 */
export async function getProcessParentPid(pid: number): Promise<number> {
  try {
    const { stdout } = await execAsync(`ps -o ppid= -p ${pid}`);
    return parseInt(stdout.trim(), 10);
  } catch {
    return -1;
  }
}

/**
 * Wait for a process to die (with timeout)
 */
export async function waitForProcessDeath(
  pid: number,
  timeout: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!isProcessAlive(pid)) return true;
    await sleep(100);
  }
  return false;
}

/**
 * Wait for a child process to exit
 */
export async function waitForExit(
  proc: ChildProcess,
  timeout: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Process did not exit')), timeout);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? -1);
    });
  });
}

/**
 * Wait for specific output pattern on a stream
 */
export async function waitForOutput(
  stream: NodeJS.ReadableStream,
  pattern: string | RegExp,
  timeout: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Pattern not found')), timeout);

    stream.on('data', (data) => {
      output += data.toString();
      const match = typeof pattern === 'string'
        ? output.includes(pattern)
        : pattern.test(output);
      if (match) {
        clearTimeout(timer);
        resolve(output);
      }
    });
  });
}

/**
 * Simple sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kill process and all children
 */
export async function killProcessTree(pid: number): Promise<void> {
  try {
    // Get all children recursively
    const children = await getChildPids(pid);

    // Kill children first
    for (const childPid of children) {
      await killProcessTree(childPid);
    }

    // Kill the parent
    if (isProcessAlive(pid)) {
      process.kill(pid, 'SIGTERM');

      // Wait a bit, then force kill if still alive
      await sleep(1000);
      if (isProcessAlive(pid)) {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    // Process may have already exited
  }
}
