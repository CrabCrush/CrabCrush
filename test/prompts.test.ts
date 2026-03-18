import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPromptRegistry, resolvePromptsDir } from '../src/prompts/loader.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.CRABCRUSH_PROMPTS_DIR;
});

describe('PromptRegistry loader', () => {
  it('falls back to defaults when no prompts dir exists', () => {
    const registry = loadPromptRegistry({ promptsDir: join(tmpdir(), 'not-exists-prompts-dir') });
    expect(registry.system.base).toContain('CrabCrush');
    expect(registry.tools.file.write_file.description).toContain('workspace/notes.md');
    expect(registry.runtime.planSummaryMultiple).toContain('{{count}}');
  });

  it('loads prompt overrides from external prompts directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crabcrush-prompts-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'system'), { recursive: true });
    mkdirSync(join(dir, 'runtime'), { recursive: true });
    mkdirSync(join(dir, 'tools'), { recursive: true });

    writeFileSync(join(dir, 'system', 'base.md'), '你是外部 Prompt。');
    writeFileSync(join(dir, 'runtime', 'plan-approval-message.md'), '外部计划确认提示');
    writeFileSync(join(dir, 'runtime', 'plan-summary-single.md'), '外部单步计划');
    writeFileSync(join(dir, 'runtime', 'plan-summary-multiple.md'), '外部 {{count}} 步计划');
    writeFileSync(join(dir, 'tools', 'time.json'), JSON.stringify({
      get_current_time: {
        description: '外部时间工具描述',
      },
    }, null, 2));
    writeFileSync(join(dir, 'tools', 'browser.json'), JSON.stringify({
      browse_url: {
        description: '外部网页工具描述',
      },
    }, null, 2));
    writeFileSync(join(dir, 'tools', 'search.json'), JSON.stringify({
      search_web: {
        description: '外部搜索工具描述',
      },
    }, null, 2));
    writeFileSync(join(dir, 'tools', 'file.json'), JSON.stringify({
      write_file: {
        description: '外部 write_file 描述',
        parameters: {
          path: '外部 path 描述',
        },
      },
    }, null, 2));

    const registry = loadPromptRegistry({ promptsDir: dir, defaultSystemBase: '默认 base' });
    expect(registry.system.base).toBe('你是外部 Prompt。');
    expect(registry.runtime.planApprovalMessage).toBe('外部计划确认提示');
    expect(registry.runtime.planSummarySingle).toBe('外部单步计划');
    expect(registry.runtime.planSummaryMultiple).toBe('外部 {{count}} 步计划');
    expect(registry.tools.time.get_current_time.description).toBe('外部时间工具描述');
    expect(registry.tools.browser.browse_url.description).toBe('外部网页工具描述');
    expect(registry.tools.search.search_web.description).toBe('外部搜索工具描述');
    expect(registry.tools.file.write_file.description).toBe('外部 write_file 描述');
    expect(registry.tools.file.write_file.parameters.path).toBe('外部 path 描述');
    expect(registry.tools.file.write_file.parameters.content).toContain('写入');
  });

  it('resolves prompts dir from environment variable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crabcrush-prompts-env-'));
    tempDirs.push(dir);
    process.env.CRABCRUSH_PROMPTS_DIR = dir;
    expect(resolvePromptsDir()).toBe(dir);
  });

  it('does not silently fall back when explicit prompts dir is missing', () => {
    const cwdPrompts = join(process.cwd(), 'prompts');
    expect(resolvePromptsDir(join(tmpdir(), 'missing-prompts-dir'))).toBeNull();
    expect(resolvePromptsDir(cwdPrompts)).toBe(cwdPrompts);
  });

  it('throws readable error when prompt tool json is invalid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crabcrush-prompts-invalid-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'tools'), { recursive: true });
    writeFileSync(join(dir, 'tools', 'time.json'), '{ invalid json }');
    expect(() => loadPromptRegistry({ promptsDir: dir })).toThrow('Prompt JSON 解析失败');
  });
});
