/**
 * Agent Runtime
 * 管理会话、维护上下文、调用模型、执行工具调用
 *
 * Phase 2a 改造：
 * - 对话持久化到 SQLite
 * - 滑动窗口：只发最近 N 条消息给 API
 * - Function Calling：模型请求 → 执行工具 → 返回结果 → 模型继续
 */

import type { ChatMessage, ChatChunk, ChatOptions, ToolCall } from '../models/provider.js';
import type { ModelRouter } from '../models/router.js';
import type { ConversationStore } from '../storage/database.js';
import type { ToolRegistry } from '../tools/registry.js';
import type {
  ConfirmationScope,
  ToolContext,
  ToolConfirmHandler,
  ToolExecutionPreview,
  PermissionRequest,
} from '../tools/types.js';
import { looksLikeFileToolRequest } from '../tools/intent.js';
import {
  getWorkspacePath,
  ensureWorkspaceDir,
  readWorkspaceFiles,
  buildSystemPrompt,
} from '../workspace/index.js';

export interface Session {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  lastActiveAt: number;
}

export interface AgentRuntimeOptions {
  router: ModelRouter;
  /** 基础 system prompt（会与工作区内容、Bootstrap 组装） */
  systemPrompt: string;
  maxTokens: number;
  /** SQLite 存储（不传则纯内存模式，重启丢失） */
  store?: ConversationStore;
  /** 发给 API 的最大消息条数（默认 40 条 = 最近 20 轮） */
  contextWindow?: number;
  /** 调试模式：打印发给模型的上下文摘要 */
  debug?: boolean;
  /** 工具注册中心 */
  toolRegistry?: ToolRegistry;
  /** Owner 用户 ID 列表（钉钉 userId / WebChat sessionId） */
  ownerIds?: string[];
  /** 文件工具根目录（与 write_file 的 fileBase 一致，确保工作区读写路径一致） */
  fileBase?: string;
  /** 审计日志回调（可选） */
  auditLogger?: (event: { type: string; [key: string]: unknown }) => void;
}

/** 工具调用事件 — 通过 yield 返回给调用方，用于 UI 展示 */
export interface ToolCallEvent {
  type: 'tool_call';
  name: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
}

export interface ToolPlanStep {
  name: string;
  args: Record<string, unknown>;
  preview?: ToolExecutionPreview;
}

export interface ToolPlanEvent {
  type: 'tool_plan';
  round: number;
  summary: string;
  steps: ToolPlanStep[];
}

/** 流式控制事件（用于撤回已输出内容） */
export interface StreamControlEvent {
  type: 'stream_control';
  action: 'clear_last';
  reason: 'tool_calls';
}

/** 最大工具调用轮次（防止无限循环） */
const MAX_TOOL_ROUNDS = 5;

/** 工具调用持久化格式：供 loadHistory 后前端解析渲染 */
const TOOL_BLOCK_START = '__TOOL_CALL__\n';
const TOOL_PLAN_BLOCK_START = '__TOOL_PLAN__\n';
const TOOL_PLAN_RESULT_BLOCK_START = '__TOOL_PLAN_RESULT__\n';
const TOOL_BLOCK_END = '\n__END__';
const FILE_TOOL_REQUIRED_MESSAGE = '当前请求涉及文件状态或文件读写，但模型本轮没有调用必要工具。我需要先通过工具确认后才能继续，请重试。';

function serializeToolBlock(t: { name: string; args: Record<string, unknown>; result: string; success: boolean }): string {
  return TOOL_BLOCK_START + JSON.stringify(t) + TOOL_BLOCK_END;
}

function serializeToolPlanBlock(t: { round: number; summary: string; steps: ToolPlanStep[] }): string {
  return TOOL_PLAN_BLOCK_START + JSON.stringify(t) + TOOL_BLOCK_END;
}

