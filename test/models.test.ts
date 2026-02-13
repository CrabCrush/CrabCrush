import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../src/models/provider.js';

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
