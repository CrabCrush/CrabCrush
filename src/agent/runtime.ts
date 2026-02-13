/**
 * Agent Runtime
 * 管理会话、维护上下文、调用模型
 */

import type { ChatMessage, ChatChunk, OpenAICompatibleProvider } from '../models/provider.js';

export interface Session {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  lastActiveAt: number;
}

export class AgentRuntime {
  private sessions = new Map<string, Session>();

  constructor(
    private provider: OpenAICompatibleProvider,
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
   */
  async *chat(sessionId: string, userMessage: string): AsyncIterable<ChatChunk> {
    const session = this.getOrCreateSession(sessionId);

    // 记录用户消息
    session.messages.push({ role: 'user', content: userMessage });

    // 构建完整的消息列表（系统提示 + 历史对话）
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...session.messages,
    ];

    // 调用模型
    let fullContent = '';
    for await (const chunk of this.provider.chat(messages, {
      maxTokens: this.maxTokens,
    })) {
      fullContent += chunk.content;
      yield chunk;
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
