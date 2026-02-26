/**
 * 工具注册中心
 * 管理所有已注册的工具，提供查找、权限过滤等功能
 */

import type { Tool, ToolDefinition, ToolContext, ToolResult } from './types.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /**
   * 注册一个工具
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`工具 "${tool.definition.name}" 已注册，不能重复注册`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  /**
   * 获取工具（按名称）
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取发给模型的工具定义列表
   * 只返回当前用户有权限使用的工具
   */
  getDefinitionsForModel(isOwner: boolean): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      // public 工具所有人可见，owner 工具仅 owner 可见
      if (tool.permission === 'public' || isOwner) {
        definitions.push(tool.definition);
      }
    }
    return definitions;
  }

  /**
   * 执行工具调用
   * 返回 ToolResult，权限不足或工具不存在也返回 ToolResult（不抛异常）
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      return { success: false, content: `工具 "${name}" 不存在` };
    }

    // 权限检查（DEC-026）
    if (tool.permission === 'owner' && !context.isOwner) {
      return {
        success: false,
        content: `工具 "${name}" 仅限 owner 使用。当前用户无权限。`,
      };
    }

    if (tool.confirmRequired) {
      if (!context.confirm) {
        context.audit?.({
          type: 'tool_confirm_missing',
          name,
          sessionId: context.sessionId,
          senderId: context.senderId,
        });
        return { success: false, content: `工具 "${name}" 需要用户确认，当前通道不支持确认。` };
      }

      let allowed = false;
      try {
        allowed = await context.confirm({
          name,
          args,
          sessionId: context.sessionId,
          senderId: context.senderId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, content: `确认失败: ${message}` };
      }

      context.audit?.({
        type: 'tool_confirm',
        name,
        sessionId: context.sessionId,
        senderId: context.senderId,
        allowed,
      });

      if (!allowed) {
        return { success: false, content: `用户拒绝执行工具 "${name}"` };
      }
    }

    try {
      return await tool.execute(args, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, content: `工具执行失败: ${message}` };
    }
  }

  /**
   * 已注册的工具数量
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 所有工具名称
   */
  get names(): string[] {
    return [...this.tools.keys()];
  }
}
