import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../src/models/provider.js';
import { ModelRouter } from '../src/models/router.js';
import { estimateCost } from '../src/models/pricing.js';

describe('OpenAICompatibleProvider', () => {
  it('can be instantiated', () => {
    const provider = new OpenAICompatibleProvider(
      'test',
      'https://api.example.com/v1',
      'sk-test',
      'test-model',
    );
    expect(provider.id).toBe('test');
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
});

describe('Cost Estimation', () => {
  it('estimates cost for known models', () => {
    const result = estimateCost('deepseek-chat', 1000, 500);
    expect(result).not.toBeNull();
    expect(result!.cost).toBeGreaterThan(0);
    expect(result!.formatted).toMatch(/^¥/);
  });

  it('returns null for unknown models', () => {
    const result = estimateCost('unknown-model', 1000, 500);
    expect(result).toBeNull();
  });

  it('formats small costs with 4 decimal places', () => {
    const result = estimateCost('deepseek-chat', 100, 50);
    expect(result!.formatted).toMatch(/^¥0\.000/);
  });
});
