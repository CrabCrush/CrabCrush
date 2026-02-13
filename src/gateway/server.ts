import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { AgentRuntime } from '../agent/runtime.js';

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

      socket.on('message', async (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString());

          // 客户端可以指定 sessionId（用于重连恢复会话）
          if (msg.sessionId) {
            sessionId = msg.sessionId;
          }

          if (msg.type === 'chat' && msg.content) {
            // 发送 sessionId 给客户端（首次连接时）
            socket.send(JSON.stringify({
              type: 'session',
              sessionId,
            }));

            // 流式回复
            for await (const chunk of agent.chat(sessionId, msg.content)) {
              if (socket.readyState !== 1) break; // WebSocket 已关闭

              if (chunk.done) {
                socket.send(JSON.stringify({
                  type: 'done',
                  usage: chunk.usage,
                }));
              } else {
                socket.send(JSON.stringify({
                  type: 'chunk',
                  content: chunk.content,
                }));
              }
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : '未知错误';
          app.log.error({ err }, 'WebSocket 消息处理失败');
          socket.send(JSON.stringify({
            type: 'error',
            message,
          }));
        }
      });
    });
  }

  // 静态文件服务（WebChat 前端）
  // public/ 目录相对于项目根目录
  const publicDir = join(__dirname, '../../public');
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  await app.listen({ port, host });

  return app;
}
