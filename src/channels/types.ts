/**
 * 渠道适配器接口
 * 所有渠道（WebChat、钉钉、飞书等）实现此接口
 */

import type { ChatChunk } from '../models/provider.js';

/**
 * 聊天处理函数
 * 对应 AgentRuntime.chat() 的签名
 */
export type ChatHandler = (
  sessionId: string,
  content: string,
  signal?: AbortSignal,
) => AsyncIterable<ChatChunk>;

/**
 * 渠道适配器基础接口
 */
export interface ChannelAdapter {
  /** 渠道类型标识 */
  readonly type: string;

  /** 启动适配器（建立连接、注册路由等） */
  start(): Promise<void>;

  /** 停止适配器（断开连接、清理资源） */
  stop(): Promise<void>;

  /** 注册消息处理函数（由 Gateway 注入 Agent） */
  setChatHandler(handler: ChatHandler): void;
}
