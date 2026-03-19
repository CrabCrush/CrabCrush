import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModelApiError, OpenAICompatibleProvider } from '../src/models/provider.js';
import { ModelRouter } from '../src/models/router.js';
import { estimateCost } from '../src/models/pricing.js';

describe('OpenAICompatibleProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('can be instantiated', () => {
    const provider = new OpenAICompatibleProvider(
      'test',
      'https://api.example.com/v1',
      'sk-test',
      'test-model',
    );
    expect(provider.id).toBe('test');
  });

  it('does not retry on 4xx responses inside provider fetchWithRetry', async () => {
    const provider = new OpenAICompatibleProvider(
      'test',
      'https://api.example.com/v1',
      'sk-test',
      'test-model',
    );

    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const providerWithRetry = provider as unknown as {
      fetchWithRetry(url: string, body: string, externalSignal?: AbortSignal): Promise<Response>;
    };

    await expect(providerWithRetry.fetchWithRetry(
      'https://api.example.com/v1/chat/completions',
      '{}',
    )).rejects.toBeInstanceOf(ModelApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ModelRouter', () => {
  function makeProviders(...ids: string[]) {
    const map = new Map<string, OpenAICompatibleProvider>();
    for (const id of ids) {
      map.set(id, new OpenAICompatibleProvider(id, `https://${id}.example.com`, 'sk-test', `${id}-default`));
    }
    return map;
  }

  it('auto-detects deepseek provider from model name', () => {
    const providers = makeProviders('deepseek', 'qwen');
    const router = new ModelRouter(providers, 'deepseek-chat');
    expect(router.primaryInfo.providerId).toBe('deepseek');
    expect(router.primaryInfo.modelName).toBe('deepseek-chat');
  });

  it('auto-detects qwen provider from model name', () => {
    const providers = makeProviders('deepseek', 'qwen');
    const router = new ModelRouter(providers, 'qwen-max');
    expect(router.primaryInfo.providerId).toBe('qwen');
    expect(router.primaryInfo.modelName).toBe('qwen-max');
  });

  it('auto-detects kimi provider from moonshot model name', () => {
    const providers = makeProviders('kimi');
    const router = new ModelRouter(providers, 'moonshot-v1-128k');
    expect(router.primaryInfo.providerId).toBe('kimi');
  });

  it('parses explicit providerId/modelName format', () => {
    const providers = makeProviders('deepseek', 'qwen');
    const router = new ModelRouter(providers, 'qwen/qwen-plus');
    expect(router.primaryInfo.providerId).toBe('qwen');
    expect(router.primaryInfo.modelName).toBe('qwen-plus');
  });

  it('falls back to single provider when model name is unknown', () => {
    const providers = makeProviders('deepseek');
    const router = new ModelRouter(providers, 'some-custom-model');
    expect(router.primaryInfo.providerId).toBe('deepseek');
    expect(router.primaryInfo.modelName).toBe('some-custom-model');
  });

  it('throws when explicit provider is not configured', () => {
    const providers = makeProviders('deepseek');
    expect(() => new ModelRouter(providers, 'qwen/qwen-max')).toThrow('未配置');
  });

  it('throws when multiple providers and model cannot be matched', () => {
    const providers = makeProviders('deepseek', 'qwen');
    expect(() => new ModelRouter(providers, 'some-custom-model')).toThrow('自动匹配');
  });

  it('reports fallback info correctly', () => {
    const providers = makeProviders('deepseek', 'qwen');
    const router = new ModelRouter(providers, 'deepseek-chat', ['qwen/qwen-plus']);
    expect(router.hasFallback).toBe(true);
    expect(router.modelChain.length).toBe(2);
  });

  it('does not fail over on generic 4xx model API errors', async () => {
    let fallbackCalled = false;
    const providers = new Map<string, OpenAICompatibleProvider>();
    providers.set('deepseek', {
      id: 'deepseek',
      chat() {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw new ModelApiError('模型 API 调用失败 (400): bad request', { statusCode: 400 });
              },
            };
          },
        };
      },
    } as OpenAICompatibleProvider);
    providers.set('qwen', {
      id: 'qwen',
      async *chat() {
        fallbackCalled = true;
        yield { content: 'unexpected fallback', done: false };
        yield { content: '', done: true, model: 'qwen-max' };
      },
    } as OpenAICompatibleProvider);

    const router = new ModelRouter(providers, 'deepseek-chat', ['qwen/qwen-max']);

    await expect(async () => {
      for await (const chunk of router.chat([])) {
        void chunk;
      }
    }).rejects.toThrow('400');
    expect(fallbackCalled).toBe(false);
  });

  it('fails over on retryable provider errors', async () => {
    let fallbackCalled = false;
    const providers = new Map<string, OpenAICompatibleProvider>();
    providers.set('deepseek', {
      id: 'deepseek',
      chat() {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw new Error('模型 API 服务端错误 (500): temporary');
              },
            };
          },
        };
      },
    } as OpenAICompatibleProvider);
    providers.set('qwen', {
      id: 'qwen',
      async *chat() {
        fallbackCalled = true;
        yield { content: 'fallback ok', done: false };
        yield { content: '', done: true, model: 'qwen-max' };
      },
    } as OpenAICompatibleProvider);

    const router = new ModelRouter(providers, 'deepseek-chat', ['qwen/qwen-max']);
    const chunks: string[] = [];
    for await (const chunk of router.chat([])) {
      if (chunk.content) chunks.push(chunk.content);
    }

    expect(fallbackCalled).toBe(true);
    expect(chunks).toContain('fallback ok');
  });
});

describe('Cost Estimation', () => {
  it('estimates cost for known models', () => {
    const result = estimateCost('deepseek-chat', 1000, 500);
    expect(result).not.toBeNull();
    if (!result) throw new Error('expected cost result for deepseek-chat');
    expect(result.cost).toBeGreaterThan(0);
    expect(result.formatted).toMatch(/^¥/);
  });

  it('returns null for unknown models', () => {
    const result = estimateCost('unknown-model', 1000, 500);
    expect(result).toBeNull();
  });

  it('formats small costs with 4 decimal places', () => {
    const result = estimateCost('deepseek-chat', 100, 50);
    if (!result) throw new Error('expected cost result for deepseek-chat');
    expect(result.formatted).toMatch(/^¥0\.000/);
  });
});
