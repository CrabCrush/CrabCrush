/**
 * 内置工具：获取当前时间
 * 用途：让 AI 知道现在几点，回答 "现在几点" 之类的问题
 * 权限：public（安全无害，所有人可用）
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';

export const getCurrentTimeTool: Tool = {
  definition: {
    name: 'get_current_time',
    description: '获取当前日期和时间。当用户询问"现在几点"、"今天几号"、"今天星期几"等与时间日期相关的问题时调用此工具。',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: '时区，如 "Asia/Shanghai"（默认中国时间）',
          default: 'Asia/Shanghai',
        },
      },
    },
  },
  permission: 'public',
  confirmRequired: false,

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const timezone = (args.timezone as string) || 'Asia/Shanghai';

    try {
      const now = new Date();
      const formatted = now.toLocaleString('zh-CN', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      return {
        success: true,
        content: `当前时间（${timezone}）：${formatted}`,
      };
    } catch {
      return {
        success: false,
        content: `无法获取时区 "${timezone}" 的时间，请使用标准时区格式（如 Asia/Shanghai）`,
      };
    }
  },
};