function serializeToolPlanResultBlock(t: { round: number; allowed: boolean }): string {
  return TOOL_PLAN_RESULT_BLOCK_START + JSON.stringify(t) + TOOL_BLOCK_END;
}

export function parseToolBlocks(content: string): Array<{ name: string; args: Record<string, unknown>; result: string; success: boolean }> | null {
  if (!content.startsWith(TOOL_BLOCK_START)) return null;
  const blocks: Array<{ name: string; args: Record<string, unknown>; result: string; success: boolean }> = [];
  let rest = content;
  while (rest.startsWith(TOOL_BLOCK_START)) {
    const endIdx = rest.indexOf(TOOL_BLOCK_END);
    if (endIdx < 0) break;
    const json = rest.slice(TOOL_BLOCK_START.length, endIdx);
    try {
      blocks.push(JSON.parse(json));
    } catch {
      // 单条解析失败跳过
    }
    rest = rest.slice(endIdx + TOOL_BLOCK_END.length).replace(/^\n+/, '');
  }
  return blocks.length > 0 ? blocks : null;
}

export class AgentRuntime {
  private sessions = new Map<string, Session>();
  private sessionPermissionGrants = new Map<string, Set<string>>();
  private router: ModelRouter;
  private basePrompt: string;
  private maxTokens: number;
  private store?: ConversationStore;
  private contextWindow: number;
  private debug: boolean;
  private toolRegistry?: ToolRegistry;
  private ownerIds: Set<string>;
  private workspacePath: string;
  private auditLogger?: (event: { type: string; [key: string]: unknown }) => void;

  constructor(options: AgentRuntimeOptions) {
    this.router = options.router;
    this.basePrompt = options.systemPrompt;
    this.maxTokens = options.maxTokens;
    this.store = options.store;
    this.contextWindow = options.contextWindow ?? 40;
    this.debug = options.debug ?? false;
    this.toolRegistry = options.toolRegistry;
    this.ownerIds = new Set(options.ownerIds ?? []);
    this.workspacePath = getWorkspacePath(options.fileBase);
    this.auditLogger = options.auditLogger;
    ensureWorkspaceDir(this.workspacePath);
  }

  /**
   * 获取当前应使用的 system prompt（含工作区人格注入）
   * 工作区路径与 write_file 的 fileBase 一致，确保跨会话共享人格数据
   */
  private async resolveSystemPrompt(): Promise<string> {
    const content = await readWorkspaceFiles(this.workspacePath);
    return buildSystemPrompt(this.basePrompt, content);
  }

  private getGrantSet(sessionId: string): Set<string> {
    let grants = this.sessionPermissionGrants.get(sessionId);
    if (!grants) {
      grants = new Set<string>();
      this.sessionPermissionGrants.set(sessionId, grants);
    }
    return grants;
  }

  private hasPermissionGrant(sessionId: string, grantKey: string): boolean {
    return this.getGrantSet(sessionId).has(grantKey);
  }

  private rememberPermissionGrant(sessionId: string, grantKey: string, scope: ConfirmationScope): void {
    if (scope !== 'session') return;
    this.getGrantSet(sessionId).add(grantKey);
    this.auditLogger?.({ type: 'permission_grant_saved', sessionId, grantKey, scope });
  }

  private buildToolPlan(toolCalls: ToolCall[], argsList: Array<Record<string, unknown>>, toolContext: ToolContext): ToolPlanStep[] {
    return toolCalls.map((tc, index) => {
      const args = argsList[index] ?? {};
      const preview = this.toolRegistry?.get(tc.function.name)?.buildConfirmRequest?.(args, toolContext).preview;
      return { name: tc.function.name, args, preview };
    });
  }

