import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { AgentRuntime } from '../agent/runtime.js';
import { estimateCost } from '../models/pricing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface GatewayOptions {
  port?: number;
  bind?: 'loopback' | 'all';
  logger?: boolean;
  agent?: AgentRuntime;
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

  // 注册 WebSocket 插件
  await app.register(fastifyWebSocket);

  // WebSocket 聊天端点
  if (options.agent) {
    const agent = options.agent;

    app.get('/ws', { websocket: true }, (socket, _req) => {
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

          // 中断生成
          if (msg.type === 'stop') {
            currentAbort?.abort();
            currentAbort = null;
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
              // 流式回复
              for await (const chunk of agent.chat(sessionId, msg.content, abort.signal)) {
                if (socket.readyState !== 1) break;

                if (chunk.done) {
                  // 计算费用估算
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
  const publicDir = join(__dirname, '../../public');
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  await app.listen({ port, host });

  return app;
}
