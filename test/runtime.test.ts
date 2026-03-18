import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { AgentRuntime, type ToolPlanEvent, type ToolCallEvent } from '../src/agent/runtime.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { ChatChunk, ChatMessage, ChatOptions } from '../src/models/provider.js';
import { ConversationStore } from '../src/storage/database.js';
import type { Tool } from '../src/tools/types.js';

class MockRouter {
  private round = 0;

  async *chat(_messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    if (this.round++ === 0) {
      yield {
        content: '',
        done: true,
        model: 'mock-model',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'write_like',
              arguments: JSON.stringify({ path: 'workspace/notes.md', content: 'hello' }),
            },
          },
        ],
      };
      return;
    }

    if (!options.tools || options.tools.length === 0) {
      yield { content: '工具未执行，我先给你一个不动手的方案。', done: false };
      yield { content: '', done: true, model: 'mock-model' };
      return;
    }

    yield { content: '已完成', done: false };
    yield { content: '', done: true, model: 'mock-model' };
  }
}

class MockFileEnforcementRouter {
  private round = 0;

  async *chat(_messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const currentRound = this.round++;

    if (currentRound === 0) {
      yield { content: '我找到了 test93.json，并且已经读完了。', done: false };
      yield { content: '', done: true, model: 'mock-model' };
      return;
    }

    if (currentRound === 1) {
      yield {
        content: '',
        done: true,
        model: 'mock-model',
        toolCalls: [
          {
            id: 'call-file-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'test93.json' }),
            },
          },
        ],
      };
      return;
    }

    yield { content: '已通过工具确认 test93.json 不存在。', done: false };
    yield { content: '', done: true, model: 'mock-model' };
  }
}

class MockOverwriteRetryRouter {
  private round = 0;

  async *chat(_messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const currentRound = this.round++;

    if (currentRound === 0) {
      yield {
        content: '',
        done: true,
        model: 'mock-model',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'write_like',
              arguments: JSON.stringify({ path: 'workspace/changelog.txt', content: 'v2' }),
            },
          },
        ],
      };
      return;
    }

    if (currentRound === 1) {
      yield {
        content: '',
        done: true,
        model: 'mock-model',
        toolCalls: [
          {
            id: 'call-2',
            type: 'function',
            function: {
              name: 'write_like',
              arguments: JSON.stringify({ path: 'workspace/changelog.txt', content: 'v2', overwrite: true }),
            },
          },
        ],
      };
      return;
    }

    yield { content: '已完成覆盖', done: false };
    yield { content: '', done: true, model: 'mock-model' };
  }
}

