/**
 * 内置工具：文件操作（读取、列出/查找）
 *
 * 用途：让 AI 能读取、查找用户文件，回答「这个文件写了什么」「帮我找一下 XXX 的笔记」等问题
 * 权限：owner（本地文件访问，DEC-026）
 * 安全：仅允许访问配置的根目录下的文件，拒绝路径穿越
 * 设计：DEC-030 — 大内容截断，不塞满上下文
 */

import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { resolve, join, relative, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import type {
  PermissionRequest,
  Tool,
  ToolConfirmRequest,
  ToolContext,
  ToolExecutionPreview,
  ToolResult,
} from '../types.js';
import { hasWriteFileIntent } from '../intent.js';
import { createDefaultPromptRegistry } from '../../prompts/defaults.js';
import type { PromptRegistry } from '../../prompts/types.js';
import { WORKSPACE_DIR, WORKSPACE_FILES } from '../../workspace/index.js';

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
  const resolvedBase = resolve(base);
  const resolved = resolve(base, relativePath);
  const rel = relative(resolvedBase, resolved);
  if (rel === '') return true;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

function previewForPath(title: string, summary: string, target: string, riskLevel: 'medium' | 'high' = 'medium'): ToolExecutionPreview {
  return {
    title,
    summary,
    riskLevel,
    targets: [target],
  };
}

function getDirectoryGrantKey(action: 'read_file' | 'write_file', fullPath: string): string {
  return `file:${action}:${dirname(fullPath)}`;
}

function getListGrantKey(fullPath: string): string {
  return `file:list:${fullPath}`;
}

function getFileToolPrompts(prompts?: PromptRegistry): PromptRegistry['tools']['file'] {
  return (prompts ?? createDefaultPromptRegistry()).tools.file;
}

const RESERVED_WORKSPACE_ROOT_FILES = new Set<string>(Object.values(WORKSPACE_FILES).map((name) => name.toLowerCase()));

function getReservedWorkspacePathError(pathArg: string): string | null {
  const normalized = pathArg.trim().replace(/^[/\\]+/, '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith(`${WORKSPACE_DIR}/`) || normalized.includes('/')) return null;
  const filename = normalized.toLowerCase();
  if (!RESERVED_WORKSPACE_ROOT_FILES.has(filename)) return null;
  const canonical = Object.values(WORKSPACE_FILES).find((name) => name.toLowerCase() === filename) ?? normalized;
  return `工作区保留文件 ${canonical} 必须写入 ${WORKSPACE_DIR}/ 下。请改用 ${WORKSPACE_DIR}/${canonical}`;
}

/** 仅当 path 为绝对路径（fileBase 外）时使用；支持 persistent，选「永久允许」后同路径/同目录不再弹窗 */
function buildOutOfBasePermissionRequest(
  action: 'read_file' | 'list_files',
  fullPath: string,
  params: Record<string, unknown>,
  displayPath: string,
): PermissionRequest {
  return {
    action,
    message: action === 'read_file'
      ? `是否允许读取该文件？\n${displayPath}`
      : `是否允许扫描该目录？\n${displayPath}`,
    params,
    grantKey: action === 'read_file' ? getDirectoryGrantKey('read_file', fullPath) : getListGrantKey(fullPath),
    scopeOptions: ['once', 'session', 'persistent'],
    defaultScope: 'once',
    preview: previewForPath(
      action === 'read_file' ? '读取文件' : '扫描目录',
      action === 'read_file' ? '该操作将读取 fileBase 之外的本地文件。' : '该操作将扫描 fileBase 之外的目录结构。',
      fullPath,
      'medium',
    ),
  };
}

async function requestOutOfBasePermission(
  context: ToolContext,
  action: 'read_file' | 'list_files',
  fullPath: string,
  message: string,
  params: Record<string, unknown>,
): Promise<ToolResult | null> {
  const grantKey = action === 'read_file' ? getDirectoryGrantKey('read_file', fullPath) : getListGrantKey(fullPath);
  if (context.hasPermissionGrant?.(grantKey)) {
    return null;
  }
  if (!context.requestPermission) {
    return { success: false, content: '路径超出允许范围，需要通道支持权限确认。' };
  }
  const allowed = await context.requestPermission({
    ...buildOutOfBasePermissionRequest(action, fullPath, params, message.split('\n').slice(1).join('\n') || fullPath),
    grantKey,
  });
  if (!allowed) return { success: false, content: `用户拒绝执行工具 "${action}"` };
  return null;
}

/** 获取 read_file 根目录：环境变量 > YAML 配置 > 默认 ~/.crabcrush */
export function getFileBasePath(config?: { fileBase?: string }): string {
  return process.env.CRABCRUSH_FILE_BASE ?? config?.fileBase ?? join(homedir(), '.crabcrush');
}

/**
 * 创建 read_file 工具（支持配置根目录）
 * 根目录在每次 execute 时解析，以支持运行时环境变量（如测试中设置 CRABCRUSH_FILE_BASE）
 */
export function createReadFileTool(config?: { fileBase?: string }, prompts?: PromptRegistry): Tool {
  const filePrompts = getFileToolPrompts(prompts);

  return {
    definition: {
      name: 'read_file',
      description: filePrompts.read_file.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: filePrompts.read_file.parameters.path,
          },
          maxChars: {
            type: 'number',
            description: filePrompts.read_file.parameters.maxChars,
            default: DEFAULT_MAX_CHARS,
          },
        },
        required: ['path'],
      },
    },
    permission: 'owner',
    confirmRequired: false,
    planPolicy: 'safe_auto',
    buildPermissionRequest(args: Record<string, unknown>) {
      const pathArg = args.path as string;
      if (!pathArg || typeof pathArg !== 'string') return null;
      const rawPath = pathArg.trim();
      if (!isAbsolute(rawPath)) return null;
      return buildOutOfBasePermissionRequest('read_file', rawPath, { path: rawPath }, rawPath);
    },

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const pathArg = args.path as string;
      const maxChars = (args.maxChars as number) || DEFAULT_MAX_CHARS;

      if (!pathArg || typeof pathArg !== 'string') {
        return { success: false, content: '请提供有效的 path 参数' };
      }

      const basePath = getFileBasePath(config);
      const baseDisplay = basePath.startsWith(homedir()) ? '~' + basePath.slice(homedir().length) : basePath;
      const rawPath = pathArg.trim();
      const isAbs = isAbsolute(rawPath);
      const trimmed = isAbs ? rawPath : rawPath.replace(/^\/+/, '');

      if (!isAbs && !isPathSafe(basePath, trimmed)) {
        return { success: false, content: `路径不安全，仅允许读取 ${baseDisplay} 下的文件` };
      }

      if (!isAllowedExt(trimmed)) {
        return {
          success: false,
          content: '不支持该文件类型。允许的扩展名：' + [...ALLOWED_EXT].join(', '),
        };
      }

      const fullPath = isAbs ? trimmed : resolve(basePath, trimmed);
      if (isAbs) {
        // 读取 fileBase 之外路径需要运行时权限确认（默认仅本次）。
        const perm = await requestOutOfBasePermission(
          context,
          'read_file',
          fullPath,
          `是否允许读取该文件？\n${trimmed}`,
          { path: trimmed },
        );
        if (perm) return perm;
      }

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
        if (msg.includes('ENOENT')) return { success: false, content: `文件不存在：${pathArg}` };
        if (msg.includes('EACCES')) return { success: false, content: `无读取权限：${pathArg}` };
        if (msg.includes('EISDIR')) return { success: false, content: `路径是目录，不是文件：${pathArg}` };
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
export function createListFilesTool(config?: { fileBase?: string }, prompts?: PromptRegistry): Tool {
  const MAX_RESULTS = 50;
  const MAX_DEPTH = 3;
  const filePrompts = getFileToolPrompts(prompts);

  return {
    definition: {
      name: 'list_files',
      description: filePrompts.list_files.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: filePrompts.list_files.parameters.path,
            default: '.',
          },
          pattern: {
            type: 'string',
            description: filePrompts.list_files.parameters.pattern,
          },
          recursive: {
            type: 'boolean',
            description: filePrompts.list_files.parameters.recursive,
            default: false,
          },
        },
        required: [],
      },
    },
    permission: 'owner',
    confirmRequired: false,
    planPolicy: 'safe_auto',
    buildPermissionRequest(args: Record<string, unknown>) {
      const rawPath = ((args.path as string) || '.').trim() || '.';
      const pattern = (args.pattern as string)?.trim() || '';
      const recursive = Boolean(args.recursive);
      if (!isAbsolute(rawPath)) return null;
      return buildOutOfBasePermissionRequest(
        'list_files',
        rawPath,
        { path: rawPath, pattern, recursive },
        rawPath,
      );
    },

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const rawPath = ((args.path as string) || '.').trim() || '.';
      const pattern = (args.pattern as string)?.trim() || '';
      const recursive = Boolean(args.recursive);

      const basePath = getFileBasePath(config);
      const baseDisplay = basePath.startsWith(homedir()) ? '~' + basePath.slice(homedir().length) : basePath;
      const isAbs = isAbsolute(rawPath);
      const pathArg = isAbs ? rawPath : rawPath.replace(/^\/+/, '') || '.';

      if (!isAbs && !isPathSafe(basePath, pathArg)) {
        return { success: false, content: `路径不安全，仅允许访问 ${baseDisplay} 下的文件` };
      }

      const dirPath = isAbs ? pathArg : resolve(basePath, pathArg);
      if (isAbs) {
        const perm = await requestOutOfBasePermission(
          context,
          'list_files',
          dirPath,
          `是否允许扫描该目录？\n${pathArg}`,
          { path: pathArg, pattern, recursive },
        );
        if (perm) return perm;
      }

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
            } else if (!pattern) {
              results.push(relPath + '/');
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
        const hint = pattern
          ? '如需查看内容，请用 read_file 读取具体文件。'
          : '使用 read_file 读取具体文件，如 read_file(path: "workspace/notes.md")';
        return {
          success: true,
          content: `找到 ${results.length} 个文件：\n\n${list}${more}\n\n${hint}`,
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
export function createWriteFileTool(config?: { fileBase?: string }, prompts?: PromptRegistry): Tool {
  const filePrompts = getFileToolPrompts(prompts);

  return {
    definition: {
      name: 'write_file',
      description: filePrompts.write_file.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: filePrompts.write_file.parameters.path,
          },
          content: {
            type: 'string',
            description: filePrompts.write_file.parameters.content,
          },
          overwrite: {
            type: 'boolean',
            description: filePrompts.write_file.parameters.overwrite,
            default: false,
          },
        },
        required: ['path', 'content'],
      },
    },
    permission: 'owner',
    confirmRequired: true,

    buildConfirmRequest(args: Record<string, unknown>): Partial<ToolConfirmRequest> {
      const pathArg = typeof args.path === 'string' ? args.path.trim() : '';
      const content = typeof args.content === 'string' ? args.content : '';
      const overwrite = Boolean(args.overwrite);
      const basePath = getFileBasePath(config);
      const trimmed = pathArg.replace(/^\/+/, '');
      const fullPath = resolve(basePath, trimmed || '.');
      return {
        message: overwrite ? '该操作将覆盖或创建本地文件，请确认是否继续。' : '该操作将创建本地文件，请确认是否继续。',
        grantKey: getDirectoryGrantKey('write_file', fullPath),
        scopeOptions: ['once', 'session', 'persistent'],
        defaultScope: 'once',
        preview: {
          title: overwrite ? '写入或覆盖文件' : '写入文件',
          summary: `将向 ${pathArg || '未指定路径'} 写入 ${content.length} 个字符。`,
          riskLevel: 'high',
          targets: [pathArg || '未指定路径'],
        },
      };
    },

    async precheck(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult | null> {
      const pathArg = args.path as string;
      const overwrite = Boolean(args.overwrite);

      if (!pathArg || typeof pathArg !== 'string') return null;
      const reservedPathError = getReservedWorkspacePathError(pathArg);
      if (reservedPathError) return { success: false, content: reservedPathError };
      // 这里的意图判断只是防“模型自作主张写文件”的低成本护栏。
      // 长期应更多依赖 plan approval + execution preview + confirm，而不是关键词本身。
      if (context.userMessage && !hasWriteFileIntent(context.userMessage, overwrite)) {
        return {
          success: false,
          content: '当前请求未包含写文件意图，已阻止 write_file。',
        };
      }

      const basePath = getFileBasePath(config);
      const trimmed = pathArg.trim().replace(/^\/+/, '');
      if (!isPathSafe(basePath, trimmed)) return null;

      const fullPath = resolve(basePath, trimmed);
      try {
        await access(fullPath);
        if (!overwrite) {
          return {
            success: false,
            content: `文件已存在：${pathArg}。如需覆盖，请让助手以 overwrite=true 重试，并在确认弹窗中批准覆盖。`,
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('ENOENT')) {
          return { success: false, content: `预检失败：${msg}` };
        }
      }

      return null;
    },

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const pathArg = args.path as string;
      const content = args.content as string;
      const overwrite = Boolean(args.overwrite);
      // execute 里重复做一次，是为了避免绕过 precheck 时失去这层安全兜底。
      if (context.userMessage && !hasWriteFileIntent(context.userMessage, overwrite)) {
        return { success: false, content: '当前请求未包含写文件意图，已阻止 write_file。' };
      }

      if (!pathArg || typeof pathArg !== 'string') {
        return { success: false, content: '请提供有效的 path 参数' };
      }
      if (content === undefined || content === null) {
        return { success: false, content: '请提供 content 参数' };
      }

      const reservedPathError = getReservedWorkspacePathError(pathArg);
      if (reservedPathError) {
        return { success: false, content: reservedPathError };
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
        try {
          await access(fullPath);
          if (!overwrite) {
            return {
              success: false,
              content: `文件已存在：${pathArg}。如需覆盖，请让助手以 overwrite=true 重试，并在确认弹窗中批准覆盖。`,
            };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('ENOENT')) throw err;
        }

        mkdirSync(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, String(content), { encoding: 'utf-8' });
        return {
          success: true,
          content: `已写入 ${pathArg}（${String(content).length} 字符）`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('EACCES')) return { success: false, content: `无写入权限：${pathArg}` };
        return { success: false, content: `写入失败：${msg}` };
      }
    },
  };
}

export const writeFileTool = createWriteFileTool();