  private buildPlanPreview(planSummary: string, planSteps: ToolPlanStep[]): ToolExecutionPreview {
    const highRiskCount = planSteps.filter((step) => step.preview?.riskLevel === 'high').length;
    const targets = planSteps.map((step, index) => {
      const title = step.preview?.title || step.name;
      return `${index + 1}. ${title}`;
    });
    return {
      title: '批准执行计划',
      summary: highRiskCount > 0
        ? `${planSummary}，其中包含 ${highRiskCount} 个高风险步骤。`
        : planSummary,
      riskLevel: highRiskCount > 0 ? 'high' : 'medium',
      targets,
    };
  }

  private shouldRequireFileTool(userMessage: string): boolean {
    if (!this.toolRegistry || this.toolRegistry.size === 0) return false;
    if (!this.toolRegistry.get('read_file') && !this.toolRegistry.get('list_files') && !this.toolRegistry.get('write_file')) return false;
    // 这里只做“是否需要强制先走文件工具”的兜底判断，不把它当成真实语义理解。
    // 真正可靠的事实来源仍然必须是 read_file / list_files / write_file 的执行结果。
    return looksLikeFileToolRequest(userMessage);
  }

  /**
   * 获取或创建会话
   */
  getOrCreateSession(sessionId: string, channel = 'webchat', senderId = ''): Session {
    let session = this.sessions.get(sessionId);
    if (!session) {
      let messages: ChatMessage[] = [];
      if (this.store) {
        this.store.ensureConversation(sessionId, channel, senderId);
        const stored = this.store.getRecentMessages(sessionId, this.contextWindow);
        messages = stored
          .filter((m) => !(m.role === 'assistant' && (m.content.startsWith(TOOL_BLOCK_START) || m.content.startsWith(TOOL_PLAN_BLOCK_START) || m.content.startsWith(TOOL_PLAN_RESULT_BLOCK_START))))
          .map((m) => ({ role: m.role as ChatMessage['role'], content: m.content }));
      }

      session = { id: sessionId, messages, createdAt: Date.now(), lastActiveAt: Date.now() };
      this.sessions.set(sessionId, session);
    }
    session.lastActiveAt = Date.now();
    return session;
  }

  /**
   * 处理用户消息，流式返回模型回复
   * 支持 Function Calling 循环：模型请求工具 → 执行 → 返回结果 → 模型继续
   *
   * yield 的类型：
   * - ChatChunk: 模型的流式文本回复
   * - ToolCallEvent: 工具调用事件（用于 UI 展示）
   */
  async *chat(
    sessionId: string,
    userMessage: string,
    signal?: AbortSignal,
    senderId?: string,
    confirmToolCall?: ToolConfirmHandler,
    channel = 'webchat',
  ): AsyncIterable<ChatChunk | ToolCallEvent | ToolPlanEvent | StreamControlEvent> {
    const session = this.getOrCreateSession(sessionId, channel, senderId ?? '');

    // 记录用户消息
    session.messages.push({ role: 'user', content: userMessage });
    this.store?.saveMessage(sessionId, 'user', userMessage);
    this.auditLogger?.({ type: 'chat_input', sessionId, senderId: senderId ?? sessionId, length: userMessage.length });

    // 解析 system prompt（含工作区注入）
    const systemPrompt = await this.resolveSystemPrompt();

    // 工具调用循环
    let toolRound = 0;
    const accumulatedToolCalls: Array<{ name: string; args: Record<string, unknown>; result: string; success: boolean }> = [];
    let stopAfterToolRound = false;
    let stopReason: string | null = null;
    let fileToolReminderUsed = false;

    while (toolRound <= MAX_TOOL_ROUNDS) {
      // 滑动窗口
      const recentMessages = session.messages.slice(-this.contextWindow);
      const toolEnforcementHint = fileToolReminderUsed
        ? '\n【工具强制要求】当前用户请求涉及文件状态或文件读写。你必须优先调用 read_file / list_files / write_file 等工具完成检查或写入，不能直接口头声称文件存在、已创建或已更新。'
        : '';
      const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt + toolEnforcementHint }, ...recentMessages];

