import { describe, it, expect, afterAll } from 'vitest';
import { createGateway } from '../src/gateway/server.js';

describe('Gateway', () => {
  const app = createGateway({ logger: false });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
