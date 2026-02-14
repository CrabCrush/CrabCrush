import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { getCurrentTimeTool } from '../src/tools/builtin/time.js';
import type { Tool, ToolContext, ToolResult } from '../src/tools/types.js';

// 创建测试用的 mock 工具
function createMockTool(overrides: Partial<Tool> = {}): Tool {
  return {
    definition: {
      name: overrides.definition?.name ?? 'mock_tool',
      description: 'A mock tool for testing',
      parameters: { type: 'object', properties: {} },
    },
    permission: overrides.permission ?? 'public',
    confirmRequired: overrides.confirmRequired ?? false,
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

    // 非 owner 只能看到 public 工具
    const publicDefs = registry.getDefinitionsForModel(false);
    expect(publicDefs).toHaveLength(1);
    expect(publicDefs[0].name).toBe('public_tool');

    // owner 能看到所有工具
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
});

describe('get_current_time tool', () => {
  it('returns current time in default timezone', async () => {
    const ctx: ToolContext = { senderId: 'user-1', isOwner: false, sessionId: 'sess-1' };
    const result: ToolResult = await getCurrentTimeTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.content).toContain('Asia/Shanghai');
    // 应该包含年月日
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