      if (this.debug) {
        const historyCount = recentMessages.length;
        const totalCount = session.messages.length;
        console.log(
          `[Context] 会话 ${sessionId.slice(0, 8)}... | 总消息 ${totalCount} 条, 发送 ${historyCount} 条 (窗口 ${this.contextWindow})` +
          (toolRound > 0 ? ` | 工具调用第 ${toolRound} 轮` : ''),
        );
        for (const m of recentMessages) {
          const preview = m.content.length > 40 ? m.content.slice(0, 40) + '...' : m.content;
          console.log(`  [${m.role}] ${preview}`);
        }
      }

      // 构建 chatOptions（带工具定义）
      const isOwner = this.isOwner(senderId);
      const chatOptions: ChatOptions = { maxTokens: this.maxTokens, signal };
      // 如果有注册的工具，传给模型
      if (this.toolRegistry && this.toolRegistry.size > 0) {
        chatOptions.tools = this.toolRegistry.getDefinitionsForModel(isOwner);
      }

      // 调用模型
      let fullContent = '';
      let toolCalls: ToolCall[] | undefined;
      let streamedContent = false;

      try {
        for await (const chunk of this.router.chat(messages, chatOptions)) {
          if (chunk.toolCalls) toolCalls = chunk.toolCalls;
          if (chunk.content) fullContent += chunk.content;
          // 只 yield ChatChunk 类型（文本内容）
          yield chunk;
          if (chunk.content) streamedContent = true;
        }
      } catch (err) {
        if (fullContent) {
          session.messages.push({ role: 'assistant', content: fullContent });
          this.store?.saveMessage(sessionId, 'assistant', fullContent);
        }
        throw err;
      }

      // 情况 1: 模型返回了纯文本回复（没有工具调用），正常结束
      if (!toolCalls || toolCalls.length === 0) {
        if (toolRound === 0 && this.shouldRequireFileTool(userMessage)) {
          if (!fileToolReminderUsed) {
            fileToolReminderUsed = true;
            if (streamedContent || fullContent) {
              yield { type: 'stream_control', action: 'clear_last', reason: 'tool_calls' };
            }
            continue;
          }

          if (streamedContent || fullContent) {
            yield { type: 'stream_control', action: 'clear_last', reason: 'tool_calls' };
          }
          session.messages.push({ role: 'assistant', content: FILE_TOOL_REQUIRED_MESSAGE });
          this.store?.saveMessage(sessionId, 'assistant', FILE_TOOL_REQUIRED_MESSAGE);
          yield { content: FILE_TOOL_REQUIRED_MESSAGE, done: false };
          yield { content: '', done: true };
          break;
        }

        if (fullContent) {
          session.messages.push({ role: 'assistant', content: fullContent });
          // 若有工具调用，先持久化工具块供刷新后展示
          if (accumulatedToolCalls.length > 0) {
            const toolBlockContent = accumulatedToolCalls.map((t) => serializeToolBlock(t)).join('\n');
            this.store?.saveMessage(sessionId, 'assistant', toolBlockContent);
          }
          this.store?.saveMessage(sessionId, 'assistant', fullContent);
        }
        break;
      }

      // 情况 2: 模型请求了工具调用
      toolRound++;
      if (this.debug) {
        console.log(`[Tools] 模型请求 ${toolCalls.length} 个工具调用:`);
        for (const tc of toolCalls) console.log(`  → ${tc.function.name}(${tc.function.arguments})`);
      }

      if (streamedContent) {
        yield { type: 'stream_control', action: 'clear_last', reason: 'tool_calls' };
      }