class PersistentGrantRouter {
  async *chat(messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const toolMessages = messages.filter((message) => message.role === 'tool').length;
    if (toolMessages === 0) {
      yield {
        content: '',
        done: true,
        model: 'mock-model',
        toolCalls: [
          {
            id: 'call-persistent-1',
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

    yield { content: '已完成安全操作', done: false };
    yield { content: '', done: true, model: 'mock-model' };
  }
}

class PermissionGrantRouter {
  async *chat(messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const toolMessages = messages.filter((message) => message.role === 'tool').length;
    if (toolMessages === 0) {
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

class PerRequestSecureRouter {
  async *chat(messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'tool') {
      yield { content: '已完成安全操作', done: false };
      yield { content: '', done: true, model: 'mock-model' };
      return;
    }

    yield {
      content: '',
      done: true,
      model: 'mock-model',
      toolCalls: [
        {
          id: 'call-secure-per-request-1',
          type: 'function',
          function: {
            name: 'secure_action',
            arguments: JSON.stringify({ path: 'workspace/plan.md' }),
          },
        },
      ],
    };
  }
}

class MultiStepCoveredRouter {
  async *chat(messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const toolMessages = messages.filter((message) => message.role === 'tool').length;
    if (toolMessages >= 2) {
      yield { content: '已完成多步安全操作', done: false };
      yield { content: '', done: true, model: 'mock-model' };
      return;
    }

    yield {
      content: '',
      done: true,
      model: 'mock-model',
      toolCalls: [
        {
          id: 'call-covered-1',
          type: 'function',
          function: {
            name: 'secure_fetch',
            arguments: JSON.stringify({ url: 'https://example.com' }),
          },
        },
        {
          id: 'call-covered-2',
          type: 'function',
          function: {
            name: 'secure_write',
            arguments: JSON.stringify({ path: 'C:/secured/docs/report.md' }),
          },
        },
      ],
    };
  }
}

class MixedCoverageRouter {
  async *chat(messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const toolMessages = messages.filter((message) => message.role === 'tool').length;
    if (toolMessages >= 2) {
      yield { content: '已完成混合授权任务', done: false };
      yield { content: '', done: true, model: 'mock-model' };
      return;
    }

    yield {
      content: '',
      done: true,
      model: 'mock-model',
      toolCalls: [
        {
          id: 'call-mixed-1',
          type: 'function',
          function: {
            name: 'secure_fetch',
            arguments: JSON.stringify({ url: 'https://example.com' }),
          },
        },
        {
          id: 'call-mixed-2',
          type: 'function',
          function: {
            name: 'secure_write',
            arguments: JSON.stringify({ path: 'C:/secured/docs/needs-approval.md' }),
          },
        },
      ],
    };
  }
}

class SafeAutoRouter {
  async *chat(messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'tool') {
      yield { content: '当前时间已返回', done: false };
      yield { content: '', done: true, model: 'mock-model' };
      return;
    }

    yield {
      content: '',
      done: true,
      model: 'mock-model',
      toolCalls: [
        {
          id: 'call-safe-auto-1',
          type: 'function',
          function: {
            name: 'get_current_time',
            arguments: JSON.stringify({ timezone: 'Asia/Shanghai' }),
          },
        },
      ],
    };
  }
}

function createRuntime(confirmRequired = true): AgentRuntime {
  const registry = new ToolRegistry();
  const tool: Tool = {
    definition: {
      name: 'write_like',
      description: 'mock write tool',
      parameters: { type: 'object', properties: {} },
    },
    permission: 'owner',
    confirmRequired,
    buildConfirmRequest: (args) => ({
      preview: {
        title: '写入文件',
        summary: `将写入 ${(args.path as string) || 'unknown'}`,
        riskLevel: 'high',
        targets: [String(args.path || '')],
      },
    }),
    execute: async () => ({ success: true, content: 'write ok' }),
  };
  registry.register(tool);

  return new AgentRuntime({
    router: new MockRouter() as never,
    systemPrompt: 'test',
    maxTokens: 1024,
    toolRegistry: registry,
    ownerIds: ['owner-1'],
  });
}

function createFileEnforcementRuntime(): AgentRuntime {
  const registry = new ToolRegistry();
  const tool: Tool = {
    definition: {
      name: 'read_file',
      description: 'mock read tool',
      parameters: { type: 'object', properties: {} },
    },
    permission: 'owner',
    confirmRequired: false,
    execute: async () => ({ success: false, content: '文件不存在：test93.json' }),
  };
  registry.register(tool);

  return new AgentRuntime({
    router: new MockFileEnforcementRouter() as never,
    systemPrompt: 'test',
    maxTokens: 1024,
    toolRegistry: registry,
    ownerIds: ['owner-1'],
  });
}

function createRetryRuntime(): AgentRuntime {
  const registry = new ToolRegistry();
  let attempts = 0;
  const tool: Tool = {
    definition: {
      name: 'write_like',
      description: 'mock write tool with overwrite retry',
      parameters: { type: 'object', properties: {} },
    },
    permission: 'owner',
    confirmRequired: true,
    buildConfirmRequest: (args) => ({
      preview: {
        title: Boolean(args.overwrite) ? '覆盖文件' : '写入文件',
        summary: '将写入 ' + ((args.path as string) || 'unknown'),
        riskLevel: 'high',
        targets: [String(args.path || '')],
      },
    }),
    execute: async (args) => {
      attempts += 1;
      if (!args.overwrite) {
        return { success: false, content: '文件已存在：changelog.txt。请使用 overwrite=true 重试。' };
      }
      return { success: true, content: 'write ok after ' + attempts + ' attempts' };
    },
  };
  registry.register(tool);

  return new AgentRuntime({
    router: new MockOverwriteRetryRouter() as never,
    systemPrompt: 'test',
    maxTokens: 1024,
    toolRegistry: registry,
    ownerIds: ['owner-1'],
  });
}

function createRuntimeWithStore(confirmRequired = true) {
  const savedMessages: Array<{ conversationId: string; role: 'user' | 'assistant'; content: string }> = [];
  const ensuredConversations: Array<{ conversationId: string; channel: string; senderId: string }> = [];
  const registry = new ToolRegistry();
  const tool: Tool = {
    definition: {
      name: 'write_like',
      description: 'mock write tool',
      parameters: { type: 'object', properties: {} },
    },
    permission: 'owner',
    confirmRequired,
    buildConfirmRequest: (args) => ({
      preview: {
        title: '写入文件',
        summary: `将写入 ${(args.path as string) || 'unknown'}`,
        riskLevel: 'high',
        targets: [String(args.path || '')],
      },
    }),
    execute: async () => ({ success: true, content: 'write ok' }),
  };
  registry.register(tool);

  const store = {
    ensureConversation: (conversationId: string, channel = 'webchat', senderId = '') => {
      ensuredConversations.push({ conversationId, channel, senderId });
    },
    getRecentMessages: () => [],
    saveMessage: (conversationId: string, role: 'user' | 'assistant', content: string) => {
      savedMessages.push({ conversationId, role, content });
    },
  } as Pick<ConversationStore, 'ensureConversation' | 'getRecentMessages' | 'saveMessage'> as ConversationStore;

  return {
    runtime: new AgentRuntime({
      router: new MockRouter() as never,
      systemPrompt: 'test',
      maxTokens: 1024,
      toolRegistry: registry,
      ownerIds: ['owner-1'],
      store,
    }),
    savedMessages,
    ensuredConversations,
  };
}

describe('AgentRuntime tool plan', () => {
  it('emits tool_plan before tool_call and final response', async () => {
    const runtime = createRuntime(true);
    const events: Array<unknown> = [];

    for await (const event of runtime.chat(
      'sess-1',
      '请保存到文件',
      undefined,
      'owner-1',
      async () => ({ allow: true, scope: 'once' }),
    )) {
      events.push(event);
    }

    const plan = events.find((event): event is ToolPlanEvent => typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_plan');
    const toolCall = events.find((event): event is ToolCallEvent => typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_call');
    const finalChunk = events.find((event): event is ChatChunk => typeof event === 'object' && event !== null && 'content' in event && (event as ChatChunk).content === '已完成');

    expect(plan).toBeTruthy();
    expect(plan?.operationId).toEqual(expect.any(String));
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0]?.index).toBe(1);
    expect(plan?.steps[0].preview?.title).toBe('写入文件');
    expect(toolCall).toBeTruthy();
    expect(toolCall?.operationId).toBe(plan?.operationId);
    expect(toolCall?.stepIndex).toBe(1);
    expect(toolCall?.name).toBe('write_like');
    expect(finalChunk).toBeTruthy();

    const planIndex = events.indexOf(plan as unknown);
    const callIndex = events.indexOf(toolCall as unknown);
    const finalIndex = events.indexOf(finalChunk as unknown);
    expect(planIndex).toBeLessThan(callIndex);
    expect(callIndex).toBeLessThan(finalIndex);
  });

  it('degrades to advice-only mode when plan approval is denied', async () => {
    const runtime = createRuntime(false);
    const events: Array<unknown> = [];

    for await (const event of runtime.chat(
      'sess-2',
      '请保存到文件',
      undefined,
      'owner-1',
      async (request) => request.kind === 'plan' ? ({ allow: false, scope: 'once' }) : ({ allow: true, scope: 'once' }),
    )) {
      events.push(event);
    }

    const toolCall = events.find((event) => typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_call');
    const adviceChunk = events.find((event) => typeof event === 'object' && event !== null && 'content' in event && String((event as { content: string }).content).includes('不动手的方案'));

    expect(toolCall).toBeUndefined();
    expect(adviceChunk).toBeTruthy();
  });

  it('does not keep orphan tool_calls messages after plan rejection', async () => {
    const runtime = createRuntime(false);

    for await (const _event of runtime.chat(
      'sess-reject',
      '请保存到文件',
      undefined,
      'owner-1',
      async (request) => request.kind === 'plan' ? ({ allow: false, scope: 'once' }) : ({ allow: true, scope: 'once' }),
    )) {
      // consume stream
    }

    const session = runtime.getOrCreateSession('sess-reject');
    const hasToolCallMessage = session.messages.some((message) => 'tool_calls' in message);

    expect(hasToolCallMessage).toBe(false);
  });

  it('forces a file request to use tools instead of accepting a hallucinated plain-text answer', async () => {
    const runtime = createFileEnforcementRuntime();
    const events: Array<unknown> = [];

    for await (const event of runtime.chat(
      'sess-file',
      '帮我找找 test93.json 有没有，没有就创建，有就把内容给我',
      undefined,
      'owner-1',
      async () => ({ allow: true, scope: 'once' }),
    )) {
      events.push(event);
    }

    const clearEvent = events.find((event) => typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'stream_control');
    const toolCall = events.find((event): event is ToolCallEvent => typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_call');
    const finalChunk = events.find((event): event is ChatChunk => typeof event === 'object' && event !== null && 'content' in event && (event as ChatChunk).content === '已通过工具确认 test93.json 不存在。');

    expect(clearEvent).toBeTruthy();
    expect(toolCall?.name).toBe('read_file');
    expect(finalChunk).toBeTruthy();
  });

  it('also enforces file tools for English file requests', async () => {
    const runtime = createFileEnforcementRuntime();
    const events: Array<unknown> = [];

    for await (const event of runtime.chat(
      'sess-file-en',
      'Please check whether the file exists, and create it if missing.',
      undefined,
      'owner-1',
      async () => ({ allow: true, scope: 'once' }),
    )) {
      events.push(event);
    }

    const clearEvent = events.find((event) => typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'stream_control');
    const toolCall = events.find((event): event is ToolCallEvent => typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_call');

    expect(clearEvent).toBeTruthy();
    expect(toolCall?.name).toBe('read_file');
  });

  it('allows the model to retry write_file with overwrite=true after an initial conflict', async () => {
    const runtime = createRetryRuntime();
    const events: Array<unknown> = [];

    for await (const event of runtime.chat(
      'sess-4',
      '请更新 changelog.txt',
      undefined,
      'owner-1',
      async () => ({ allow: true, scope: 'once' }),
    )) {
      events.push(event);
    }

    const toolCalls = events.filter((event): event is ToolCallEvent => typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_call');
    const finalChunk = events.find((event): event is ChatChunk => typeof event === 'object' && event !== null && 'content' in event && (event as ChatChunk).content === '已完成覆盖');

    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]?.success).toBe(false);
    expect(toolCalls[0]?.result).toContain('overwrite=true');
    expect(toolCalls[1]?.success).toBe(true);
    expect(toolCalls[1]?.args).toMatchObject({ overwrite: true });
    expect(finalChunk).toBeTruthy();
  });

  it('degrades to advice-only mode when tool confirmation is denied', async () => {
    const runtime = createRuntime(true);
    const events: Array<unknown> = [];

    for await (const event of runtime.chat(
      'sess-deny-tool',
      '请保存到文件',
      undefined,
      'owner-1',
      async (request) => request.kind === 'confirm' ? ({ allow: false, scope: 'once' }) : ({ allow: true, scope: 'once' }),
    )) {
      events.push(event);
    }

    const toolCall = events.find((event): event is ToolCallEvent => typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_call');
    const adviceChunk = events.find((event): event is ChatChunk => typeof event === 'object' && event !== null && 'content' in event && (event as ChatChunk).content.includes('不动手的方案'));

    expect(toolCall?.success).toBe(false);
    expect(toolCall?.result).toContain('用户拒绝执行工具');
    expect(adviceChunk).toBeTruthy();
  });

  it('persists tool plan and plan approval result into conversation history', async () => {
    const { runtime, savedMessages } = createRuntimeWithStore(true);

    for await (const _event of runtime.chat(
      'sess-3',
      '请保存到文件',
      undefined,
      'owner-1',
      async () => ({ allow: true, scope: 'once' }),
    )) {
      // consume stream
    }

    const planBlock = savedMessages.find((message) => message.content.startsWith('__TOOL_PLAN__\n'));
    const resultBlock = savedMessages.find((message) => message.content.startsWith('__TOOL_PLAN_RESULT__\n'));

    expect(planBlock).toBeTruthy();
    expect(planBlock?.content).toContain('"summary":"准备执行 1 个步骤"');
    expect(resultBlock).toBeTruthy();
    expect(resultBlock?.content).toContain('"allowed":true');
  });

  it('persists channel and sender metadata when creating a conversation', async () => {
    const { runtime, ensuredConversations } = createRuntimeWithStore(false);

    for await (const _event of runtime.chat(
      'dingtalk-user-1',
      '你好',
      undefined,
      'staff-001',
      async () => ({ allow: true, scope: 'once' }),
      'dingtalk',
    )) {
      // consume stream
    }

    expect(ensuredConversations).toHaveLength(1);
    expect(ensuredConversations[0]).toMatchObject({
      conversationId: 'dingtalk-user-1',
      channel: 'dingtalk',
      senderId: 'staff-001',
    });
  });

  it('skips execute_plan for safe_auto read-only tools even without persisted grants', async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'get_current_time',
        description: 'mock time tool',
        parameters: { type: 'object', properties: {} },
      },
      permission: 'public',
      confirmRequired: false,
      planPolicy: 'safe_auto',
      execute: async () => ({ success: true, content: '当前时间（Asia/Shanghai）：2026/03/17 星期二 17:30:00' }),
    } as Tool);

    const runtime = new AgentRuntime({
      router: new SafeAutoRouter() as never,
      systemPrompt: 'test',
      maxTokens: 1024,
      toolRegistry: registry,
      ownerIds: ['owner-1'],
    });

    const requests: string[] = [];
    const events: Array<unknown> = [];
    for await (const event of runtime.chat(
      'sess-safe-auto',
      '现在几点',
      undefined,
      'owner-1',
      async (request) => {
        requests.push(request.kind || 'unknown');
        return { allow: true, scope: 'once' };
      },
      'webchat',
    )) {
      events.push(event);
    }

    const toolCall = events.find((event): event is ToolCallEvent =>
      typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_call');
    expect(toolCall?.name).toBe('get_current_time');
    expect(requests).toEqual([]);
  });

  it('reuses persistent grants across runtime restarts for the same principal', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'crabcrush-runtime-'));
    const dbPath = join(tempDir, 'runtime.db');
    const store = new ConversationStore(dbPath);
    const createRuntime = () => {
      const registry = new ToolRegistry();
      registry.register({
        definition: {
          name: 'secure_action',
          description: 'mock secure tool',
          parameters: { type: 'object', properties: {} },
        },
        permission: 'owner',
        confirmRequired: true,
        buildConfirmRequest: () => ({
          grantKey: 'web:example.com',
          preview: {
            title: '访问外部网页',
            summary: '将访问 example.com',
            riskLevel: 'medium',
            targets: ['example.com'],
          },
        }),
        execute: async () => ({ success: true, content: 'secure ok' }),
      } as Tool);

      return new AgentRuntime({
        router: new PersistentGrantRouter() as never,
        systemPrompt: 'test',
        maxTokens: 1024,
        toolRegistry: registry,
        ownerIds: ['owner-1'],
        store,
      });
    };

    try {
      const firstRuntime = createRuntime();
      const firstRequests: string[] = [];
      for await (const _event of firstRuntime.chat(
        'sess-persistent-1',
        '请执行安全操作',
        undefined,
        'owner-1',
        async (request) => {
          firstRequests.push(request.kind || 'unknown');
          return { allow: true, scope: request.kind === 'confirm' ? 'persistent' : 'once' };
        },
        'webchat',
      )) {
        // consume stream
      }

      const secondRuntime = createRuntime();
      const secondRequests: string[] = [];
      const secondEvents: Array<unknown> = [];
      for await (const _event of secondRuntime.chat(
        'sess-persistent-2',
        '再执行一次安全操作',
        undefined,
        'owner-1',
        async (request) => {
          secondRequests.push(request.kind || 'unknown');
          return { allow: true, scope: 'once' };
        },
        'webchat',
      )) {
        secondEvents.push(_event);
      }

      expect(firstRequests).toEqual(['plan', 'confirm']);
      expect(secondRequests).toEqual([]);
      expect(store.hasActivePermissionGrant('webchat:default', 'web:example.com')).toBe(true);
      const planEvent = secondEvents.find((event): event is ToolPlanEvent =>
        typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_plan');
      const toolCall = secondEvents.find((event): event is ToolCallEvent =>
        typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_call');
      expect(planEvent).toBeTruthy();
      expect(toolCall?.name).toBe('secure_action');
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('skips execute_plan for permission-request tools once the grant is already persisted', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'crabcrush-runtime-perm-'));
    const dbPath = join(tempDir, 'runtime.db');
    const store = new ConversationStore(dbPath);
    const createRuntime = () => {
      const registry = new ToolRegistry();
      registry.register({
        definition: {
          name: 'scan_like',
          description: 'mock scan tool',
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
        router: new PermissionGrantRouter() as never,
        systemPrompt: 'test',
        maxTokens: 1024,
        toolRegistry: registry,
        ownerIds: ['owner-1'],
        store,
      });
    };

    try {
      const firstRuntime = createRuntime();
      const firstRequests: string[] = [];
      for await (const _event of firstRuntime.chat(
        'sess-perm-1',
        '请扫描这个目录',
        undefined,
        'owner-1',
        async (request) => {
          firstRequests.push(request.kind || 'unknown');
          return { allow: true, scope: request.kind === 'permission_request' ? 'persistent' : 'once' };
        },
        'webchat',
      )) {
        // consume stream
      }

      const secondRuntime = createRuntime();
      const secondRequests: string[] = [];
      for await (const _event of secondRuntime.chat(
        'sess-perm-2',
        '再扫描一次这个目录',
        undefined,
        'owner-1',
        async (request) => {
          secondRequests.push(request.kind || 'unknown');
          return { allow: true, scope: 'once' };
        },
        'webchat',
      )) {
        // consume stream
      }

      expect(firstRequests).toEqual(['plan', 'permission_request']);
      expect(secondRequests).toEqual([]);
      expect(store.hasActivePermissionGrant('webchat:default', 'file:list:C:/secured/docs')).toBe(true);
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('skips execute_plan for multi-step plans when every step is already grant-covered', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'crabcrush-runtime-covered-'));
    const dbPath = join(tempDir, 'runtime.db');
    const store = new ConversationStore(dbPath);
    store.savePermissionGrant({
      principalKey: 'webchat:default',
      grantKey: 'web:example.com',
      scope: 'persistent',
      resourceType: 'domain',
      resourceValue: 'example.com',
      meta: { action: 'secure_fetch' },
    });
    store.savePermissionGrant({
      principalKey: 'webchat:default',
      grantKey: 'file:write:C:/secured/docs/report.md',
      scope: 'persistent',
      resourceType: 'path',
      resourceValue: 'C:/secured/docs/report.md',
      meta: { action: 'secure_write' },
    });

    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'secure_fetch',
        description: 'mock secured web fetch',
        parameters: { type: 'object', properties: {} },
      },
      permission: 'owner',
      confirmRequired: true,
      buildConfirmRequest: () => ({
        grantKey: 'web:example.com',
        preview: {
          title: '访问外部网页',
          summary: '将访问 example.com',
          riskLevel: 'medium',
          targets: ['example.com'],
        },
      }),
      execute: async () => ({ success: true, content: 'fetch ok' }),
    } as Tool);
    registry.register({
      definition: {
        name: 'secure_write',
        description: 'mock secured file write',
        parameters: { type: 'object', properties: {} },
      },
      permission: 'owner',
      confirmRequired: true,
      buildConfirmRequest: () => ({
        grantKey: 'file:write:C:/secured/docs/report.md',
        preview: {
          title: '写入报告',
          summary: '将写入报告文件',
          riskLevel: 'high',
          targets: ['C:/secured/docs/report.md'],
        },
      }),
      execute: async () => ({ success: true, content: 'write ok' }),
    } as Tool);

    const runtime = new AgentRuntime({
      router: new MultiStepCoveredRouter() as never,
      systemPrompt: 'test',
      maxTokens: 1024,
      toolRegistry: registry,
      ownerIds: ['owner-1'],
      store,
    });

    try {
      const requests: string[] = [];
      const events: Array<unknown> = [];
      for await (const event of runtime.chat(
        'sess-covered',
        '请继续执行这个已授权的多步任务',
        undefined,
        'owner-1',
        async (request) => {
          requests.push(request.kind || 'unknown');
          return { allow: true, scope: 'once' };
        },
        'webchat',
      )) {
        events.push(event);
      }

      const toolCalls = events.filter((event): event is ToolCallEvent =>
        typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_call');
      const planEvent = events.find((event): event is ToolPlanEvent =>
        typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'tool_plan');

      expect(planEvent?.steps).toHaveLength(2);
      expect(planEvent?.steps.map((step) => step.index)).toEqual([1, 2]);
      expect(toolCalls.map((event) => event.name)).toEqual(['secure_fetch', 'secure_write']);
      expect(toolCalls.map((event) => event.stepIndex)).toEqual([1, 2]);
      expect(toolCalls.every((event) => event.operationId === planEvent?.operationId)).toBe(true);
      expect(requests).toEqual([]);
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not refresh persistent grant lastUsedAt when plan is only evaluated but denied', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'crabcrush-runtime-plan-touch-'));
    const dbPath = join(tempDir, 'runtime.db');
    const store = new ConversationStore(dbPath);
    store.savePermissionGrant({
      principalKey: 'webchat:default',
      grantKey: 'web:example.com',
      scope: 'persistent',
      resourceType: 'domain',
      resourceValue: 'example.com',
      meta: { action: 'secure_fetch' },
    });

    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'secure_fetch',
        description: 'mock secured web fetch',
        parameters: { type: 'object', properties: {} },
      },
      permission: 'owner',
      confirmRequired: true,
      buildConfirmRequest: () => ({
        grantKey: 'web:example.com',
        preview: {
          title: '访问外部网页',
          summary: '将访问 example.com',
          riskLevel: 'medium',
          targets: ['example.com'],
        },
      }),
      execute: async () => ({ success: true, content: 'fetch ok' }),
    } as Tool);
    registry.register({
      definition: {
        name: 'secure_write',
        description: 'mock secured file write',
        parameters: { type: 'object', properties: {} },
      },
      permission: 'owner',
      confirmRequired: true,
      buildConfirmRequest: () => ({
        grantKey: 'file:write:C:/secured/docs/needs-approval.md',
        preview: {
          title: '写入报告',
          summary: '将写入报告文件',
          riskLevel: 'high',
          targets: ['C:/secured/docs/needs-approval.md'],
        },
      }),
      execute: async () => ({ success: true, content: 'write ok' }),
    } as Tool);

    const runtime = new AgentRuntime({
      router: new MixedCoverageRouter() as never,
      systemPrompt: 'test',
      maxTokens: 1024,
      toolRegistry: registry,
      ownerIds: ['owner-1'],
      store,
    });

    try {
      const before = store.listPermissionGrants('webchat:default')[0]?.lastUsedAt ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 10));

      for await (const _event of runtime.chat(
        'sess-mixed-plan',
        '先检查网页再写入文件',
        undefined,
        'owner-1',
        async (request) => request.kind === 'plan' ? ({ allow: false, scope: 'once' }) : ({ allow: true, scope: 'once' }),
        'webchat',
      )) {
        // consume stream
      }

      const after = store.listPermissionGrants('webchat:default')[0]?.lastUsedAt ?? 0;
      expect(after).toBe(before);
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('revokes in-memory grants only for the matching principal', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'crabcrush-runtime-revoke-'));
    const dbPath = join(tempDir, 'runtime.db');
    const store = new ConversationStore(dbPath);
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'secure_action',
        description: 'mock secure tool',
        parameters: { type: 'object', properties: {} },
      },
      permission: 'owner',
      confirmRequired: true,
      buildConfirmRequest: () => ({
        grantKey: 'web:example.com',
        preview: {
          title: '访问外部网页',
          summary: '将访问 example.com',
          riskLevel: 'medium',
          targets: ['example.com'],
        },
      }),
      execute: async () => ({ success: true, content: 'secure ok' }),
    } as Tool);

    const runtime = new AgentRuntime({
      router: new PerRequestSecureRouter() as never,
      systemPrompt: 'test',
      maxTokens: 1024,
      toolRegistry: registry,
      ownerIds: ['staff-a', 'staff-b'],
      store,
    });

    try {
      const firstRequests: string[] = [];
      for await (const _event of runtime.chat(
        'sess-a',
        '请执行安全操作',
        undefined,
        'staff-a',
        async (request) => {
          firstRequests.push(request.kind || 'unknown');
          return { allow: true, scope: request.kind === 'confirm' ? 'persistent' : 'once' };
        },
        'dingtalk',
      )) {
        // consume stream
      }

      const secondRequests: string[] = [];
      for await (const _event of runtime.chat(
        'sess-b',
        '请执行安全操作',
        undefined,
        'staff-b',
        async (request) => {
          secondRequests.push(request.kind || 'unknown');
          return { allow: true, scope: request.kind === 'confirm' ? 'session' : 'once' };
        },
        'dingtalk',
      )) {
        // consume stream
      }

      expect(runtime.revokePermissionGrant('web:example.com', 'dingtalk', 'staff-a')).toBe(true);
      expect(store.hasActivePermissionGrant('dingtalk:staff-a', 'web:example.com')).toBe(false);

      const thirdRequests: string[] = [];
      for await (const _event of runtime.chat(
        'sess-b',
        '再执行一次安全操作',
        undefined,
        'staff-b',
        async (request) => {
          thirdRequests.push(request.kind || 'unknown');
          return { allow: true, scope: 'once' };
        },
        'dingtalk',
      )) {
        // consume stream
      }

      expect(firstRequests).toEqual(['plan', 'confirm']);
      expect(secondRequests).toEqual(['plan', 'confirm']);
      expect(thirdRequests).toEqual([]);
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

