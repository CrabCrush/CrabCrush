/**
 * 钉钉渠道适配器 — Stream 模式（详见 DEC-003）
 *
 * 工作原理：
 * 1. 通过 dingtalk-stream SDK 主动连接钉钉服务器（不需要公网 IP）
 * 2. 收到 @机器人 消息后，调用 Agent 获取回复
 * 3. 通过 sessionWebhook 发送回复（支持 Markdown）
 * 4. 按 senderStaffId 隔离会话（同群不同人独立上下文）
 */

import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import type { ChannelAdapter, ChatHandler } from './types.js';

export interface DingTalkConfig {
  clientId: string;
  clientSecret: string;
}

/** 钉钉 Stream 消息结构 */
interface RobotMessage {
  text: { content: string };
  senderStaffId: string;
  senderNick: string;
  conversationType: string; // "1" = 单聊, "2" = 群聊
  conversationId: string;
  sessionWebhook: string;
  msgtype: string;
}

export class DingTalkAdapter implements ChannelAdapter {
  readonly type = 'dingtalk';
  private client: DWClient;
  private chatHandler: ChatHandler | null = null;
  private config: DingTalkConfig;

  constructor(config: DingTalkConfig) {
    this.config = config;
    this.client = new DWClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
  }

  setChatHandler(handler: ChatHandler): void {
    this.chatHandler = handler;
  }

  async start(): Promise<void> {
    // 注册机器人消息回调
    this.client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
      await this.handleMessage(res);
    });

    // 建立 Stream 连接
    await this.client.connect();
    console.log('   钉钉 Stream 已连接');
  }

  async stop(): Promise<void> {
    try {
      // dingtalk-stream SDK 可能没有显式的 disconnect 方法
      // 设置为 null 让 GC 清理
      (this.client as unknown) = null;
    } catch {
      // 忽略关闭错误
    }
  }

  /**
   * 处理收到的机器人消息
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleMessage(res: any): Promise<void> {
    if (!this.chatHandler) return;

    try {
      const payload = JSON.parse(res.data) as RobotMessage;
      const content = payload.text?.content?.trim();

      if (!content) {
        this.ack(res);
        return;
      }

      // 按发送者 ID 隔离会话（DEC-011）
      const sessionId = `dingtalk-${payload.senderStaffId}`;

      console.log(
        `[钉钉] ${payload.senderNick}(${payload.senderStaffId}): ${content.slice(0, 50)}...`,
      );

      // 调用 Agent 获取回复（收集全部 chunks）
      let fullContent = '';
      try {
        for await (const chunk of this.chatHandler(sessionId, content)) {
          fullContent += chunk.content;
        }
      } catch (err) {
        fullContent = `抱歉，处理消息时出错：${err instanceof Error ? err.message : '未知错误'}`;
      }

      if (!fullContent) {
        fullContent = '抱歉，我没有生成有效的回复。';
      }

      // 通过 sessionWebhook 发送回复
      await this.sendReply(payload, fullContent);

      // 确认消息已处理（避免钉钉重复推送）
      this.ack(res);
    } catch (err) {
      console.error('[钉钉] 消息处理失败:', err);
      this.ack(res);
    }
  }

  /**
   * 通过 sessionWebhook 发送回复
   * 短消息用 text 格式，长消息用 markdown 格式
   */
  private async sendReply(
    payload: RobotMessage,
    content: string,
  ): Promise<void> {
    const accessToken = await this.client.getAccessToken();

    // 超过 200 字或包含代码块/标题等 Markdown 特征时，用 Markdown 格式
    const useMarkdown =
      content.length > 200 ||
      content.includes('```') ||
      content.includes('# ') ||
      content.includes('**');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: Record<string, any>;

    if (useMarkdown) {
      body = {
        msgtype: 'markdown',
        markdown: {
          title: 'CrabCrush',
          text: content,
        },
      };
    } else {
      body = {
        msgtype: 'text',
        text: {
          content,
        },
      };
    }

    // 群聊时 @发送者
    if (payload.conversationType === '2') {
      body.at = {
        atUserIds: [payload.senderStaffId],
        isAtAll: false,
      };
    }

    const response = await fetch(payload.sessionWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': accessToken,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[钉钉] 回复失败 (${response.status}): ${errorText.slice(0, 200)}`);
    }
  }

  /**
   * 确认消息已处理
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ack(res: any): void {
    try {
      this.client.socketCallBackResponse(res.headers?.messageId, '');
    } catch {
      // 忽略 ack 错误
    }
  }
}
