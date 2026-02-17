import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { AgentRuntime, ToolCallEvent } from '../agent/runtime.js';
import { estimateCost } from '../models/pricing.js';
import type { ChatChunk } from '../models/provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface GatewayOptions {
  port?: number;
  bind?: 'loopback' | 'all';
  logger?: boolean;
  agent?: AgentRuntime;
  /** 访问令牌，设置后 WebChat 和 WebSocket 需要 ?token=xxx */
  token?: string;
}

/**
 * 创建 Gateway 实例（不启动监听）
 * 用于测试时注入请求，不需要占用端口
 */
export function createGateway(options: GatewayOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  // 健康检查
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  // 统一错误格式
  app.setErrorHandler((err, _request, reply) => {
    const error = err as Error & { statusCode?: number; code?: string };
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: error.message,
      },
    });
  });

  return app;
}

/**
 * 启动 Gateway 并监听端口
 * 包含：HTTP API + WebSocket + WebChat 静态文件
 */
export async function startGateway(options: GatewayOptions = {}) {
  const port = options.port ?? 18790;
  const host = options.bind === 'all' ? '0.0.0.0' : '127.0.0.1';
  const app = createGateway(options);

  // Token 校验辅助函数
  const token = options.token;
  const validateToken = (query: Record<string, unknown>): boolean => {
    if (!token) return true; // 未设置 token 则不校验
    return (query as Record<string, string>).token === token;
  };

  // 注册 WebSocket 插件
  await app.register(fastifyWebSocket);

  // WebSocket 聊天端点
  if (options.agent) {
    const agent = options.agent;

    app.get('/ws', { websocket: true }, (socket, req) => {
      // Token 校验
      if (!validateToken(req.query as Record<string, unknown>)) {
        socket.send(JSON.stringify({ type: 'error', message: '无效的访问令牌' }));
        socket.close(4001, 'Unauthorized');
        return;
      }

      let sessionId = `webchat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let currentAbort: AbortController | null = null;

      // WebSocket ping/pong 保活
      const pingInterval = setInterval(() => {
        if (socket.readyState === 1) {
          socket.ping();
        }
      }, 30_000);

      socket.on('close', () => {
        clearInterval(pingInterval);
        // 连接关闭时中断进行中的生成
        currentAbort?.abort();
      });

      socket.on('message', async (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString());

          // 客户端可以指定 sessionId（用于重连恢复会话）
          if (msg.sessionId) {
            sessionId = msg.sessionId;
          }

          // 客户端请求新建会话（点击「新建」后，服务端重置 sessionId，下一条 chat 将创建新会话）
          if (msg.type === 'newSession') {
            sessionId = `webchat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            return;
          }

          // 客户端请求加载历史（limit/offset 分页，offset>0 时返回更早的消息用于「加载更多」）
          if (msg.type === 'loadHistory') {
            const limit = typeof msg.limit === 'number' ? msg.limit : 100;
            const offset = typeof msg.offset === 'number' ? msg.offset : 0;
            const history = agent.getHistory(sessionId, limit, offset);
            const hasMore = history.length >= limit;
            socket.send(JSON.stringify({
              type: 'history',
              sessionId,
              messages: history,
              offset,
              hasMore,
            }));
            return;
          }

          // 客户端请求会话列表（支持 offset 分页）
          if (msg.type === 'listConversations') {
            const offset = typeof msg.offset === 'number' ? msg.offset : 0;
            const list = agent.listConversations(50, offset, 'webchat');
            socket.send(JSON.stringify({ type: 'conversations', list, offset }));
            return;
          }

          // 中断生成：立即通知客户端结束，避免客户端一直等待
          if (msg.type === 'stop') {
            currentAbort?.abort();
            currentAbort = null;
            if (socket.readyState === 1) {
              socket.send(JSON.stringify({ type: 'done' }));
            }
            return;
          }

          if (msg.type === 'chat' && msg.content) {
            // 中断上一个进行中的请求（如果有）
            currentAbort?.abort();

            const abort = new AbortController();
            currentAbort = abort;

            // 发送 sessionId 给客户端
            socket.send(JSON.stringify({
              type: 'session',
              sessionId,
            }));

            try {
              // 流式回复（支持 ChatChunk 和 ToolCallEvent 两种事件）
              // WebChat 用 sessionId 作为 senderId（DEC-026 Owner 判断）
              for await (const event of agent.chat(sessionId, msg.content, abort.signal, sessionId)) {
                if (socket.readyState !== 1) break;

                // 工具调用事件
                if ('type' in event && (event as ToolCallEvent).type === 'tool_call') {
                  const toolEvent = event as ToolCallEvent;
                  socket.send(JSON.stringify({
                    type: 'tool_call',
                    name: toolEvent.name,
                    args: toolEvent.args,
                    result: toolEvent.result,
                    success: toolEvent.success,
                  }));
                  continue;
                }

                // 模型文本 chunk
                const chunk = event as ChatChunk;
                if (chunk.done) {
                  // 若有 toolCalls 表示工具调用中，不发送 done，避免客户端提前结束 streaming 导致后续自然语言回复不展示
                  if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                    if (chunk.content) {
                      socket.send(JSON.stringify({ type: 'chunk', content: chunk.content }));
                    }
                    continue;
                  }
                  let costInfo: { formatted: string } | null = null;
                  if (chunk.usage && chunk.model) {
                    costInfo = estimateCost(
                      chunk.model,
                      chunk.usage.promptTokens,
                      chunk.usage.completionTokens,
                    );
                  }
                  socket.send(JSON.stringify({
                    type: 'done',
                    usage: chunk.usage,
                    model: chunk.model,
                    cost: costInfo?.formatted,
                  }));
                } else {
                  socket.send(JSON.stringify({
                    type: 'chunk',
                    content: chunk.content,
                  }));
                }
              }
            } catch (err) {
              // 用户主动中断不算错误
              if (abort.signal.aborted) {
                socket.send(JSON.stringify({ type: 'done' }));
                return;
              }

              const message = err instanceof Error ? err.message : '未知错误';
              app.log.error({ err }, 'Chat 处理失败');
              socket.send(JSON.stringify({
                type: 'error',
                message,
              }));
            } finally {
              if (currentAbort === abort) {
                currentAbort = null;
              }
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : '消息格式错误';
          app.log.error({ err }, 'WebSocket 消息解析失败');
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'error',
              message,
            }));
          }
        }
      });
    });
  }

  // 静态文件服务（WebChat 前端）
  // 如果设置了 token，需要在 URL 中携带 ?token=xxx 才能访问
  if (token) {
    app.addHook('onRequest', async (request, reply) => {
      const url = request.url;
      // /health 和 /ws 不在此拦截（/ws 有自己的校验）
      if (url.startsWith('/health') || url.startsWith('/ws')) return;
      // 静态资源：favicon、vendor（markdown-it/highlight.js）无需 token，避免 401
      if (url === '/favicon.ico' || url.startsWith('/vendor/')) return;

      if (!validateToken(request.query as Record<string, unknown>)) {
        reply.status(401).type('text/html; charset=utf-8').send(
          `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CrabCrush</title></head>` +
          `<body style="font-family:system-ui;background:#0f0f1a;color:#e8e8e8;display:flex;` +
          `align-items:center;justify-content:center;height:100vh;flex-direction:column">` +
          `<h1>🦀 需要访问令牌</h1>` +
          `<p style="color:#777;margin-top:1rem">请使用启动时控制台打印的完整 URL 访问</p>` +
          `<p style="color:#555;margin-top:0.5rem;font-size:0.85rem">格式：http://127.0.0.1:${port}/?token=xxx</p>` +
          `</body></html>`,
        );
      }
    });
  }

  const publicDir = join(__dirname, '../../public');
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  await app.listen({ port, host });

  return app;
}
