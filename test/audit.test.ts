import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditLogger } from '../src/audit/logger.js';

class FakeWriteStream extends EventEmitter {
  readonly writes: string[] = [];

  write(line: string): boolean {
    this.writes.push(line);
    return true;
  }

  end(): void {
    this.emit('finish');
    this.emit('close');
  }
}

describe('createAuditLogger', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flushes pending events to disk on close', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'crabcrush-audit-'));
    tempDirs.push(tempDir);
    const logPath = join(tempDir, 'audit.log');
    const handle = createAuditLogger(logPath);

    handle.log({ type: 'chat_request', sessionId: 'sess-1' });
    await handle.close();

    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('"type":"chat_request"');
    expect(content).toContain('"sessionId":"sess-1"');
  });

  it('falls back to stderr when logger initialization fails', async () => {
    const stderrLines: string[] = [];
    const errors: unknown[][] = [];
    const handle = createAuditLogger('Z:/invalid/audit.log', {
      mkdirFn: async () => {
        throw new Error('mkdir failed');
      },
      stderrWrite: (line) => { stderrLines.push(line); },
      consoleError: (...args) => { errors.push(args); },
    });

    handle.log({ type: 'tool_call', name: 'write_file' });
    await handle.close();

    expect(stderrLines).toHaveLength(1);
    expect(stderrLines[0]).toContain('"type":"tool_call"');
    expect(errors[0]?.[0]).toBe('[AuditLogger] 创建日志目录失败，审计日志将仅输出到控制台:');
  });

  it('falls back to stderr after stream write errors', async () => {
    const stderrLines: string[] = [];
    const errors: unknown[][] = [];
    const fakeStream = new FakeWriteStream();
    const handle = createAuditLogger('E:/fake/audit.log', {
      mkdirFn: async () => {},
      createWriteStreamFn: () => fakeStream as never,
      stderrWrite: (line) => { stderrLines.push(line); },
      consoleError: (...args) => { errors.push(args); },
    });

    await Promise.resolve();
    handle.log({ type: 'before_error' });
    fakeStream.emit('error', new Error('disk full'));
    handle.log({ type: 'after_error' });
    await handle.close();

    expect(fakeStream.writes.some((line) => line.includes('"type":"before_error"'))).toBe(true);
    expect(stderrLines).toHaveLength(1);
    expect(stderrLines[0]).toContain('"type":"after_error"');
    expect(errors[0]?.[0]).toBe('[AuditLogger] 写入日志文件失败，后续审计日志将输出到控制台:');
  });
});

