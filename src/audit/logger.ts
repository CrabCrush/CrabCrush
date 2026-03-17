import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { WriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type AuditEvent = { type: string; [key: string]: unknown };
export type AuditLogger = (event: AuditEvent) => void;

export interface AuditLoggerHandle {
  log: AuditLogger;
  /** 进程退出前调用，确保缓冲内容全部落盘 */
  close(): Promise<void>;
}

export interface AuditLoggerDeps {
  mkdirFn?: typeof mkdir;
  createWriteStreamFn?: typeof createWriteStream;
  stderrWrite?: (line: string) => void;
  consoleError?: (...args: unknown[]) => void;
}

export function createAuditLogger(logFilePath?: string, deps: AuditLoggerDeps = {}): AuditLoggerHandle {
  const logFile = logFilePath ?? join(homedir(), '.crabcrush', 'logs', 'audit.log');
  const logDir = dirname(logFile);
  const mkdirFn = deps.mkdirFn ?? mkdir;
  const createWriteStreamFn = deps.createWriteStreamFn ?? createWriteStream;
  const stderrWrite = deps.stderrWrite ?? ((line: string) => { process.stderr.write(line); });
  const consoleError = deps.consoleError ?? console.error;

  let stream: WriteStream | null = null;
  let fallbackToStderr = false;
  // 日志写入队列：stream 未就绪时缓存待写行，避免丢失
  const pending: string[] = [];

  const flushPendingToStderr = (): void => {
    for (const line of pending) stderrWrite(line);
    pending.length = 0;
  };

  const switchToStderr = (message: string, err?: Error): void => {
    if (!fallbackToStderr) {
      consoleError(message, err?.message ?? err);
    }
    fallbackToStderr = true;
    stream = null;
    flushPendingToStderr();
  };

  const ready = mkdirFn(logDir, { recursive: true })
    .then(() => {
      const openedStream = createWriteStreamFn(logFile, { flags: 'a', encoding: 'utf-8' });
      stream = openedStream;
      openedStream.on('error', (err) => {
        switchToStderr('[AuditLogger] 写入日志文件失败，后续审计日志将输出到控制台:', err);
      });
      for (const line of pending) openedStream.write(line);
      pending.length = 0;
    })
    .catch((err: Error) => {
      switchToStderr('[AuditLogger] 创建日志目录失败，审计日志将仅输出到控制台:', err);
    });

  const log: AuditLogger = (event: AuditEvent) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
    if (fallbackToStderr) {
      stderrWrite(line);
      return;
    }
    if (stream) {
      stream.write(line);
    } else {
      pending.push(line);
    }
  };

  const close = (): Promise<void> => {
    return ready.then(() => new Promise((resolve) => {
      const currentStream = stream;
      if (!currentStream || fallbackToStderr) {
        resolve();
        return;
      }

      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onError = (err: Error): void => {
        switchToStderr('[AuditLogger] 关闭日志文件失败，后续审计日志将输出到控制台:', err);
        finish();
      };
      const cleanup = (): void => {
        currentStream.off('finish', finish);
        currentStream.off('close', finish);
        currentStream.off('error', onError);
      };

      currentStream.once('finish', finish);
      currentStream.once('close', finish);
      currentStream.once('error', onError);

      try {
        currentStream.end();
      } catch (err) {
        onError(err as Error);
      }
    }));
  };

  return { log, close };
}
