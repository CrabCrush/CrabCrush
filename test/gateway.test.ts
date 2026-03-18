import { describe, it, expect, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { createGateway, startGateway } from '../src/gateway/server.js';
import { AgentRuntime } from '../src/agent/runtime.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { Tool } from '../src/tools/types.js';
import type { ChatChunk, ChatMessage, ChatOptions } from '../src/models/provider.js';
import { ConversationStore } from '../src/storage/database.js';

describe('Gateway', () => {
  const app = createGateway({ logger: false });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

class ConfirmFlowRouter {
  async *chat(messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const lastUserIndex = [...messages].map((m) => m.role).lastIndexOf('user');
    const toolMessagesAfterLastUser = lastUserIndex >= 0
      ? messages.slice(lastUserIndex + 1).filter((m) => m.role === 'tool').length
      : 0;

    if (toolMessagesAfterLastUser === 0) {
      yield {
        content: '',
        done: true,
        model: 'mock-model',
        toolCalls: [
          {
            id: 'call-confirm-1',
            type: 'function',
            function: {
              name: 'secure_action',
              arguments: JSON.stringify({ path: 'workspace/plan.md' }),
            },
          },
        ],
      };
      return;
    }

    yield { content: '已安全完成操作', done: false };
    yield { content: '', done: true, model: 'mock-model' };
  }
}

class PermissionFlowRouter {
  async *chat(messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const lastUserIndex = [...messages].map((m) => m.role).lastIndexOf('user');
    const toolMessagesAfterLastUser = lastUserIndex >= 0
      ? messages.slice(lastUserIndex + 1).filter((m) => m.role === 'tool').length
      : 0;

    if (toolMessagesAfterLastUser === 0) {
      yield {
        content: '',
        done: true,
        model: 'mock-model',
        toolCalls: [
          {
            id: 'call-permission-1',
            type: 'function',
            function: {
              name: 'scan_like',
              arguments: JSON.stringify({ path: 'C:/secured/docs' }),
            },
          },
        ],
      };
      return;
    }

    yield { content: '已完成扫描', done: false };
    yield { content: '', done: true, model: 'mock-model' };
  }
}

function createConfirmFlowRuntime(): AgentRuntime {
  const registry = new ToolRegistry();
  let executionCount = 0;
  const secureTool: Tool = {
    definition: {
      name: 'secure_action',
      description: 'mock protected tool',
      parameters: { type: 'object', properties: {} },
    },
    permission: 'owner',
    confirmRequired: true,
    buildConfirmRequest: (args) => ({
      message: '该操作会修改工作区文件。',
      grantKey: 'file:write:workspace',
      preview: {
        title: '写入工作区文件',
        summary: `将写入 ${(args.path as string) || 'unknown'}`,
        riskLevel: 'high',
        targets: [String(args.path || '')],
      },
    }),
    execute: async () => {
      executionCount += 1;
      return { success: true, content: `write ok ${executionCount}` };
    },
  };
  registry.register(secureTool);

  return new AgentRuntime({
    router: new ConfirmFlowRouter() as never,
    systemPrompt: 'test',
    maxTokens: 1024,
    toolRegistry: registry,
    ownerIds: [],
  });
}

function createPermissionFlowRuntime(): AgentRuntime {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: 'scan_like',
      description: 'mock permission-request tool',
      parameters: { type: 'object', properties: {} },
    },
    permission: 'owner',
    confirmRequired: false,
    buildPermissionRequest: (args) => ({
      action: 'list_files',
      message: `是否允许扫描该目录？\n${String(args.path || '')}`,
      params: args,
      grantKey: `file:list:${String(args.path || '')}`,
      scopeOptions: ['once', 'session', 'persistent'],
      defaultScope: 'once',
      preview: {
        title: '扫描目录',
        summary: `将扫描 ${String(args.path || '')}`,
        riskLevel: 'medium',
        targets: [String(args.path || '')],
      },
    }),
    execute: async (args, context) => {
      const grantKey = `file:list:${String(args.path || '')}`;
      if (!context.hasPermissionGrant?.(grantKey)) {
        const allowed = await context.requestPermission?.({
          action: 'list_files',
          message: `是否允许扫描该目录？\n${String(args.path || '')}`,
          params: args,
          grantKey,
          scopeOptions: ['once', 'session', 'persistent'],
          defaultScope: 'once',
          preview: {
            title: '扫描目录',
            summary: `将扫描 ${String(args.path || '')}`,
            riskLevel: 'medium',
            targets: [String(args.path || '')],
          },
        });
        if (!allowed) return { success: false, content: '用户拒绝执行工具 "scan_like"' };
      }
      return { success: true, content: 'scan ok' };
    },
  } as Tool);

  return new AgentRuntime({
    router: new PermissionFlowRouter() as never,
    systemPrompt: 'test',
    maxTokens: 1024,
    toolRegistry: registry,
    ownerIds: [],
  });
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      ws.off('open', onOpen);
      ws.off('error', onError);
    };
    ws.on('open', onOpen);
    ws.on('error', onError);
  });
}

