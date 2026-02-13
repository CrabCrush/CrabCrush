import { describe, it, expect } from 'vitest';
import { configSchema } from '../src/config/schema.js';

describe('Config Schema', () => {
  it('accepts empty config with defaults', () => {
    const config = configSchema.parse({});
    expect(config.port).toBe(18790);
    expect(config.bind).toBe('loopback');
    expect(config.agent.model).toBe('deepseek-chat');
    expect(config.agent.systemPrompt).toContain('CrabCrush');
  });

  it('accepts full config', () => {
    const config = configSchema.parse({
      port: 3000,
      bind: 'all',
      models: {
        deepseek: {
          apiKey: 'sk-test-key',
          baseURL: 'https://api.deepseek.com/v1',
        },
      },
      agent: {
        model: 'deepseek-chat',
        systemPrompt: '你好',
        maxTokens: 2048,
      },
    });
    expect(config.port).toBe(3000);
    expect(config.bind).toBe('all');
    expect(config.models.deepseek.apiKey).toBe('sk-test-key');
    expect(config.agent.maxTokens).toBe(2048);
  });

  it('rejects invalid port', () => {
    expect(() => configSchema.parse({ port: 99999 })).toThrow();
    expect(() => configSchema.parse({ port: 0 })).toThrow();
    expect(() => configSchema.parse({ port: -1 })).toThrow();
  });

  it('rejects empty apiKey', () => {
    expect(() =>
      configSchema.parse({
        models: { deepseek: { apiKey: '' } },
      }),
    ).toThrow();
  });

  it('rejects invalid bind value', () => {
    expect(() => configSchema.parse({ bind: 'invalid' })).toThrow();
  });
});

describe('Config Loader', () => {
  it('throws when explicit config path does not exist', async () => {
    const { loadConfig } = await import('../src/config/loader.js');
    expect(() => loadConfig('/non/existent/path.yaml')).toThrow('配置文件不存在');
  });

  it('loads defaults when no config path specified', async () => {
    // 不传参数时，找不到配置文件应返回默认值
    const { loadConfig } = await import('../src/config/loader.js');
    // 注意：如果 cwd 有 crabcrush.yaml 会被读取，这里只验证不报错
    const config = loadConfig();
    expect(config.port).toBeDefined();
  });
});