      // 逐个执行工具
      const requestPermission = confirmToolCall
        ? async (req: PermissionRequest) => {
          if (req.grantKey && this.hasPermissionGrant(sessionId, req.grantKey)) {
            this.auditLogger?.({ type: 'permission_request_reused', sessionId, senderId: senderId ?? sessionId, action: req.action, grantKey: req.grantKey });
            return true;
          }

          const decision = await confirmToolCall({
            name: req.action,
            args: req.params ?? {},
            sessionId,
            senderId: senderId ?? sessionId,
            kind: 'permission_request',
            message: req.message,
            preview: req.preview,
            scopeOptions: req.scopeOptions,
            defaultScope: req.defaultScope,
            grantKey: req.grantKey,
          });

          this.auditLogger?.({
            type: 'permission_request_result',
            sessionId,
            senderId: senderId ?? sessionId,
            action: req.action,
            allowed: decision.allow,
            scope: decision.scope,
            grantKey: req.grantKey,
          });

          if (decision.allow && req.grantKey) {
            this.rememberPermissionGrant(sessionId, req.grantKey, decision.scope ?? req.defaultScope ?? 'once');
          }
          return decision.allow;
        }
        : undefined;

      const toolContext: ToolContext = {
        senderId: senderId ?? sessionId,
        isOwner,
        sessionId,
        confirm: confirmToolCall,
        requestPermission,
        hasPermissionGrant: (grantKey: string) => this.hasPermissionGrant(sessionId, grantKey),
        rememberPermissionGrant: (grantKey: string, scope: ConfirmationScope) => this.rememberPermissionGrant(sessionId, grantKey, scope),
        audit: this.auditLogger,
        userMessage,
      };

      const parsedArgsList: Array<Record<string, unknown>> = [];
      for (const tc of toolCalls) {
        try {
          parsedArgsList.push(JSON.parse(tc.function.arguments));
        } catch {
          parsedArgsList.push({});
        }
      }

      const planSteps = this.buildToolPlan(toolCalls, parsedArgsList, toolContext);
      const planSummary = planSteps.length === 1 ? '准备执行 1 个步骤' : `准备执行 ${planSteps.length} 个步骤`;
      this.auditLogger?.({ type: 'tool_plan', sessionId, senderId: senderId ?? sessionId, round: toolRound, steps: planSteps.map((s) => s.name) });
      this.store?.saveMessage(
        sessionId,
        'assistant',
        serializeToolPlanBlock({ round: toolRound, summary: planSummary, steps: planSteps }),
      );
      yield { type: 'tool_plan', round: toolRound, summary: planSummary, steps: planSteps };

      if (confirmToolCall) {
        const planDecision = await confirmToolCall({
          name: 'execute_plan',
          args: {
            round: toolRound,
            steps: planSteps.map((step, index) => ({ index: index + 1, name: step.name, args: step.args })),
          },
          sessionId,
          senderId: senderId ?? sessionId,
          kind: 'plan',
          message: '即将执行上述计划。批准后才会开始逐步执行和确认。',
          preview: this.buildPlanPreview(planSummary, planSteps),
          scopeOptions: ['once'],
          defaultScope: 'once',
        });

        this.auditLogger?.({
          type: 'tool_plan_result',
          sessionId,
          senderId: senderId ?? sessionId,
          allowed: planDecision.allow,
          round: toolRound,
        });
        this.store?.saveMessage(
          sessionId,
          'assistant',
          serializeToolPlanResultBlock({ round: toolRound, allowed: planDecision.allow }),
        );

        if (!planDecision.allow) {
          const cancelMsg = '工具未执行：用户拒绝批准本次执行计划。';
          session.messages.push({ role: 'assistant', content: cancelMsg });
          this.store?.saveMessage(sessionId, 'assistant', cancelMsg);
          yield { content: cancelMsg, done: false };
          yield { content: '', done: true };
          break;
        }
      }

      const assistantMsg: ChatMessage = { role: 'assistant', content: '', tool_calls: toolCalls };
      session.messages.push(assistantMsg);

