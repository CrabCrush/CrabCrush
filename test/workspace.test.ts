/**
 * 工作区模块单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDefaultPromptRegistry } from '../src/prompts/defaults.js';
import {
  getWorkspacePath,
  ensureWorkspaceDir,
  ensureWorkspaceSeedFiles,
  readWorkspaceFiles,
  saveWorkspaceFiles,
  isWorkspaceEmpty,
  buildSystemPrompt,
  WORKSPACE_FILES,
  DEFAULT_WORKSPACE_AGENT_TEMPLATE,
} from '../src/workspace/index.js';

describe('workspace', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `crabcrush-workspace-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('getWorkspacePath', () => {
    it('returns fileBase/workspace when fileBase provided', () => {
      const path = getWorkspacePath('/custom/base');
      expect(path).toBe(join('/custom/base', 'workspace'));
    });

    it('returns .crabcrush/workspace when fileBase empty', () => {
      const path = getWorkspacePath('');
      expect(path).toContain('.crabcrush');
      expect(path).toContain('workspace');
    });
  });

  describe('ensureWorkspaceDir', () => {
    it('creates directory if not exists', async () => {
      const dir = join(testDir, 'new-workspace');
      ensureWorkspaceDir(dir);
      const content = await readWorkspaceFiles(dir);
      expect(content.agent).toBe('');
      expect(content.identity).toBe('');
      expect(content.user).toBe('');
    });
  });

  describe('ensureWorkspaceSeedFiles', () => {
    it('creates default AGENT.md when missing', async () => {
      ensureWorkspaceSeedFiles(testDir);
      const content = await readWorkspaceFiles(testDir);
      expect(content).toEqual({
        agent: DEFAULT_WORKSPACE_AGENT_TEMPLATE,
        identity: '',
        user: '',
        soul: '',
      });
    });

    it('does not overwrite existing AGENT.md', async () => {
      await writeFile(join(testDir, WORKSPACE_FILES.AGENT), '我的长期规则');
      ensureWorkspaceSeedFiles(testDir);
      const content = await readWorkspaceFiles(testDir);
      expect(content.agent).toBe('我的长期规则');
    });
  });

  describe('readWorkspaceFiles', () => {
    it('returns empty strings when directory is empty', async () => {
      const content = await readWorkspaceFiles(testDir);
      expect(content.agent).toBe('');
      expect(content.identity).toBe('');
      expect(content.user).toBe('');
      expect(content.soul).toBe('');
    });

    it('reads AGENT.md when present', async () => {
      await writeFile(join(testDir, WORKSPACE_FILES.AGENT), '# 指令\n请长期用中文且结论优先');
      const content = await readWorkspaceFiles(testDir);
      expect(content.agent).toContain('长期用中文');
      expect(content.identity).toBe('');
      expect(content.user).toBe('');
      expect(content.soul).toBe('');
    });

    it('reads IDENTITY.md when present', async () => {
      await writeFile(join(testDir, WORKSPACE_FILES.IDENTITY), '# 身份\n名字：小螃蟹');
      const content = await readWorkspaceFiles(testDir);
      expect(content.identity).toContain('小螃蟹');
      expect(content.agent).toBe('');
      expect(content.user).toBe('');
      expect(content.soul).toBe('');
    });

    it('reads USER.md when present', async () => {
      await writeFile(join(testDir, WORKSPACE_FILES.USER), '# 用户\n名字：小明');
      const content = await readWorkspaceFiles(testDir);
      expect(content.user).toContain('小明');
      expect(content.agent).toBe('');
      expect(content.identity).toBe('');
    });

    it('reads all workspace files when present', async () => {
      await writeFile(join(testDir, WORKSPACE_FILES.AGENT), '结论优先');
      await writeFile(join(testDir, WORKSPACE_FILES.IDENTITY), 'emoji: 🦀');
      await writeFile(join(testDir, WORKSPACE_FILES.USER), 'name: 小明');
      await writeFile(join(testDir, WORKSPACE_FILES.SOUL), '真诚有用');
      const content = await readWorkspaceFiles(testDir);
      expect(content.agent).toContain('结论优先');
      expect(content.identity).toContain('🦀');
      expect(content.user).toContain('小明');
      expect(content.soul).toContain('真诚');
    });
  });

  describe('saveWorkspaceFiles', () => {
    it('saves and trims all workspace files', async () => {
      await saveWorkspaceFiles(testDir, {
        agent: '  结论优先  ',
        identity: ' 小螃蟹 ',
        user: ' 小明 ',
        soul: ' 真诚有用 ',
      });
      const content = await readWorkspaceFiles(testDir);
      expect(content).toEqual({
        agent: '结论优先',
        identity: '小螃蟹',
        user: '小明',
        soul: '真诚有用',
      });
    });
  });

  describe('isWorkspaceEmpty', () => {
    it('returns true when agent, identity, and user are empty', () => {
      expect(isWorkspaceEmpty({ agent: '', identity: '', user: '', soul: '' })).toBe(true);
      expect(isWorkspaceEmpty({ agent: '  ', identity: '  ', user: '\n', soul: 'x' })).toBe(true);
    });

    it('returns false when agent has content', () => {
      expect(isWorkspaceEmpty({ agent: 'x', identity: '', user: '', soul: '' })).toBe(false);
    });

    it('returns false when identity has content', () => {
      expect(isWorkspaceEmpty({ agent: '', identity: 'x', user: '', soul: '' })).toBe(false);
    });

    it('returns false when user has content', () => {
      expect(isWorkspaceEmpty({ agent: '', identity: '', user: 'x', soul: '' })).toBe(false);
    });
  });

  describe('buildSystemPrompt', () => {
    const registry = createDefaultPromptRegistry('你是 CrabCrush。');

    it('includes bootstrap when workspace empty', () => {
      const result = buildSystemPrompt(registry, { agent: '', identity: '', user: '', soul: '' });
      expect(result).toContain('你是 CrabCrush。');
      expect(result).toContain('人格引导');
      expect(result).toContain('AGENT.md');
      expect(result).toContain('write_file');
      expect(result).not.toContain('【行为规则】');
    });

    it('includes behavior rules when workspace has content', () => {
      const result = buildSystemPrompt(registry, { agent: '结论优先', identity: '', user: '', soul: '' });
      expect(result).toContain('行为规则');
      expect(result).toContain('workspace/ 子目录');
      expect(result).toContain('workspace/AGENT.md');
    });

    it('injects AGENT.md as the primary user prompt when present', () => {
      const result = buildSystemPrompt(registry, {
        agent: '请长期保持结论优先，少说空话。',
        identity: '',
        user: '',
        soul: '',
      });
      expect(result).toContain('用户主提示（AGENT.md）');
      expect(result).toContain('结论优先');
      expect(result).not.toContain('人格引导');
    });

    it('injects identity and user when present', () => {
      const result = buildSystemPrompt(registry, {
        agent: '',
        identity: '名字：小螃蟹',
        user: '称呼：小明',
        soul: '',
      });
      expect(result).toContain('你的身份');
      expect(result).toContain('小螃蟹');
      expect(result).toContain('用户信息');
      expect(result).toContain('小明');
      expect(result).not.toContain('人格引导');
    });

    it('injects soul when present', () => {
      const result = buildSystemPrompt(registry, {
        agent: '',
        identity: '',
        user: 'x',
        soul: '真诚有用',
      });
      expect(result).toContain('性格边界');
      expect(result).toContain('真诚有用');
    });
  });
});
