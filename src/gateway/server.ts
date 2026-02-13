import Fastify, { type FastifyInstance } from 'fastify';

export interface GatewayOptions {
  port?: number;
  logger?: boolean;
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
 */
export async function startGateway(options: GatewayOptions = {}) {
  const port = options.port ?? 18790;
  const app = createGateway(options);

  await app.listen({ port, host: '127.0.0.1' });

  app.log.info(`🦀 CrabCrush Gateway running at http://127.0.0.1:${port}`);

  return app;
}
