import { describe, it, expect } from 'vitest';
import { DingTalkAdapter, parseDingTalkConfirmReply } from '../src/channels/dingtalk.js';

describe('DingTalkAdapter', () => {
  it('can be instantiated with config', () => {
    const adapter = new DingTalkAdapter({
      clientId: 'test-id',
      clientSecret: 'test-secret',
    });
    expect(adapter.type).toBe('dingtalk');
  });

  it('accepts a chat handler', () => {
    const adapter = new DingTalkAdapter({
      clientId: 'test-id',
      clientSecret: 'test-secret',
    });

    const handler = async function* () {
      yield { content: 'hello', done: false };
      yield { content: '', done: true };
    };

    adapter.setChatHandler(handler);
    // No assertion needed — should not throw
  });

  it('parses one-time confirm replies with explicit id', () => {
    expect(parseDingTalkConfirmReply('允许 confirm-123')).toEqual({
      action: '允许',
      scope: 'once',
      id: 'confirm-123',
    });
    expect(parseDingTalkConfirmReply('拒绝 confirm-123')).toEqual({
      action: '拒绝',
      scope: 'once',
      id: 'confirm-123',
    });
  });

  it('parses session-scoped confirm replies with explicit id', () => {
    expect(parseDingTalkConfirmReply('允许 本会话 confirm-456')).toEqual({
      action: '允许',
      scope: 'session',
      id: 'confirm-456',
    });
  });
});

describe('Config channels schema', () => {
  it('accepts dingtalk channel config', async () => {
    const { configSchema } = await import('../src/config/schema.js');

    const config = configSchema.parse({
      channels: {
        dingtalk: {
          enabled: true,
          clientId: 'test-id',
          clientSecret: 'test-secret',
        },
      },
    });

    expect(config.channels.dingtalk.enabled).toBe(true);
    expect(config.channels.dingtalk.clientId).toBe('test-id');
  });

  it('defaults dingtalk to disabled', async () => {
    const { configSchema } = await import('../src/config/schema.js');

    const config = configSchema.parse({});
    expect(config.channels.dingtalk.enabled).toBe(false);
  });
});
