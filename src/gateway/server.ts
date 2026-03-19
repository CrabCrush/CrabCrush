import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { AgentRuntime, ToolCallEvent, ToolPlanEvent, ToolPlanResultEvent, StreamControlEvent } from '../agent/runtime.js';
import type { ToolConfirmDecision, ToolConfirmHandler } from '../tools/types.js';
import { estimateCost } from '../models/pricing.js';
import type { ChatChunk } from '../models/provider.js';
import { getPrincipalKey, WEBCHAT_DEFAULT_SENDER_ID } from '../permissions/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface GatewayOptions {
  port?: number;
  bind?: 'loopback' | 'all';
  logger?: boolean;
  agent?: AgentRuntime;
  /** WebChat 工具/计划确认超时时间（毫秒） */
  confirmTimeoutMs?: number;
  /** 访问令牌，设置后 WebChat 和 WebSocket 需要 ?token=xxx */
  token?: string;
  /** 审计日志回调（可选） */
  auditLogger?: (event: { type: string; [key: string]: unknown }) => void;
}

/**
 * 创建 Gateway 实例（不启动监听）
 * 用于测试时注入请求，不需要占用端口
 */
export function createGateway(options: GatewayOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

  app.get('/health', async () => ({ status: 'ok' }));

  if (options.agent) {
    const agent = options.agent;

    app.get('/api/workspace', async () => {
      const workspace = await agent.getWorkspaceSettings();
      return { workspace };
    });

    app.put('/api/workspace', async (request, reply) => {
      const body = (request.body && typeof request.body === 'object') ? request.body as Record<string, unknown> : null;
      if (!body) {
        reply.status(400);
        return {
          error: {
            code: 'INVALID_BODY',
            message: '请求体必须是 JSON 对象',
          },
        };
      }
      const workspace = await agent.saveWorkspaceSettings({
        agent: typeof body.agent === 'string' ? body.agent : '',
        identity: typeof body.identity === 'string' ? body.identity : '',
        user: typeof body.user === 'string' ? body.user : '',
        soul: typeof body.soul === 'string' ? body.soul : '',
      });
      return { workspace };
    });
  }
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
  const confirmTimeoutMs = options.confirmTimeoutMs ?? 60_000;
  const app = createGateway(options);
  const audit = options.auditLogger;

  // 简单限流（WebSocket chat 消息）
  const rateLimitWindowMs = 10_000;
  const rateLimitMax = 5;
  const rateLimits = new Map<string, { count: number; resetAt: number }>();
  // 定期清理已过期的限流记录，防止长期运行后内存持续增长
  const rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimits.entries()) {
      if (entry.resetAt <= now) rateLimits.delete(key);
    }
  }, 60_000);
  rateLimitCleanupInterval.unref();
  const allowRequest = (key: string): boolean => {
    const now = Date.now();
    const existing = rateLimits.get(key);
    if (!existing || existing.resetAt <= now) {
      rateLimits.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
      return true;
    }
    if (existing.count >= rateLimitMax) return false;
    existing.count += 1;
    return true;
  };

  // Token 校验辅助函数
  const token = options.token;
  const validateToken = (query: Record<string, unknown>): boolean => {
    if (!token) return true;
    return (query as Record<string, string>).token === token;
  };

  // 注册 WebSocket 插件
  await app.register(fastifyWebSocket);


  // WebSocket 聊天端点
  if (options.agent) {
    const agent = options.agent;

    app.get('/ws', { websocket: true }, (socket, req) => {
      const currentSenderId = () => WEBCHAT_DEFAULT_SENDER_ID;
      const currentPrincipalKey = () => getPrincipalKey('webchat', currentSenderId());
      // Token 校验
      if (!validateToken(req.query as Record<string, unknown>)) {
        socket.send(JSON.stringify({ type: 'error', message: '无效的访问令牌' }));
        socket.close(4001, 'Unauthorized');
        return;
      }

      let sessionId = `webchat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let currentAbort: AbortController | null = null;

      const pendingConfirms = new Map<string, {
        resolve: (decision: ToolConfirmDecision) => void;
        timeout: NodeJS.Timeout;
        name: string;
        operationId?: string;
        stepIndex?: number;
      }>();

      const requestConfirm: ToolConfirmHandler = async (request) => {
        const id = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const timeoutMs = confirmTimeoutMs;
        audit?.({
          type: 'tool_confirm_request',
          conversationId: sessionId,
          sessionId,
          principalKey: currentPrincipalKey(),
          name: request.name,
          kind: request.kind,
          grantKey: request.grantKey,
          operationId: request.operationId,
        });

        return await new Promise<ToolConfirmDecision>((resolve) => {
          const timeout = setTimeout(() => {
            pendingConfirms.delete(id);
            resolve({ allow: false, scope: request.defaultScope, reason: 'timeout' });
          }, timeoutMs);

          pendingConfirms.set(id, { resolve, timeout, name: request.name, operationId: request.operationId, stepIndex: request.stepIndex });
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'confirm',
              id,
              name: request.name,
              args: request.args,
              kind: request.kind,
              message: request.message,
              preview: request.preview,
              scopeOptions: request.scopeOptions,
              defaultScope: request.defaultScope,
              grantKey: request.grantKey,
              operationId: request.operationId,
              stepIndex: request.stepIndex,
              timeoutMs,
            }));
          }
        });
      };

      // WebSocket ping/pong 保活
      const pingInterval = setInterval(() => {
        if (socket.readyState === 1) socket.ping();
      }, 30_000);

      socket.on('close', () => {
        clearInterval(pingInterval);
        // 连接关闭时中断进行中的生成
        currentAbort?.abort();
        for (const [id, pending] of pendingConfirms.entries()) {
          clearTimeout(pending.timeout);
          pending.resolve({ allow: false, reason: 'rejected' });
          pendingConfirms.delete(id);
        }
      });

      socket.on('message', async (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString());

          // 客户端可以指定 sessionId（用于重连恢复会话）
          if (msg.sessionId) sessionId = msg.sessionId;

          if (msg.type === 'confirm_result') {
            const pending = pendingConfirms.get(msg.id);
            if (pending) {
              clearTimeout(pending.timeout);
              pendingConfirms.delete(msg.id);
              const decision: ToolConfirmDecision = {
                allow: msg.allow === true,
                scope: msg.scope === 'session' ? 'session' : msg.scope === 'persistent' ? 'persistent' : 'once',
                reason: msg.allow ? undefined : msg.reason === 'timeout' ? 'timeout' : 'rejected',
              };
              audit?.({
                type: 'tool_confirm_result',
                conversationId: sessionId,
                sessionId,
                principalKey: currentPrincipalKey(),
                name: pending.name,
                allowed: decision.allow,
                scope: decision.scope,
                reason: decision.reason,
                operationId: pending.operationId,
                stepIndex: pending.stepIndex,
              });
              pending.resolve(decision);
            }
            return;
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
            if (limit > 0) {
              const history = agent.getHistory(sessionId, limit + 1, offset);
              const hasMore = history.length > limit;
              const messages = hasMore ? history.slice(1) : history;
              socket.send(JSON.stringify({ type: 'history', sessionId, messages, offset, hasMore }));
            } else {
              const history = agent.getHistory(sessionId, limit, offset);
              socket.send(JSON.stringify({ type: 'history', sessionId, messages: history, offset, hasMore: false }));
            }
            return;
          }

          if (msg.type === 'loadAuditEvents') {
            const limit = typeof msg.limit === 'number' ? msg.limit : 200;
            const offset = typeof msg.offset === 'number' ? msg.offset : 0;
            const events = agent.getAuditTrail(sessionId, limit, offset);
            socket.send(JSON.stringify({ type: 'audit_events', sessionId, events, offset }));
            return;
          }

          if (msg.type === 'loadPermissionGrants') {
            const grants = agent.listPermissionGrants('webchat', currentSenderId(), sessionId);
            socket.send(JSON.stringify({ type: 'permission_grants', grants }));
            return;
          }

          if (msg.type === 'revokePermissionGrant') {
            const grantKey = typeof msg.grantKey === 'string' ? msg.grantKey : '';
            const scope = msg.scope === 'session' ? 'session' : 'persistent';
            if (!grantKey) {
              socket.send(JSON.stringify({ type: 'error', message: '缺少 grantKey' }));
              return;
            }
            const revoked = agent.revokePermissionGrant(grantKey, scope, 'webchat', currentSenderId(), sessionId);
            socket.send(JSON.stringify({ type: 'permission_grant_revoked', grantKey, scope, revoked }));
            const grants = agent.listPermissionGrants('webchat', currentSenderId(), sessionId);
            socket.send(JSON.stringify({ type: 'permission_grants', grants }));
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
            if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'done' }));
            return;
          }

          if (msg.type === 'chat' && msg.content) {
            const ip = req.socket.remoteAddress ?? 'unknown';
            if (!allowRequest(`ws:${ip}`)) {
              socket.send(JSON.stringify({ type: 'error', message: '请求过于频繁，请稍后再试' }));
              audit?.({ type: 'rate_limited', ip, sessionId });
              return;
            }

            audit?.({
              type: 'chat_request',
              conversationId: sessionId,
              sessionId,
              principalKey: currentPrincipalKey(),
              senderId: currentSenderId(),
              ip,
              length: String(msg.content).length,
            });
            currentAbort?.abort();
            const abort = new AbortController();
            // 中断上一个进行中的请求（如果有）
            currentAbort = abort;

            // 发送 sessionId 给客户端
            socket.send(JSON.stringify({ type: 'session', sessionId }));

            try {
              // 流式回复（支持 ChatChunk 和 ToolCallEvent 两种事件）
              // WebChat 使用固定本地主体 ID，避免 owner 判断绑定随机 sessionId。
              for await (const event of agent.chat(sessionId, msg.content, abort.signal, currentSenderId(), requestConfirm, 'webchat')) {
                if (socket.readyState !== 1) break;

                if ('type' in event && (event as StreamControlEvent).type === 'stream_control') {
                  const ctrl = event as StreamControlEvent;
                  socket.send(JSON.stringify({ type: 'stream_control', action: ctrl.action, reason: ctrl.reason }));
                  continue;
                }

                if ('type' in event && (event as ToolPlanEvent).type === 'tool_plan') {
                  const planEvent = event as ToolPlanEvent;
                  socket.send(JSON.stringify({
                    type: 'tool_plan',
                    operationId: planEvent.operationId,
                    round: planEvent.round,
                    summary: planEvent.summary,
                    steps: planEvent.steps,
                  }));
                  continue;
                }

                if ('type' in event && (event as ToolPlanResultEvent).type === 'tool_plan_result') {
                  const planResultEvent = event as ToolPlanResultEvent;
                  socket.send(JSON.stringify({
                    type: 'tool_plan_result',
                    operationId: planResultEvent.operationId,
                    round: planResultEvent.round,
                    allowed: planResultEvent.allowed,
                    reason: planResultEvent.reason,
                    autoApproved: planResultEvent.autoApproved,
                  }));
                  continue;
                }

                // 工具调用事件
                if ('type' in event && (event as ToolCallEvent).type === 'tool_call') {
                  const toolEvent = event as ToolCallEvent;
                  socket.send(JSON.stringify({
                    type: 'tool_call',
                    operationId: toolEvent.operationId,
                    stepIndex: toolEvent.stepIndex,
                    name: toolEvent.name,
                    args: toolEvent.args,
                    result: toolEvent.result,
                    success: toolEvent.success,
                    failureKind: toolEvent.failureKind,
                    degradeToAdvice: toolEvent.degradeToAdvice,
                  }));
                  continue;
                }

                // 模型文本 chunk
                const chunk = event as ChatChunk;
                if (chunk.done) {
                  // 若有 toolCalls 表示工具调用中，不发送 done，避免客户端提前结束 streaming 导致后续自然语言回复不展示
                  if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                    if (chunk.content) socket.send(JSON.stringify({ type: 'chunk', content: chunk.content }));
                    continue;
                  }
                  let costInfo: { formatted: string } | null = null;
                  if (chunk.usage && chunk.model) {
                    costInfo = estimateCost(chunk.model, chunk.usage.promptTokens, chunk.usage.completionTokens);
                  }
                  socket.send(JSON.stringify({
                    type: 'done',
                    usage: chunk.usage,
                    model: chunk.model,
                    cost: costInfo?.formatted,
                  }));
                } else {
                  socket.send(JSON.stringify({ type: 'chunk', content: chunk.content }));
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
              socket.send(JSON.stringify({ type: 'error', message }));
            } finally {
              if (currentAbort === abort) currentAbort = null;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : '消息格式错误';
          app.log.error({ err }, 'WebSocket 消息解析失败');
          if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'error', message }));
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
  await app.register(fastifyStatic, { root: publicDir, prefix: '/' });

  // 服务关闭时清理定时器
  app.addHook('onClose', async () => {
    clearInterval(rateLimitCleanupInterval);
  });

  await app.listen({ port, host });
  return app;
}