      for (let index = 0; index < toolCalls.length; index++) {
        const tc = toolCalls[index];
        const args = parsedArgsList[index] ?? {};

        this.auditLogger?.({ type: 'tool_call', sessionId, senderId: senderId ?? sessionId, name: tc.function.name });

        const result = this.toolRegistry
          ? await this.toolRegistry.execute(tc.function.name, args, toolContext)
          : { success: false, content: '工具系统未启用' };

        this.auditLogger?.({ type: 'tool_result', sessionId, senderId: senderId ?? sessionId, name: tc.function.name, success: result.success });

        if (!result.success) {
          const msg = result.content || '';
          if (msg.includes('用户拒绝执行工具') || msg.includes('确认超时') || msg.includes('需要用户确认')) {
            stopAfterToolRound = true;
            stopReason = msg;
          }
        }

        if (this.debug) {
          console.log(`  ← ${tc.function.name}: ${result.success ? '✓' : '✗'} ${result.content.slice(0, 100)}`);
        }

        yield { type: 'tool_call', name: tc.function.name, args, result: result.content, success: result.success };
        accumulatedToolCalls.push({ name: tc.function.name, args, result: result.content, success: result.success });

        const toolMsg: ChatMessage = { role: 'tool', content: result.content, tool_call_id: tc.id };
        session.messages.push(toolMsg);
      }

      if (stopAfterToolRound) {
        // 用户拒绝/超时确认时，不再继续让模型生成回复，避免误导性响应
        if (accumulatedToolCalls.length > 0) {
          const toolBlockContent = accumulatedToolCalls.map((t) => serializeToolBlock(t)).join('\n');
          this.store?.saveMessage(sessionId, 'assistant', toolBlockContent);
        }
        const cancelMsg = stopReason ? '工具未执行：' + stopReason : '已取消该操作。';
        session.messages.push({ role: 'assistant', content: cancelMsg });
        this.store?.saveMessage(sessionId, 'assistant', cancelMsg);
        yield { content: cancelMsg, done: false };
        yield { content: '', done: true };
        break;
      }
    }

    // 内存中保持滑动窗口
    if (session.messages.length > this.contextWindow * 2) {
      session.messages = session.messages.slice(-this.contextWindow);
    }
  }

  /**
   * 判断发送者是否是 owner（DEC-026）
   * 未配置 ownerIds 时默认所有人都是 owner（单用户场景）
   */
  private isOwner(senderId?: string): boolean {
    if (this.ownerIds.size === 0) return true;
    if (!senderId) return false;
    return this.ownerIds.has(senderId);
  }

  /**
   * 获取会话列表（用于 WebChat 多会话切换）
   */
  listConversations(limit = 50, offset = 0, channel = 'webchat'): Array<{ id: string; title: string; lastActiveAt: number; messageCount: number }> {
    if (!this.store) return [];
    return this.store.listConversations(limit, offset, channel).map((c) => ({
      id: c.id,
      title: c.title || '（无标题）',
      lastActiveAt: c.lastActiveAt,
      messageCount: c.messageCount,
    }));
  }

  /**
   * 获取会话的历史消息（用于 WebChat 加载历史）
   * @param limit 限制条数；未传或 0 时返回全部（用于导出等）
   * @param offset 跳过前 N 条最晚的，用于分页加载更早的消息
   */
  getHistory(sessionId: string, limit?: number, offset?: number): ChatMessage[] {
    if (this.store) {
      if (limit && limit > 0) {
        const stored = this.store.getRecentMessages(sessionId, limit, offset ?? 0);
        return stored.map(m => ({ role: m.role as ChatMessage['role'], content: m.content }));
      }
      return this.store.getAllMessages(sessionId).map(m => ({ role: m.role as ChatMessage['role'], content: m.content }));
    }
    const session = this.sessions.get(sessionId);
    return session?.messages ?? [];
  }

  /**
   * 获取活跃会话数量
   */
  get sessionCount(): number {
    return this.sessions.size;
  }
}


