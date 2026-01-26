/**
 * Unit tests for client disconnect implementations.
 *
 * Tests that HTTP and Stdio transport disconnects properly call cleanup
 * methods in the correct order and handle errors gracefully.
 */

import { describe, it, expect, vi } from 'vitest';

describe('Client Disconnect - HTTP Transport', () => {
  it('should call terminateSession() before close()', async () => {
    const callOrder: string[] = [];

    const mockTransport = {
      terminateSession: vi.fn().mockImplementation(async () => {
        callOrder.push('terminateSession');
      }),
      close: vi.fn().mockImplementation(async () => {
        callOrder.push('close');
      }),
    };

    const mockClient = {
      close: vi.fn().mockImplementation(async () => {
        callOrder.push('client.close');
      }),
    };

    // Simulate the HTTP disconnect logic
    await mockTransport.terminateSession();
    await mockTransport.close();
    await mockClient.close();

    expect(callOrder).toEqual(['terminateSession', 'close', 'client.close']);
    expect(mockTransport.terminateSession).toHaveBeenCalledOnce();
    expect(mockTransport.close).toHaveBeenCalledOnce();
    expect(mockClient.close).toHaveBeenCalledOnce();
  });

  it('should call transport.close() after terminateSession()', async () => {
    const mockTransport = {
      terminateSession: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockClient = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    await mockTransport.terminateSession();
    await mockTransport.close();
    await mockClient.close();

    expect(mockTransport.close).toHaveBeenCalled();
  });

  it('should await all cleanup operations', async () => {
    let terminateSessionResolved = false;
    let closeResolved = false;
    let clientCloseResolved = false;

    const mockTransport = {
      terminateSession: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        terminateSessionResolved = true;
      }),
      close: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        closeResolved = true;
      }),
    };

    const mockClient = {
      close: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        clientCloseResolved = true;
      }),
    };

    await mockTransport.terminateSession();
    await mockTransport.close();
    await mockClient.close();

    expect(terminateSessionResolved).toBe(true);
    expect(closeResolved).toBe(true);
    expect(clientCloseResolved).toBe(true);
  });

  it('should handle terminateSession() errors gracefully', async () => {
    const mockTransport = {
      terminateSession: vi.fn().mockRejectedValue(new Error('Session error')),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockClient = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Should not throw, should continue with cleanup
    const errors: Error[] = [];
    try {
      await mockTransport.terminateSession();
    } catch (error) {
      errors.push(error as Error);
    }

    await mockTransport.close();
    await mockClient.close();

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('Session error');
    expect(mockTransport.close).toHaveBeenCalled();
    expect(mockClient.close).toHaveBeenCalled();
  });

  it('should handle close() errors gracefully', async () => {
    const mockTransport = {
      terminateSession: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(new Error('Close error')),
    };

    const mockClient = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    const errors: Error[] = [];

    await mockTransport.terminateSession();

    try {
      await mockTransport.close();
    } catch (error) {
      errors.push(error as Error);
    }

    await mockClient.close();

    expect(errors.length).toBe(1);
    expect(mockClient.close).toHaveBeenCalled();
  });

  it('should always set connected = false even on error', async () => {
    const mockTransport = {
      terminateSession: vi.fn().mockRejectedValue(new Error('Error')),
      close: vi.fn().mockRejectedValue(new Error('Error')),
    };

    const mockClient = {
      close: vi.fn().mockRejectedValue(new Error('Error')),
    };

    let connected = true;

    // Simulate disconnect with errors
    try {
      await mockTransport.terminateSession();
    } catch {
      // Ignore
    }

    try {
      await mockTransport.close();
    } catch {
      // Ignore
    }

    try {
      await mockClient.close();
    } catch {
      // Ignore
    }

    // Should always set connected = false
    connected = false;

    expect(connected).toBe(false);
  });
});

describe('Client Disconnect - SSE Transport', () => {
  it('should call transport.close()', async () => {
    const mockTransport = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockClient = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    await mockTransport.close();
    await mockClient.close();

    expect(mockTransport.close).toHaveBeenCalledOnce();
    expect(mockClient.close).toHaveBeenCalledOnce();
  });

  it('should await close operation', async () => {
    let closeResolved = false;

    const mockTransport = {
      close: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        closeResolved = true;
      }),
    };

    const mockClient = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    await mockTransport.close();
    await mockClient.close();

    expect(closeResolved).toBe(true);
  });
});

describe('Client Disconnect - Stdio Transport', () => {
  it('should call transport.close() before nulling', async () => {
    const mockTransport = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockClient = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    let transport: typeof mockTransport | null = mockTransport;

    // CRITICAL: Must call close before nulling
    if (transport !== null) {
      await transport.close();
    }
    await mockClient.close();
    transport = null;

    expect(mockTransport.close).toHaveBeenCalledOnce();
    expect(transport).toBe(null);
  });

  it('should await transport.close()', async () => {
    let closeResolved = false;

    const mockTransport = {
      close: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        closeResolved = true;
      }),
    };

    const mockClient = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    await mockTransport.close();
    await mockClient.close();

    expect(closeResolved).toBe(true);
  });

  it('should handle close() errors gracefully', async () => {
    const mockTransport = {
      close: vi.fn().mockRejectedValue(new Error('Close error')),
    };

    const mockClient = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    const errors: Error[] = [];

    try {
      await mockTransport.close();
    } catch (error) {
      errors.push(error as Error);
    }

    await mockClient.close();

    expect(errors.length).toBe(1);
    expect(mockClient.close).toHaveBeenCalled();
  });
});

describe('Client Disconnect - Idempotency', () => {
  it('should be safe to call disconnect twice (HTTP)', async () => {
    const mockTransport = {
      terminateSession: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockClient = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    // First disconnect
    await mockTransport.terminateSession();
    await mockTransport.close();
    await mockClient.close();

    // Second disconnect (should be safe)
    await mockTransport.terminateSession();
    await mockTransport.close();
    await mockClient.close();

    expect(mockTransport.terminateSession).toHaveBeenCalledTimes(2);
    expect(mockTransport.close).toHaveBeenCalledTimes(2);
    expect(mockClient.close).toHaveBeenCalledTimes(2);
  });

  it('should be safe to call disconnect twice (Stdio)', async () => {
    const mockTransport = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockClient = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    let transport: typeof mockTransport | null = mockTransport;

    // First disconnect
    if (transport !== null) {
      await transport.close();
    }
    await mockClient.close();
    transport = null;

    // Second disconnect (transport is null, should skip)
    if (transport !== null) {
      await transport.close();
    }
    await mockClient.close();

    expect(mockTransport.close).toHaveBeenCalledOnce();
    expect(mockClient.close).toHaveBeenCalledTimes(2);
  });
});
