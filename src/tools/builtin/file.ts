/**
 * 内置工具：文件操作（读取、列出/查找）
 *
 * 用途：让 AI 能读取、查找用户文件，回答「这个文件写了什么」「帮我找一下 XXX 的笔记」等问题
 * 权限：owner（本地文件访问，DEC-026）
 * 安全：仅允许访问配置的根目录下的文件，拒绝路径穿越
 * 设计：DEC-030 — 大内容截断，不塞满上下文
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
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

/** 简单 glob 匹配：*.md / notes* / *report*，文件名不区分大小写 */
function matchPattern(name: string, pattern: string): boolean {
  if (!pattern || pattern === '*') return true;
  const n = name.toLowerCase();
  const p = pattern.toLowerCase();
  const parts = p.split('*');
  if (parts.length === 1) return n === p;
  if (parts.length === 2) {
    const [p1, p2] = parts;
    if (p1 && p2) return n.startsWith(p1) && n.endsWith(p2);
    if (p1) return n.startsWith(p1);
    if (p2) return n.endsWith(p2);
    return true;
  }
  const required = parts.filter(Boolean);
  return required.every((part) => n.includes(part));
}

/**
 * 创建 list_files 工具（列出/查找文件）
 * 与 read_file 共用根目录配置，先 list_files 查找再用 read_file 读取
 */
export function createListFilesTool(config?: { fileBase?: string }): Tool {
  const MAX_RESULTS = 50;
  const MAX_DEPTH = 3;

  return {
    definition: {
      name: 'list_files',
      description: '列出或查找目录下的文件。当用户说「帮我找一下」「有哪些文件」「列出 XXX 目录」时先调用此工具查找，再用 read_file 读取具体文件。支持按名称模式过滤（如 *.md 找所有 Markdown）。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '相对于根目录的目录路径，如 workspace 或 . 表示根目录',
            default: '.',
          },
          pattern: {
            type: 'string',
            description: '可选，文件名过滤模式。如 *.md 找 Markdown，notes* 找以 notes 开头的文件',
          },
          recursive: {
            type: 'boolean',
            description: '是否递归子目录，默认 false',
            default: false,
          },
        },
        required: [],
      },
    },
    permission: 'owner',
    confirmRequired: false,

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const pathArg = ((args.path as string) || '.').trim().replace(/^\/+/, '') || '.';
      const pattern = (args.pattern as string)?.trim() || '';
      const recursive = Boolean(args.recursive);

      const basePath = getFileBasePath(config);
      const baseDisplay = basePath.startsWith(homedir()) ? '~' + basePath.slice(homedir().length) : basePath;

      if (!isPathSafe(basePath, pathArg)) {
        return { success: false, content: `路径不安全，仅允许访问 ${baseDisplay} 下的文件` };
      }

      const dirPath = resolve(basePath, pathArg);
      const results: string[] = [];

      async function scan(dir: string, relPrefix: string, depth: number): Promise<void> {
        if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (results.length >= MAX_RESULTS) break;
          if (e.name.startsWith('.')) continue;
          const relPath = relPrefix ? `${relPrefix}/${e.name}` : e.name;
          if (e.isFile()) {
            if (matchPattern(e.name, pattern)) results.push(relPath);
          } else if (e.isDirectory()) {
            if (recursive) {
              await scan(resolve(dir, e.name), relPath, depth + 1);
            } else {
              results.push(relPath + '/'); // 标记为目录，便于用户继续 list_files
            }
          }
        }
      }

      try {
        await scan(dirPath, pathArg === '.' ? '' : pathArg, 0);
        if (results.length === 0) {
          return {
            success: true,
            content: `目录 ${pathArg || '.'} 下${pattern ? `匹配 "${pattern}" 的` : ''}文件为空。可用 read_file 读取已知路径。`,
          };
        }
        const list = results.slice(0, MAX_RESULTS).join('\n');
        const more = results.length >= MAX_RESULTS ? `\n（已截断，最多 ${MAX_RESULTS} 个）` : '';
        return {
          success: true,
          content: `找到 ${results.length} 个文件：\n\n${list}${more}\n\n使用 read_file 读取具体文件，如 read_file(path: "workspace/notes.md")`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENOENT')) return { success: false, content: `目录不存在：${pathArg}` };
        if (msg.includes('ENOTDIR')) return { success: false, content: `路径不是目录：${pathArg}` };
        if (msg.includes('EACCES')) return { success: false, content: `无读取权限：${pathArg}` };
        return { success: false, content: `列出失败：${msg}` };
      }
    },
  };
}

export const listFilesTool = createListFilesTool();

/**
 * 创建 write_file 工具（写入文件）
 * 与 read_file 共用根目录配置，仅允许在 fileBase 下创建/覆盖文件
 * confirmRequired: true（高危操作，待 2a.2 确认机制实现后生效）
 */
export function createWriteFileTool(config?: { fileBase?: string }): Tool {
  return {
    definition: {
      name: 'write_file',
      description: '将内容写入本地文件。当用户要求「保存」「写入」「创建文件」「修改 XXX 文件」时调用。仅可写入配置的根目录下（默认 ~/.crabcrush）。若文件已存在则覆盖。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '相对于根目录的文件路径，如 workspace/notes.md',
          },
          content: {
            type: 'string',
            description: '要写入的文本内容',
          },
        },
        required: ['path', 'content'],
      },
    },
    permission: 'owner',
    confirmRequired: true,

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const pathArg = args.path as string;
      const content = args.content as string;

      if (!pathArg || typeof pathArg !== 'string') {
        return { success: false, content: '请提供有效的 path 参数' };
      }
      if (content === undefined || content === null) {
        return { success: false, content: '请提供 content 参数' };
      }

      const basePath = getFileBasePath(config);
      const baseDisplay = basePath.startsWith(homedir()) ? '~' + basePath.slice(homedir().length) : basePath;

      const trimmed = pathArg.trim().replace(/^\/+/, '');
      if (!isPathSafe(basePath, trimmed)) {
        return { success: false, content: `路径不安全，仅允许写入 ${baseDisplay} 下的文件` };
      }

      if (!isAllowedExt(trimmed)) {
        return {
          success: false,
          content: `不支持该文件类型。允许的扩展名：${[...ALLOWED_EXT].join(', ')}`,
        };
      }

      const fullPath = resolve(basePath, trimmed);

      try {
        const dir = dirname(fullPath);
        mkdirSync(dir, { recursive: true });
        await writeFile(fullPath, String(content), { encoding: 'utf-8' });
        return {
          success: true,
          content: `已写入 ${pathArg}（${String(content).length} 字符）`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('EACCES')) {
          return { success: false, content: `无写入权限：${pathArg}` };
        }
        return { success: false, content: `写入失败：${msg}` };
      }
    },
  };
}

export const writeFileTool = createWriteFileTool();
