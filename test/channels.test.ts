import { describe, it, expect } from 'vitest';
import { DingTalkAdapter } from '../src/channels/dingtalk.js';

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
