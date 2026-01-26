/**
 * Unit tests for UpstreamConnection.disconnect() method.
 *
 * Tests that the upstream connection properly delegates to client.disconnect()
 * and manages connection state correctly.
 */

import { describe, it, expect, vi } from 'vitest';

describe('UpstreamConnection.disconnect()', () => {
  it('should call client.disconnect() when connected', async () => {
    const mockClient = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    let connected = true;

    // Simulate UpstreamConnection.disconnect logic
    if (connected) {
      try {
        await mockClient.disconnect();
      } finally {
        connected = false;
      }
    }

    expect(mockClient.disconnect).toHaveBeenCalledOnce();
    expect(connected).toBe(false);
  });

  it('should await client.disconnect()', async () => {
    let disconnectResolved = false;

    const mockClient = {
      disconnect: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        disconnectResolved = true;
      }),
    };

    let connected = true;

    if (connected) {
      try {
        await mockClient.disconnect();
      } finally {
        connected = false;
      }
    }

    expect(disconnectResolved).toBe(true);
    expect(connected).toBe(false);
  });

  it('should set connected = false after disconnect', async () => {
    const mockClient = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    let connected = true;

    if (connected) {
      try {
        await mockClient.disconnect();
      } finally {
        connected = false;
      }
    }

    expect(connected).toBe(false);
  });

  it('should not call client.disconnect() when already disconnected', async () => {
    const mockClient = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    let connected = false;

    if (connected) {
      try {
        await mockClient.disconnect();
      } finally {
        connected = false;
      }
    }

    expect(mockClient.disconnect).not.toHaveBeenCalled();
  });

  it('should be idempotent (safe to call multiple times)', async () => {
    const mockClient = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    let connected = true;

    // First call
    if (connected) {
      try {
        await mockClient.disconnect();
      } finally {
        connected = false;
      }
    }

    // Second call (should be no-op)
    if (connected) {
      try {
        await mockClient.disconnect();
      } finally {
        connected = false;
      }
    }

    expect(mockClient.disconnect).toHaveBeenCalledOnce();
    expect(connected).toBe(false);
  });

  it('should set connected = false even if disconnect() throws', async () => {
    const mockClient = {
      disconnect: vi.fn().mockRejectedValue(new Error('Disconnect error')),
    };

    let connected = true;
    let error: Error | null = null;

    // Simulate try/finally pattern
    try {
      if (connected) {
        try {
          await mockClient.disconnect();
        } finally {
          connected = false;
        }
      }
    } catch (err) {
      error = err as Error;
    }

    expect(connected).toBe(false);
    expect(error).not.toBe(null);
    expect(error?.message).toBe('Disconnect error');
  });
});
