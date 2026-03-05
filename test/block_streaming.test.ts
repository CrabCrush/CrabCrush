import { describe, expect, it, vi } from 'vitest';
import { BlockStreamer } from '../src/channels/block_streaming.js';

describe('BlockStreamer', () => {
  it('coalesces small chunks and flushes on timer', async () => {
    vi.useFakeTimers();

    const sent: string[] = [];
    const s = new BlockStreamer({
      send: async (text) => { sent.push(text); },
      minChars: 5,
      maxChars: 100,
      flushIntervalMs: 1000,
    });

    s.push('a');
    s.push('b');
    s.push('c');
    s.push('d');
    expect(sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([]);

    s.push('e');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual(['abcde']);

    s.close();
    vi.useRealTimers();
  });

  it('splits blocks to never exceed maxChars', async () => {
    const sent: string[] = [];
    const s = new BlockStreamer({
      send: async (text) => { sent.push(text); },
      minChars: 1,
      maxChars: 10,
      flushIntervalMs: 10_000,
    });

    s.push('0123456789ABCDEFGHIJ');
    await s.flush(true);

    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((x) => x.length <= 10)).toBe(true);
    expect(sent.join('')).toBe('0123456789ABCDEFGHIJ');
  });

  it('prefers splitting on paragraph boundary when possible', async () => {
    const sent: string[] = [];
    const s = new BlockStreamer({
      send: async (text) => { sent.push(text); },
      minChars: 1,
      maxChars: 12,
      flushIntervalMs: 10_000,
    });

    s.push('hello\n\nworld!!!');
    await s.flush(true);

    expect(sent[0]).toBe('hello');
    expect(sent.join('')).toBe('hello\n\nworld!!!');
  });
});