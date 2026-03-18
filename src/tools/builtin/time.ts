/**
 * 内置工具：获取当前时间
 * 用途：让 AI 知道现在几点，回答 "现在几点" 之类的问题
 * 权限：public（安全无害，所有人可用）
 */

import { createDefaultPromptRegistry } from '../../prompts/defaults.js';
import type { PromptRegistry } from '../../prompts/types.js';
import type { Tool, ToolContext, ToolResult } from '../types.js';

function getTimeToolPrompts(prompts?: PromptRegistry): PromptRegistry['tools']['time'] {
  return (prompts ?? createDefaultPromptRegistry()).tools.time;
}

export function createGetCurrentTimeTool(prompts?: PromptRegistry): Tool {
  const timePrompts = getTimeToolPrompts(prompts);

  return {
    definition: {
      name: 'get_current_time',
      description: timePrompts.get_current_time.description,
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: timePrompts.get_current_time.parameters.timezone,
            default: 'Asia/Shanghai',
          },
        },
      },
    },
    permission: 'public',
    confirmRequired: false,
    planPolicy: 'safe_auto',

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
}

export const getCurrentTimeTool = createGetCurrentTimeTool();
