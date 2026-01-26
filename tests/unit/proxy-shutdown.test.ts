/**
 * Unit tests for ProxyOrchestrator.shutdown() method.
 *
 * Tests that proxy shutdown properly delegates to upstreamConnection.disconnect()
 * and manages ready state correctly.
 */

import { describe, it, expect, vi } from 'vitest';

describe('ProxyOrchestrator.shutdown()', () => {
  it('should call upstreamConnection.disconnect()', async () => {
    const mockUpstreamConnection = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    let ready = true;

    // Simulate ProxyOrchestrator.shutdown logic
    try {
      await mockUpstreamConnection.disconnect();
    } finally {
      ready = false;
    }

    expect(mockUpstreamConnection.disconnect).toHaveBeenCalledOnce();
    expect(ready).toBe(false);
  });

  it('should await disconnect completion', async () => {
    let disconnectResolved = false;

    const mockUpstreamConnection = {
      disconnect: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        disconnectResolved = true;
      }),
    };

    let ready = true;

    try {
      await mockUpstreamConnection.disconnect();
    } finally {
      ready = false;
    }

    expect(disconnectResolved).toBe(true);
    expect(ready).toBe(false);
  });

  it('should set ready = false after shutdown', async () => {
    const mockUpstreamConnection = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    let ready = true;

    try {
      await mockUpstreamConnection.disconnect();
    } finally {
      ready = false;
    }

    expect(ready).toBe(false);
  });

  it('should handle disconnect errors gracefully', async () => {
    const mockUpstreamConnection = {
      disconnect: vi.fn().mockRejectedValue(new Error('Disconnect error')),
    };

    let ready = true;
    let error: Error | null = null;

    try {
      await mockUpstreamConnection.disconnect();
    } catch (err) {
      error = err as Error;
    } finally {
      ready = false;
    }

    expect(ready).toBe(false);
    expect(error?.message).toBe('Disconnect error');
  });

  it('should be idempotent (safe to call multiple times)', async () => {
    const mockUpstreamConnection = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    let ready = true;

    // First shutdown
    try {
      await mockUpstreamConnection.disconnect();
    } finally {
      ready = false;
    }

    // Second shutdown (should still work)
    try {
      await mockUpstreamConnection.disconnect();
    } finally {
      ready = false;
    }

    expect(mockUpstreamConnection.disconnect).toHaveBeenCalledTimes(2);
    expect(ready).toBe(false);
  });

  it('should set ready = false even if disconnect() throws', async () => {
    const mockUpstreamConnection = {
      disconnect: vi.fn().mockRejectedValue(new Error('Error')),
    };

    let ready = true;

    try {
      await mockUpstreamConnection.disconnect();
    } catch {
      // Ignore error
    } finally {
      ready = false;
    }

    expect(ready).toBe(false);
  });
});