function runChat(
  ws: WebSocket,
  content: string,
  onMessage?: (msg: Record<string, unknown>) => void,
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const received: Array<Record<string, unknown>> = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket chat completion'));
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', handleMessage);
      ws.off('error', handleError);
    };

    const handleError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const handleMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      received.push(msg);
      onMessage?.(msg);
      if (msg.type === 'done') {
        cleanup();
        resolve(received);
      }
      if (msg.type === 'error') {
        cleanup();
        reject(new Error(String(msg.message || 'Unknown WebSocket error')));
      }
    };

    ws.on('message', handleMessage);
    ws.on('error', handleError);
    ws.send(JSON.stringify({ type: 'chat', content }));
  });
}

function loadAuditEvents(ws: WebSocket, sessionId: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for audit events'));
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', handleMessage);
      ws.off('error', handleError);
    };

    const handleError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const handleMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type !== 'audit_events') return;
      cleanup();
      resolve((msg.events as Array<Record<string, unknown>>) || []);
    };

    ws.on('message', handleMessage);
    ws.on('error', handleError);
    ws.send(JSON.stringify({ type: 'loadAuditEvents', sessionId, limit: 200 }));
  });
}

function loadPermissionGrants(ws: WebSocket): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for permission grants'));
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', handleMessage);
      ws.off('error', handleError);
    };

    const handleError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const handleMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type !== 'permission_grants') return;
      cleanup();
      resolve((msg.grants as Array<Record<string, unknown>>) || []);
    };

    ws.on('message', handleMessage);
    ws.on('error', handleError);
    ws.send(JSON.stringify({ type: 'loadPermissionGrants' }));
  });
}

function revokePermissionGrant(ws: WebSocket, grantKey: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for revoke result'));
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', handleMessage);
      ws.off('error', handleError);
    };

    const handleError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const handleMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type !== 'permission_grant_revoked') return;
      cleanup();
      resolve(msg);
    };

    ws.on('message', handleMessage);
    ws.on('error', handleError);
    ws.send(JSON.stringify({ type: 'revokePermissionGrant', grantKey }));
  });
}

