/**
 * Agent Runtime
 * 管理会话、维护上下文、调用模型
 */

import type { ChatMessage, ChatChunk, ChatOptions } from '../models/provider.js';
import type { ModelRouter } from '../models/router.js';

export interface Session {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  lastActiveAt: number;
}

export class AgentRuntime {
  private sessions = new Map<string, Session>();

  constructor(
    private router: ModelRouter,
    private systemPrompt: string,
    private maxTokens: number,
  ) {}

  /**
   * 获取或创建会话
   */
  getOrCreateSession(sessionId: string): Session {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
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

    // 构建完整的消息列表（系统提示 + 历史对话）
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...session.messages,
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
      }
      throw err;
    }

    // 记录助手回复
    if (fullContent) {
      session.messages.push({ role: 'assistant', content: fullContent });
    }
  }

  /**
   * 获取活跃会话数量
   */
  get sessionCount(): number {
    return this.sessions.size;
  }
}
