import { describe, it, expect } from 'vitest';
import { AgentRuntime, type ToolPlanEvent, type ToolCallEvent } from '../src/agent/runtime.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { ChatChunk, ChatMessage, ChatOptions } from '../src/models/provider.js';
import type { ConversationStore } from '../src/storage/database.js';
import type { Tool } from '../src/tools/types.js';

class MockRouter {
  private round = 0;

  async *chat(_messages: ChatMessage[], _options: ChatOptions = {}): AsyncIterable<ChatChunk> {
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
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0].preview?.title).toBe('写入文件');
    expect(toolCall).toBeTruthy();
    expect(toolCall?.name).toBe('write_like');
    expect(finalChunk).toBeTruthy();

    const planIndex = events.indexOf(plan as unknown);
    const callIndex = events.indexOf(toolCall as unknown);
    const finalIndex = events.indexOf(finalChunk as unknown);
    expect(planIndex).toBeLessThan(callIndex);
    expect(callIndex).toBeLessThan(finalIndex);
  });

  it('stops before tool execution when plan approval is denied', async () => {
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
    const cancelChunk = events.find((event) => typeof event === 'object' && event !== null && 'content' in event && String((event as { content: string }).content).includes('拒绝批准本次执行计划'));

    expect(toolCall).toBeUndefined();
    expect(cancelChunk).toBeTruthy();
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
});