describe('Gateway WebSocket confirm flow', () => {
  it('streams plan, confirm, tool result, and final reply in order', async () => {
    const agent = createConfirmFlowRuntime();
    const server = await startGateway({ port: 0, bind: 'loopback', logger: false, agent, token: 'test-token' });
    const port = (server.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-token`);

    try {
      await waitForOpen(ws);

      const messages = await runChat(ws, '请执行这个操作', (msg) => {
        if (msg.type !== 'confirm') return;
        const scope = msg.kind === 'confirm' ? 'session' : 'once';
        ws.send(JSON.stringify({
          type: 'confirm_result',
          id: msg.id,
          allow: true,
          scope,
        }));
      });

      const types = messages.map((msg) => msg.type);
      const planEvent = messages.find((msg) => msg.type === 'tool_plan');
      const confirmEvents = messages.filter((msg) => msg.type === 'confirm');
      const toolEvent = messages.find((msg) => msg.type === 'tool_call');
      const finalChunk = messages.find((msg) => msg.type === 'chunk' && msg.content === '已安全完成操作');
      const operationId = String(planEvent?.operationId || '');

      expect(types.indexOf('session')).toBeGreaterThanOrEqual(0);
      expect(types.indexOf('tool_plan')).toBeGreaterThan(types.indexOf('session'));
      expect(confirmEvents).toHaveLength(2);
      expect(confirmEvents[0]?.kind).toBe('plan');
      expect(confirmEvents[1]?.kind).toBe('confirm');
      expect(planEvent?.summary).toBe('准备执行 1 个步骤');
      expect(operationId).not.toBe('');
      expect(confirmEvents[0]?.operationId).toBe(operationId);
      expect(confirmEvents[0]?.stepIndex).toBeUndefined();
      expect(confirmEvents[1]?.operationId).toBe(operationId);
      expect(confirmEvents[1]?.stepIndex).toBe(1);
      expect(toolEvent).toMatchObject({
        type: 'tool_call',
        operationId,
        stepIndex: 1,
        name: 'secure_action',
        success: true,
      });
      expect(finalChunk).toBeTruthy();
      expect(types.indexOf('tool_call')).toBeGreaterThan(types.indexOf('confirm'));
      expect(types.at(-1)).toBe('done');
    } finally {
      ws.close();
      await server.close();
    }
  });

  it('reuses session-scoped tool approval on the next chat turn', async () => {
    const agent = createConfirmFlowRuntime();
    const server = await startGateway({ port: 0, bind: 'loopback', logger: false, agent, token: 'test-token' });
    const port = (server.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-token`);

    try {
      await waitForOpen(ws);

      const firstRun = await runChat(ws, '第一次执行', (msg) => {
        if (msg.type !== 'confirm') return;
        ws.send(JSON.stringify({
          type: 'confirm_result',
          id: msg.id,
          allow: true,
          scope: msg.kind === 'confirm' ? 'session' : 'once',
        }));
      });

      const secondRun = await runChat(ws, '第二次执行', (msg) => {
        if (msg.type !== 'confirm') return;
        ws.send(JSON.stringify({
          type: 'confirm_result',
          id: msg.id,
          allow: true,
          scope: 'once',
        }));
      });

      const firstConfirmKinds = firstRun.filter((msg) => msg.type === 'confirm').map((msg) => msg.kind);
      const secondConfirmKinds = secondRun.filter((msg) => msg.type === 'confirm').map((msg) => msg.kind);

      expect(firstConfirmKinds).toEqual(['plan', 'confirm']);
      expect(secondConfirmKinds).toEqual([]);
      expect(secondRun.find((msg) => msg.type === 'tool_call')).toMatchObject({
        type: 'tool_call',
        name: 'secure_action',
        success: true,
      });
    } finally {
      ws.close();
      await server.close();
    }
  });

  it('skips execute_plan when a single-step action is already persistently authorized', async () => {
    const agent = createConfirmFlowRuntime();
    const server = await startGateway({ port: 0, bind: 'loopback', logger: false, agent, token: 'test-token' });
    const port = (server.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-token`);

    try {
      await waitForOpen(ws);

      const firstRun = await runChat(ws, '第一次执行', (msg) => {
        if (msg.type !== 'confirm') return;
        ws.send(JSON.stringify({
          type: 'confirm_result',
          id: msg.id,
          allow: true,
          scope: msg.kind === 'confirm' ? 'persistent' : 'once',
        }));
      });

      const secondRun = await runChat(ws, '第二次执行', (msg) => {
        if (msg.type !== 'confirm') return;
        ws.send(JSON.stringify({
          type: 'confirm_result',
          id: msg.id,
          allow: true,
          scope: 'once',
        }));
      });

      const firstConfirmKinds = firstRun.filter((msg) => msg.type === 'confirm').map((msg) => msg.kind);
      const secondConfirmKinds = secondRun.filter((msg) => msg.type === 'confirm').map((msg) => msg.kind);

      expect(firstConfirmKinds).toEqual(['plan', 'confirm']);
      expect(secondConfirmKinds).toEqual([]);
      expect(secondRun.find((msg) => msg.type === 'tool_plan')).toBeTruthy();
      expect(secondRun.find((msg) => msg.type === 'tool_call')).toMatchObject({
        type: 'tool_call',
        name: 'secure_action',
        success: true,
      });
    } finally {
      ws.close();
      await server.close();
    }
  });

  it('skips execute_plan for already authorized permission-request tools', async () => {
    const agent = createPermissionFlowRuntime();
    const server = await startGateway({ port: 0, bind: 'loopback', logger: false, agent, token: 'test-token' });
    const port = (server.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-token`);

    try {
      await waitForOpen(ws);

      const firstRun = await runChat(ws, '第一次扫描', (msg) => {
        if (msg.type !== 'confirm') return;
        ws.send(JSON.stringify({
          type: 'confirm_result',
          id: msg.id,
          allow: true,
          scope: msg.kind === 'permission_request' ? 'persistent' : 'once',
        }));
      });

      const secondRun = await runChat(ws, '第二次扫描', (msg) => {
        if (msg.type !== 'confirm') return;
        ws.send(JSON.stringify({
          type: 'confirm_result',
          id: msg.id,
          allow: true,
          scope: 'once',
        }));
      });

      const firstConfirmKinds = firstRun.filter((msg) => msg.type === 'confirm').map((msg) => msg.kind);
      const secondConfirmKinds = secondRun.filter((msg) => msg.type === 'confirm').map((msg) => msg.kind);

      expect(firstConfirmKinds).toEqual(['plan', 'permission_request']);
      expect(secondConfirmKinds).toEqual([]);
      expect(secondRun.find((msg) => msg.type === 'tool_plan')).toBeTruthy();
      expect(secondRun.find((msg) => msg.type === 'tool_call')).toMatchObject({
        type: 'tool_call',
        name: 'scan_like',
        success: true,
      });
    } finally {
      ws.close();
      await server.close();
    }
  });

  it('returns audit replay events for a webchat session', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'crabcrush-gateway-'));
    const store = new ConversationStore(join(tempDir, 'gateway.db'));
    const auditLogger = (event: { type: string; [key: string]: unknown }) => {
      const conversationId = typeof event.conversationId === 'string'
        ? event.conversationId
        : typeof event.sessionId === 'string'
          ? event.sessionId
          : '';
      if (!conversationId) return;
      store.saveAuditEvent({
        conversationId,
        principalKey: typeof event.principalKey === 'string' ? event.principalKey : '',
        eventType: event.type,
        operationId: typeof event.operationId === 'string' ? event.operationId : undefined,
        toolName: typeof event.name === 'string' ? event.name : undefined,
        grantKey: typeof event.grantKey === 'string' ? event.grantKey : undefined,
        allowed: typeof event.allowed === 'boolean' ? event.allowed : undefined,
        scope: typeof event.scope === 'string' ? event.scope : undefined,
        payload: event,
      });
    };
    const agent = new AgentRuntime({
      router: new ConfirmFlowRouter() as never,
      systemPrompt: 'test',
      maxTokens: 1024,
      toolRegistry: (() => {
        const registry = new ToolRegistry();
        registry.register({
          definition: {
            name: 'secure_action',
            description: 'mock protected tool',
            parameters: { type: 'object', properties: {} },
          },
          permission: 'owner',
          confirmRequired: true,
          buildConfirmRequest: (args) => ({
            message: '该操作会修改工作区文件。',
            grantKey: 'file:write:workspace',
            preview: {
              title: '写入工作区文件',
              summary: `将写入 ${(args.path as string) || 'unknown'}`,
              riskLevel: 'high',
              targets: [String(args.path || '')],
            },
          }),
          execute: async () => ({ success: true, content: 'write ok' }),
        } as Tool);
        return registry;
      })(),
      ownerIds: [],
      store,
      auditLogger,
    });
    const server = await startGateway({ port: 0, bind: 'loopback', logger: false, agent, token: 'test-token', auditLogger });
    const port = (server.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-token`);

    try {
      await waitForOpen(ws);
      let currentSessionId = '';
      const messages = await runChat(ws, '请执行这个操作', (msg) => {
        if (msg.type === 'session' && typeof msg.sessionId === 'string') currentSessionId = msg.sessionId;
        if (msg.type !== 'confirm') return;
        ws.send(JSON.stringify({
          type: 'confirm_result',
          id: msg.id,
          allow: true,
          scope: msg.kind === 'confirm' ? 'persistent' : 'once',
        }));
      });

      if (!currentSessionId) {
        const sessionMessage = messages.find((msg) => msg.type === 'session');
        currentSessionId = String(sessionMessage?.sessionId || '');
      }

      const events = await loadAuditEvents(ws, currentSessionId);
      const eventTypes = events.map((event) => event.eventType);
      expect(eventTypes).toContain('tool_plan');
      expect(eventTypes).toContain('tool_plan_result');
      expect(eventTypes).toContain('tool_confirm_request');
      expect(eventTypes).toContain('tool_result');
    } finally {
      ws.close();
      await server.close();
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('lists and revokes persistent permission grants over websocket', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'crabcrush-grants-'));
    const store = new ConversationStore(join(tempDir, 'grants.db'));
    store.savePermissionGrant({
      principalKey: 'webchat:default',
      grantKey: 'web:example.com',
      scope: 'persistent',
      resourceType: 'domain',
      resourceValue: 'example.com',
      meta: { action: 'browse_url' },
    });
    const agent = new AgentRuntime({
      router: new ConfirmFlowRouter() as never,
      systemPrompt: 'test',
      maxTokens: 1024,
      toolRegistry: new ToolRegistry(),
      ownerIds: [],
      store,
    });
    const server = await startGateway({ port: 0, bind: 'loopback', logger: false, agent, token: 'test-token' });
    const port = (server.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-token`);

    try {
      await waitForOpen(ws);
      const grants = await loadPermissionGrants(ws);
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({
        principalKey: 'webchat:default',
        grantKey: 'web:example.com',
        resourceType: 'domain',
        resourceValue: 'example.com',
      });

      const revokeResult = await revokePermissionGrant(ws, 'web:example.com');
      expect(revokeResult).toMatchObject({
        type: 'permission_grant_revoked',
        grantKey: 'web:example.com',
        revoked: true,
      });

      const refreshed = await loadPermissionGrants(ws);
      expect(refreshed).toHaveLength(0);
    } finally {
      ws.close();
      await server.close();
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

