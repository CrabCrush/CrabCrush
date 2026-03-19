import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultPromptRegistry } from '../src/prompts/defaults.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { createGetCurrentTimeTool, getCurrentTimeTool } from '../src/tools/builtin/time.js';
import { createBrowseUrlTool, browseUrlTool } from '../src/tools/builtin/browser.js';
import { createSearchWebTool, searchWebTool } from '../src/tools/builtin/search.js';
import { readFileTool, listFilesTool, createWriteFileTool, writeFileTool } from '../src/tools/builtin/file.js';
import type { Tool, ToolContext, ToolResult } from '../src/tools/types.js';

function createMockTool(overrides: Partial<Tool> = {}): Tool {
  return {
    definition: {
      name: overrides.definition?.name ?? 'mock_tool',
      description: 'A mock tool for testing',
      parameters: { type: 'object', properties: {} },
    },
    permission: overrides.permission ?? 'public',
    confirmRequired: overrides.confirmRequired ?? false,
    buildConfirmRequest: overrides.buildConfirmRequest,
    execute: overrides.execute ?? (async () => ({ success: true, content: 'mock result' })),
  };
}

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    const tool = createMockTool();
    registry.register(tool);

    expect(registry.size).toBe(1);
    expect(registry.get('mock_tool')).toBe(tool);
    expect(registry.names).toEqual(['mock_tool']);
  });

  it('rejects duplicate registration', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool());
    expect(() => registry.register(createMockTool())).toThrow('已注册');
  });

  it('getDefinitionsForModel filters by permission', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool({
      definition: { name: 'public_tool', description: 'public', parameters: { type: 'object', properties: {} } },
      permission: 'public',
    }));
    registry.register(createMockTool({
      definition: { name: 'owner_tool', description: 'owner only', parameters: { type: 'object', properties: {} } },
      permission: 'owner',
    }));

    const publicDefs = registry.getDefinitionsForModel(false);
    expect(publicDefs).toHaveLength(1);
    expect(publicDefs[0].name).toBe('public_tool');

    const ownerDefs = registry.getDefinitionsForModel(true);
    expect(ownerDefs).toHaveLength(2);
  });

  it('execute returns error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const ctx: ToolContext = { senderId: 'user-1', isOwner: false, sessionId: 'sess-1' };

    const result = await registry.execute('nonexistent', {}, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('不存在');
  });

  it('execute blocks non-owner from owner tools', async () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool({
      definition: { name: 'dangerous', description: 'owner only', parameters: { type: 'object', properties: {} } },
      permission: 'owner',
    }));

    const ctx: ToolContext = { senderId: 'user-1', isOwner: false, sessionId: 'sess-1' };
    const result = await registry.execute('dangerous', {}, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('无权限');
  });

  it('execute allows owner to use owner tools', async () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool({
      definition: { name: 'dangerous', description: 'owner only', parameters: { type: 'object', properties: {} } },
      permission: 'owner',
      execute: async () => ({ success: true, content: 'executed' }),
    }));

    const ctx: ToolContext = { senderId: 'owner-1', isOwner: true, sessionId: 'sess-1' };
    const result = await registry.execute('dangerous', {}, ctx);
    expect(result.success).toBe(true);
    expect(result.content).toBe('executed');
  });

  it('execute catches tool errors gracefully', async () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool({
      execute: async () => { throw new Error('boom'); },
    }));

    const ctx: ToolContext = { senderId: 'user-1', isOwner: true, sessionId: 'sess-1' };
    const result = await registry.execute('mock_tool', {}, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('boom');
  });

  it('precheck blocks invalid write_file requests before confirmation', async () => {
    const registry = new ToolRegistry();
    registry.register(writeFileTool);
    let confirmCount = 0;

    const result = await registry.execute(
      'write_file',
      { path: '../../../etc/passwd', content: 'x' },
      {
        senderId: 'owner-1',
        isOwner: true,
        sessionId: 'sess-1',
        userMessage: '请把内容写入文件',
        confirm: async () => {
          confirmCount += 1;
          return { allow: true, scope: 'once' };
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('不安全');
    expect(confirmCount).toBe(0);
  });
});
describe('tool prompt registry injection', () => {
  it('injects custom prompts into time/browser/search/file tool definitions', () => {
    const prompts = createDefaultPromptRegistry('你是测试 Prompt。');
    prompts.tools.time.get_current_time.description = '自定义时间工具描述';
    prompts.tools.browser.browse_url.description = '自定义网页工具描述';
    prompts.tools.search.search_web.description = '自定义搜索工具描述';
    prompts.tools.file.write_file.description = '自定义写文件描述';

    expect(createGetCurrentTimeTool(prompts).definition.description).toBe('自定义时间工具描述');
    expect(createBrowseUrlTool(prompts).definition.description).toBe('自定义网页工具描述');
    expect(createSearchWebTool(prompts).definition.description).toBe('自定义搜索工具描述');
    expect(createWriteFileTool(undefined, prompts).definition.description).toBe('自定义写文件描述');
  });
});

describe('get_current_time tool', () => {
  it('returns current time in default timezone', async () => {
    const ctx: ToolContext = { senderId: 'user-1', isOwner: false, sessionId: 'sess-1' };
    const result: ToolResult = await getCurrentTimeTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.content).toContain('Asia/Shanghai');
    expect(result.content).toMatch(/\d{4}/);
  });

  it('supports custom timezone', async () => {
    const ctx: ToolContext = { senderId: 'user-1', isOwner: false, sessionId: 'sess-1' };
    const result = await getCurrentTimeTool.execute({ timezone: 'America/New_York' }, ctx);

    expect(result.success).toBe(true);
    expect(result.content).toContain('America/New_York');
  });

  it('handles invalid timezone', async () => {
    const ctx: ToolContext = { senderId: 'user-1', isOwner: false, sessionId: 'sess-1' };
    const result = await getCurrentTimeTool.execute({ timezone: 'Invalid/Zone' }, ctx);

    expect(result.success).toBe(false);
  });

  it('is a public tool', () => {
    expect(getCurrentTimeTool.permission).toBe('public');
    expect(getCurrentTimeTool.confirmRequired).toBe(false);
  });
});

