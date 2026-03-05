/**
 * Block Streaming helper for channels without true token streaming (e.g. DingTalk sessionWebhook).
 *
 * Goals:
 * - coalesce tiny LLM chunks into larger blocks
 * - flush periodically for responsiveness
 * - never exceed a per-message max length
 * - try to split on nice boundaries to avoid awkward cuts
 */

export interface BlockStreamingOptions {
  /** Send a single message block to the channel. */
  send: (text: string) => Promise<void>;
  /** Minimum buffered characters before we consider flushing. */
  minChars: number;
  /** Hard per-message max characters. Blocks will be split to not exceed it. */
  maxChars: number;
  /** Flush periodically even if maxChars isn't reached. */
  flushIntervalMs: number;
}

function findSplitIndex(text: string, limit: number): number {
  if (text.length <= limit) return text.length;

  const slice = text.slice(0, limit);

  // Paragraph boundary is a strong signal: allow a smaller chunk if it avoids awkward splits.
  const paragraph = slice.lastIndexOf('\n\n');
  if (paragraph >= Math.floor(limit * 0.3)) return paragraph;

  const candidates = [
    slice.lastIndexOf('\n'),
    slice.lastIndexOf('。'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('. '),
    slice.lastIndexOf(' '),
  ];

  const best = Math.max(...candidates);
  if (best >= Math.floor(limit * 0.6)) return best;
  return limit;
}

export class BlockStreamer {
  private opts: BlockStreamingOptions;
  private buffer = '';
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(opts: BlockStreamingOptions) {
    this.opts = opts;
  }

  push(chunk: string): void {
    if (!chunk) return;
    this.buffer += chunk;

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.opts.flushIntervalMs);
    }

    if (this.buffer.length >= this.opts.maxChars) {
      void this.flush();
    }
  }

  async flush(force = false): Promise<void> {
    if (this.flushing) return;
    if (!force && this.buffer.length < this.opts.minChars) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.flushing = true;
    try {
      while (this.buffer.length > 0) {
        const cut = findSplitIndex(this.buffer, this.opts.maxChars);
        const out = this.buffer.slice(0, cut).trimEnd();
        this.buffer = this.buffer.slice(cut);

        if (out) {
          await this.opts.send(out);
        }

        if (!force && this.buffer.length > 0 && this.buffer.length < this.opts.minChars) {
          if (!this.timer) {
            this.timer = setTimeout(() => {
              this.timer = null;
              void this.flush();
            }, this.opts.flushIntervalMs);
          }
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  close(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = '';
  }
}