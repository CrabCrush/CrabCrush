import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type AuditEvent = { type: string; [key: string]: unknown };
export type AuditLogger = (event: AuditEvent) => void;

export function createAuditLogger(logFilePath?: string): AuditLogger {
  const logFile = logFilePath ?? join(homedir(), '.crabcrush', 'logs', 'audit.log');
  const logDir = dirname(logFile);
  const ready = mkdir(logDir, { recursive: true }).catch(() => {});

  return (event: AuditEvent) => {
    void (async () => {
      await ready;
      const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
      await appendFile(logFile, line, { encoding: 'utf-8' });
    })().catch(() => {});
  };
}