describe('browse_url tool', () => {
  it('rejects missing url', async () => {
    const ctx: ToolContext = { senderId: 'owner-1', isOwner: true, sessionId: 'sess-1' };
    const result = await browseUrlTool.execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('url');
  });

  it('rejects url without http/https', async () => {
    const ctx: ToolContext = { senderId: 'owner-1', isOwner: true, sessionId: 'sess-1' };
    const result = await browseUrlTool.execute({ url: 'ftp://example.com' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('http');
  });

  it('is an owner tool', () => {
    expect(browseUrlTool.permission).toBe('owner');
  });

  it.skip('fetches example.com when given valid url', async () => {
    const ctx: ToolContext = { senderId: 'owner-1', isOwner: true, sessionId: 'sess-1' };
    const result = await browseUrlTool.execute({ url: 'https://example.com' }, ctx);
    expect(result.success).toBe(true);
    expect(result.content).toContain('【标题】');
    expect(result.content).toContain('【正文】');
    expect(result.content.toLowerCase()).toContain('example');
  }, 25_000);
});

describe('search_web tool', () => {
  it('rejects empty query', async () => {
    const ctx: ToolContext = { senderId: 'owner-1', isOwner: true, sessionId: 'sess-1' };
    const result = await searchWebTool.execute({}, ctx);
    expect(result.success).toBe(false);
  });

  it('requires permission support before searching the web', async () => {
    const ctx: ToolContext = { senderId: 'owner-1', isOwner: true, sessionId: 'sess-1' };
    const result = await searchWebTool.execute({ query: 'CrabCrush' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('权限确认');
  });

  it('stops when permission request is denied', async () => {
    const ctx: ToolContext = {
      senderId: 'owner-1',
      isOwner: true,
      sessionId: 'sess-1',
      requestPermission: async () => ({ allow: false, reason: 'rejected' }),
      hasPermissionGrant: () => false,
    };
    const result = await searchWebTool.execute({ query: 'CrabCrush' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('用户拒绝执行工具 "search_web"');
  });

  it('keeps timeout as structured failure when permission request times out', async () => {
    const ctx: ToolContext = {
      senderId: 'owner-1',
      isOwner: true,
      sessionId: 'sess-1',
      requestPermission: async () => ({ allow: false, reason: 'timeout' }),
      hasPermissionGrant: () => false,
    };
    const result = await searchWebTool.execute({ query: 'CrabCrush' }, ctx);
    expect(result.success).toBe(false);
    expect(result.failureKind).toBe('timeout');
    expect(result.degradeToAdvice).toBe(true);
  });

  it('builds a stable domain-scoped grant key for search engines', () => {
    const request = searchWebTool.buildPermissionRequest?.({ query: 'CrabCrush' }, {
      senderId: 'owner-1',
      isOwner: true,
      sessionId: 'sess-1',
    });

    expect(request?.grantKey).toBe('network:search:www.baidu.com|www.bing.com|www.google.com');
    expect(request?.preview?.targets).toEqual([
      'www.google.com',
      'www.bing.com',
      'www.baidu.com',
      'CrabCrush',
    ]);
  });

  it('is an owner tool', () => {
    expect(searchWebTool.permission).toBe('owner');
  });

  it.skip('searches when given valid query', async () => {
    const ctx: ToolContext = { senderId: 'owner-1', isOwner: true, sessionId: 'sess-1' };
    const result = await searchWebTool.execute({ query: 'CrabCrush' }, ctx);
    expect(result.success).toBe(true);
    expect(result.content).toMatch(/Google搜索|Bing搜索|百度搜索/);
    expect(result.content).toContain('CrabCrush');
  }, 25_000);
});

describe('read_file tool', () => {
  const ctx: ToolContext = { senderId: 'owner-1', isOwner: true, sessionId: 'sess-1' };

  it('rejects empty path', async () => {
    const result = await readFileTool.execute({}, ctx);
    expect(result.success).toBe(false);
  });

  it('rejects path traversal', async () => {
    const result = await readFileTool.execute({ path: '../../../etc/passwd' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('不安全');
  });

  it('rejects absolute path on Windows', async () => {
    if (process.platform !== 'win32') return;
    const result = await readFileTool.execute({ path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('权限确认');
  });

  it('rejects disallowed file types', async () => {
    const result = await readFileTool.execute({ path: 'workspace/image.png' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('不支持');
  });

  it('allows common code files outside the old extension whitelist', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-readfile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      mkdirSync(join(tmpDir, 'workspace'), { recursive: true });
      writeFileSync(join(tmpDir, 'workspace', 'App.tsx'), 'export function App() { return <div>Hello</div>; }');
      const result = await readFileTool.execute({ path: 'workspace/App.tsx' }, ctx);
      expect(result.success).toBe(true);
      expect(result.content).toContain('export function App');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects extensionless binary content', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-readfile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      mkdirSync(join(tmpDir, 'workspace'), { recursive: true });
      writeFileSync(join(tmpDir, 'workspace', 'blob'), Buffer.from([0, 159, 146, 150]));
      const result = await readFileTool.execute({ path: 'workspace/blob' }, ctx);
      expect(result.success).toBe(false);
      expect(result.content).toContain('二进制');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns file not found for non-existent file', async () => {
    const result = await readFileTool.execute({ path: 'workspace/nonexistent.md' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('不存在');
  });

  it('reads file content when file exists', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-readfile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      mkdirSync(join(tmpDir, 'workspace'), { recursive: true });
      writeFileSync(join(tmpDir, 'workspace', 'notes.md'), '# Hello\n\nThis is a test.');
      const result = await readFileTool.execute({ path: 'workspace/notes.md' }, ctx);
      expect(result.success).toBe(true);
      expect(result.content).toContain('Hello');
      expect(result.content).toContain('This is a test');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('is an owner tool', () => {
    expect(readFileTool.permission).toBe('owner');
  });
});

describe('list_files tool', () => {
  const ctx: ToolContext = { senderId: 'owner-1', isOwner: true, sessionId: 'sess-1' };

  it('lists files in directory', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-listfiles-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      mkdirSync(join(tmpDir, 'workspace'), { recursive: true });
      writeFileSync(join(tmpDir, 'workspace', 'notes.md'), '# Notes');
      writeFileSync(join(tmpDir, 'workspace', 'todo.txt'), 'todo');
      const result = await listFilesTool.execute({ path: 'workspace' }, ctx);
      expect(result.success).toBe(true);
      expect(result.content).toContain('notes.md');
      expect(result.content).toContain('todo.txt');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('filters by pattern', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-listfiles-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      mkdirSync(join(tmpDir, 'ws'), { recursive: true });
      writeFileSync(join(tmpDir, 'ws', 'a.md'), '');
      writeFileSync(join(tmpDir, 'ws', 'b.txt'), '');
      const result = await listFilesTool.execute({ path: 'ws', pattern: '*.md' }, ctx);
      expect(result.success).toBe(true);
      expect(result.content).toContain('a.md');
      expect(result.content).not.toContain('b.txt');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects path traversal', async () => {
    const result = await listFilesTool.execute({ path: '../../../etc' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('不安全');
  });
});

describe('write_file tool', () => {
  const ctx: ToolContext = { senderId: 'owner-1', isOwner: true, sessionId: 'sess-1' };

  it('rejects missing path', async () => {
    const result = await writeFileTool.execute({ content: 'hello' }, ctx);
    expect(result.success).toBe(false);
  });

  it('rejects missing content', async () => {
    const result = await writeFileTool.execute({ path: 'test.txt' }, ctx);
    expect(result.success).toBe(false);
  });

  it('rejects path traversal', async () => {
    const result = await writeFileTool.execute({ path: '../../../etc/passwd', content: 'x' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('不安全');
  });

  it('rejects disallowed file types', async () => {
    const result = await writeFileTool.execute({ path: 'workspace/image.png', content: 'x' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('不支持');
  });

  it('allows writing common text code files outside the old extension whitelist', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-writefile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      const result = await writeFileTool.execute(
        { path: 'workspace/schema.sql', content: 'select 1;' },
        { ...ctx, userMessage: '请把这段 SQL 保存到文件里' },
      );
      expect(result.success).toBe(true);
      const read = await readFileTool.execute({ path: 'workspace/schema.sql' }, ctx);
      expect(read.success).toBe(true);
      expect(read.content).toContain('select 1;');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects null-byte content even when extension is unknown', async () => {
    const result = await writeFileTool.execute(
      { path: 'workspace/blob.custom', content: 'a\u0000b' },
      { ...ctx, userMessage: '请把这段内容写入文件' },
    );
    expect(result.success).toBe(false);
    expect(result.content).toContain('空字节');
  });

  it('blocks write_file when no intent in userMessage', async () => {
    const result = await writeFileTool.execute(
      { path: 'workspace/a.txt', content: 'x' },
      { ...ctx, userMessage: '你好' },
    );
    expect(result.success).toBe(false);
    expect(result.content).toContain('未包含写文件意图');
  });

  it('accepts English write intent in userMessage', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-writefile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      const result = await writeFileTool.execute(
        { path: 'workspace/summary.md', content: 'hello' },
        { ...ctx, userMessage: 'Please save this summary to a file' },
      );
      expect(result.success).toBe(true);
      expect(result.content).toContain('已写入');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects reserved workspace files at fileBase root', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-writefile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      const result = await writeFileTool.execute(
        { path: 'USER.md', content: '名字：小明' },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.content).toContain('workspace/USER.md');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects AGENT.md at fileBase root and points to workspace path', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-writefile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      const result = await writeFileTool.execute(
        { path: 'AGENT.md', content: '请长期用中文，结论优先。' },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.content).toContain('workspace/AGENT.md');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects lowercase reserved workspace files at fileBase root', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-writefile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      const result = await writeFileTool.execute(
        { path: 'agent.md', content: '请长期用中文，结论优先。' },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.content).toContain('workspace/AGENT.md');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('allows AGENT.md under workspace directory', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-writefile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      const result = await writeFileTool.execute(
        { path: 'workspace/AGENT.md', content: '请长期用中文，结论优先。' },
        ctx,
      );
      expect(result.success).toBe(true);
      const read = await readFileTool.execute({ path: 'workspace/AGENT.md' }, ctx);
      expect(read.success).toBe(true);
      expect(read.content).toContain('结论优先');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('allows reserved workspace files under workspace directory', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-writefile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      const result = await writeFileTool.execute(
        { path: 'workspace/USER.md', content: '名字：小明' },
        ctx,
      );
      expect(result.success).toBe(true);
      const read = await readFileTool.execute({ path: 'workspace/USER.md' }, ctx);
      expect(read.success).toBe(true);
      expect(read.content).toContain('小明');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects overwrite when file exists', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-writefile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      const first = await writeFileTool.execute(
        { path: 'workspace/exist.txt', content: 'first' },
        ctx,
      );
      expect(first.success).toBe(true);

      const second = await writeFileTool.execute(
        { path: 'workspace/exist.txt', content: 'second' },
        ctx,
      );
      expect(second.success).toBe(false);
      expect(second.content).toContain('已存在');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('allows overwrite when overwrite=true', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-writefile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      const first = await writeFileTool.execute(
        { path: 'workspace/exist.txt', content: 'first' },
        ctx,
      );
      expect(first.success).toBe(true);

      const second = await writeFileTool.execute(
        { path: 'workspace/exist.txt', content: 'second', overwrite: true },
        { ...ctx, userMessage: '请更新这个文件' },
      );
      expect(second.success).toBe(true);
      const read = await readFileTool.execute({ path: 'workspace/exist.txt' }, ctx);
      expect(read.success).toBe(true);
      expect(read.content).toContain('second');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('writes file and creates parent dirs', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'crabcrush-writefile-'));
    const origBase = process.env.CRABCRUSH_FILE_BASE;
    process.env.CRABCRUSH_FILE_BASE = tmpDir;

    try {
      const result = await writeFileTool.execute(
        { path: 'workspace/sub/notes.md', content: '# Hello\n\nWritten by AI.' },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.content).toContain('已写入');
      const read = await readFileTool.execute({ path: 'workspace/sub/notes.md' }, ctx);
      expect(read.success).toBe(true);
      expect(read.content).toContain('Hello');
      expect(read.content).toContain('Written by AI');
    } finally {
      process.env.CRABCRUSH_FILE_BASE = origBase;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('is an owner tool and requires confirm', () => {
    expect(writeFileTool.permission).toBe('owner');
    expect(writeFileTool.confirmRequired).toBe(true);
  });
});

describe('tool plan policy', () => {
  it('marks low-risk built-in tools as safe_auto', () => {
    expect(getCurrentTimeTool.planPolicy).toBe('safe_auto');
    expect(readFileTool.planPolicy).toBe('safe_auto');
    expect(listFilesTool.planPolicy).toBe('safe_auto');
    expect(writeFileTool.planPolicy).toBeUndefined();
  });
});
