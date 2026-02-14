/**
 * Agent Runtime
 * 管理会话、维护上下文、调用模型
 *
 * Phase 2a 改造：
 * - 对话持久化到 SQLite（可选，不传 store 则退化为纯内存模式）
 * - 滑动窗口：只发最近 N 条消息给 API，不再全发
 */

import type { ChatMessage, ChatChunk, ChatOptions } from '../models/provider.js';
import type { ModelRouter } from '../models/router.js';
import type { ConversationStore } from '../storage/database.js';

export interface Session {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  lastActiveAt: number;
}

export interface AgentRuntimeOptions {
  router: ModelRouter;
  systemPrompt: string;
  maxTokens: number;
  /** SQLite 存储（不传则纯内存模式，重启丢失） */
  store?: ConversationStore;
  /** 发给 API 的最大消息条数（默认 40 条 = 最近 20 轮） */
  contextWindow?: number;
}

export class AgentRuntime {
  private sessions = new Map<string, Session>();
  private router: ModelRouter;
  private systemPrompt: string;
  private maxTokens: number;
  private store?: ConversationStore;
  private contextWindow: number;

  constructor(options: AgentRuntimeOptions) {
    this.router = options.router;
    this.systemPrompt = options.systemPrompt;
    this.maxTokens = options.maxTokens;
    this.store = options.store;
    this.contextWindow = options.contextWindow ?? 40; // 40 条 = 20 轮对话
  }

  /**
   * 获取或创建会话
   * 如果有 SQLite 存储，从 DB 加载历史消息到内存
   */
  getOrCreateSession(sessionId: string, channel = 'webchat', senderId = ''): Session {
    let session = this.sessions.get(sessionId);
    if (!session) {
      // 从 SQLite 加载历史（如果有的话）
      let messages: ChatMessage[] = [];
      if (this.store) {
        this.store.ensureConversation(sessionId, channel, senderId);
        const stored = this.store.getRecentMessages(sessionId, this.contextWindow);
        messages = stored.map(m => ({ role: m.role as ChatMessage['role'], content: m.content }));
      }

      session = {
        id: sessionId,
        messages,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      this.sessions.set(sessionId, session);
    }
    session.lastActiveAt = Date.now();
    return session;
  }

  /**
   * 处理用户消息，流式返回模型回复
   * @param signal - AbortSignal，用于中断生成
   */
  async *chat(
    sessionId: string,
    userMessage: string,
    signal?: AbortSignal,
  ): AsyncIterable<ChatChunk> {
    const session = this.getOrCreateSession(sessionId);

    // 记录用户消息
    session.messages.push({ role: 'user', content: userMessage });
    this.store?.saveMessage(sessionId, 'user', userMessage);

    // 滑动窗口：只取最近 N 条消息发给 API
    const recentMessages = session.messages.slice(-this.contextWindow);

    // 构建完整的消息列表（系统提示 + 精选历史）
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...recentMessages,
    ];

    // 调用模型
    const chatOptions: ChatOptions = {
      maxTokens: this.maxTokens,
      signal,
    };

    let fullContent = '';
    try {
      for await (const chunk of this.router.chat(messages, chatOptions)) {
        fullContent += chunk.content;
        yield chunk;
      }
    } catch (err) {
      // 即使出错，也要保存已收到的部分回复
      if (fullContent) {
        session.messages.push({ role: 'assistant', content: fullContent });
        this.store?.saveMessage(sessionId, 'assistant', fullContent);
      }
      throw err;
    }

    // 记录助手回复
    if (fullContent) {
      session.messages.push({ role: 'assistant', content: fullContent });
      this.store?.saveMessage(sessionId, 'assistant', fullContent);
    }

    // 内存中也保持滑动窗口大小，防止内存无限增长
    if (session.messages.length > this.contextWindow * 2) {
      session.messages = session.messages.slice(-this.contextWindow);
    }
  }

  /**
   * 获取会话的历史消息（用于 WebChat 加载历史）
   */
  getHistory(sessionId: string): ChatMessage[] {
    // 优先从 SQLite 获取完整历史
    if (this.store) {
      const stored = this.store.getRecentMessages(sessionId, this.contextWindow);
      return stored.map(m => ({ role: m.role as ChatMessage['role'], content: m.content }));
    }
    // 退化为内存中的消息
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
