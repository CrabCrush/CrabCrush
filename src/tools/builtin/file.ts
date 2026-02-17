/**
 * 内置工具：读取本地文件
 *
 * 用途：让 AI 能读取用户指定的文件内容，回答「这个文件写了什么」「帮我总结这个文档」等问题
 * 权限：owner（本地文件访问，DEC-026）
 * 安全：仅允许读取配置的根目录下的文件，拒绝路径穿越
 * 设计：DEC-030 — 大内容截断，不塞满上下文
 */

import { readFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { homedir } from 'node:os';
import type { Tool, ToolContext, ToolResult } from '../types.js';

const DEFAULT_MAX_CHARS = 8000;

/** 允许的文本文件扩展名（避免读二进制） */
const ALLOWED_EXT = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.csv', '.log',
  '.js', '.ts', '.mjs', '.cjs', '.html', '.css', '.xml',
  '.py', '.sh', '.bash', '.zsh', '.env', '.gitignore',
]);

function isAllowedExt(filePath: string): boolean {
  const idx = filePath.lastIndexOf('.');
  if (idx === -1) return true;
  return ALLOWED_EXT.has(filePath.slice(idx).toLowerCase());
}

function isPathSafe(base: string, relativePath: string): boolean {
  const resolved = resolve(base, relativePath);
  const rel = relative(base, resolved);
  return !rel.startsWith('..') && !rel.startsWith('/');
}

/** 获取 read_file 根目录：环境变量 > YAML 配置 > 默认 ~/.crabcrush */
export function getFileBasePath(config?: { fileBase?: string }): string {
  return (
    process.env.CRABCRUSH_FILE_BASE
    ?? config?.fileBase
    ?? join(homedir(), '.crabcrush')
  );
}

/**
 * 创建 read_file 工具（支持配置根目录）
 * 根目录在每次 execute 时解析，以支持运行时环境变量（如测试中设置 CRABCRUSH_FILE_BASE）
 */
export function createReadFileTool(config?: { fileBase?: string }): Tool {
  return {
    definition: {
      name: 'read_file',
      description: '读取本地文件内容。当用户提供文件路径、询问文件内容、要求总结某文档时调用。仅可读取配置的根目录下的文件（默认 ~/.crabcrush，可通过 tools.fileBase 或 CRABCRUSH_FILE_BASE 修改）。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '相对于根目录（默认 ~/.crabcrush，可配置 tools.fileBase）的文件路径，如 workspace/notes.md 或 config/crabcrush.yaml',
          },
          maxChars: {
            type: 'number',
            description: '返回内容的最大字符数，默认 8000',
            default: DEFAULT_MAX_CHARS,
          },
        },
        required: ['path'],
      },
    },
    permission: 'owner',
    confirmRequired: false,

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const pathArg = args.path as string;
      const maxChars = (args.maxChars as number) || DEFAULT_MAX_CHARS;

      if (!pathArg || typeof pathArg !== 'string') {
        return { success: false, content: '请提供有效的 path 参数' };
      }

      const basePath = getFileBasePath(config);
      const baseDisplay = basePath.startsWith(homedir()) ? '~' + basePath.slice(homedir().length) : basePath;

      const trimmed = pathArg.trim().replace(/^\/+/, '');
      if (!isPathSafe(basePath, trimmed)) {
        return { success: false, content: `路径不安全，仅允许读取 ${baseDisplay} 下的文件` };
      }

      if (!isAllowedExt(trimmed)) {
        return {
          success: false,
          content: `不支持该文件类型。允许的扩展名：${[...ALLOWED_EXT].join(', ')}`,
        };
      }

      const fullPath = resolve(basePath, trimmed);

      try {
        const buf = await readFile(fullPath, { encoding: 'utf-8' });
        let text = buf;
        const truncated = text.length > maxChars;
        if (truncated) {
          text = text.slice(0, maxChars) + '\n\n（内容已截断）';
        }
        return {
          success: true,
          content: truncated
            ? `【文件：${pathArg}】（已截断至 ${maxChars} 字符）\n\n${text}`
            : `【文件：${pathArg}】\n\n${text}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENOENT')) {
          return { success: false, content: `文件不存在：${pathArg}` };
        }
        if (msg.includes('EACCES')) {
          return { success: false, content: `无读取权限：${pathArg}` };
        }
        if (msg.includes('EISDIR')) {
          return { success: false, content: `路径是目录，不是文件：${pathArg}` };
        }
        return { success: false, content: `读取失败：${msg}` };
      }
    },
  };
}

/** 默认 read_file 工具（使用默认根目录，用于无 config 场景如测试） */
export const readFileTool = createReadFileTool();
