import { describe, it, expect } from 'vitest';
import { hasWriteFileIntent, looksLikeFileToolRequest } from '../src/tools/intent.js';

describe('intent heuristics', () => {
  it('detects file-related requests in Chinese and English', () => {
    expect(looksLikeFileToolRequest('帮我看看 notes.md 在不在')).toBe(true);
    expect(looksLikeFileToolRequest('Please check whether the file exists and open it')).toBe(true);
    expect(looksLikeFileToolRequest('Could you search that directory for config files?')).toBe(true);
  });

  it('detects write-like intent in Chinese and English', () => {
    expect(hasWriteFileIntent('请保存到文件里')).toBe(true);
    expect(hasWriteFileIntent('Save this summary to a file')).toBe(true);
    expect(hasWriteFileIntent('Export the result as markdown')).toBe(true);
  });

  it('rejects unrelated text unless overwrite was already requested', () => {
    expect(hasWriteFileIntent('你好')).toBe(false);
    expect(hasWriteFileIntent('Just say hello')).toBe(false);
    expect(hasWriteFileIntent('hello', true)).toBe(true);
  });
});

