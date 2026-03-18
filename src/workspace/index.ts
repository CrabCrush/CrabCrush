/**
 * 工作区模块 — 人格化与工作区（DEC-032）
 *
 * 职责：
 * - 工作区目录 = fileBase/workspace，存放 AGENT.md、IDENTITY.md、USER.md、SOUL.md
 * - 每次对话前读取并注入到 system prompt；空时走 Bootstrap 引导
 *
 * 与文件工具的关系：
 * - 文件工具的根目录是 fileBase（非 fileBase/workspace）。write_file(path) 的 path 为相对 fileBase。
 * - 因此写入“工作区”内文件时，path 必须带 workspace/ 前缀，例如 workspace/AGENT.md、workspace/notes.md，才会落到 fileBase/workspace/ 下。
 * - 若模型传 path=AGENT.md 或 notes.md，则会写到 fileBase 根下，不会进 workspace 子目录。
 *
 * 参考：docs/OPENCLAW_ANALYSIS.md、docs/SMART_EXPERIENCE_PLAN.md
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PromptRegistry } from '../prompts/types.js';

/** 工作区目录名 */
export const WORKSPACE_DIR = 'workspace';

/** 工作区文件名 */
export const WORKSPACE_FILES = {
  AGENT: 'AGENT.md',
  IDENTITY: 'IDENTITY.md',
  USER: 'USER.md',
  SOUL: 'SOUL.md',
} as const;

/** 默认 fileBase（与 file.ts 的 getFileBasePath 一致） */
const DEFAULT_FILE_BASE = join(homedir(), '.crabcrush');

/** 用户侧默认 AGENT 模板唯一来源 */
export const DEFAULT_WORKSPACE_AGENT_TEMPLATE = [
  '请始终使用中文回复。',
  '结论优先，先给直接答案，再补充必要说明。',
  '没有实际执行过的操作，不要说成已经完成。',
  '涉及写文件、执行命令、修改数据等动作时，先说明影响与风险，再执行。',
].join('\n');

/**
 * 获取工作区路径（必须与 write_file 的 fileBase 一致，否则写入和读取会不一致）
 * @param fileBase 文件工具根目录，默认 ~/.crabcrush
 */
export function getWorkspacePath(fileBase?: string): string {
  const base = fileBase?.trim() || DEFAULT_FILE_BASE;
  return join(base, WORKSPACE_DIR);
}
/**
 * 确保工作区目录存在（首次启动时创建，避免 read 时目录不存在）
 */
export function ensureWorkspaceDir(workspacePath: string): void {
  mkdirSync(workspacePath, { recursive: true });
}

/**
 * 首次启动时初始化工作区种子文件
 * 仅在文件不存在时创建默认 AGENT.md，不覆盖用户已有内容
 */
export function ensureWorkspaceSeedFiles(workspacePath: string): void {
  ensureWorkspaceDir(workspacePath);
  const agentPath = join(workspacePath, WORKSPACE_FILES.AGENT);
  if (!existsSync(agentPath)) {
    writeFileSync(agentPath, DEFAULT_WORKSPACE_AGENT_TEMPLATE, 'utf-8');
  }
}

export interface WorkspaceContent {
  agent: string;
  identity: string;
  user: string;
  soul: string;
}

function normalizeWorkspaceField(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

/**
 * 读取工作区文件内容
 * 文件不存在或读取失败时返回空字符串
 */
export async function readWorkspaceFiles(workspacePath: string): Promise<WorkspaceContent> {
  const read = async (path: string): Promise<string> => {
    try {
      const content = await readFile(path, { encoding: 'utf-8' });
      return content.trim();
    } catch {
      return '';
    }
  };

  const [agent, identity, user, soul] = await Promise.all([
    read(join(workspacePath, WORKSPACE_FILES.AGENT)),
    read(join(workspacePath, WORKSPACE_FILES.IDENTITY)),
    read(join(workspacePath, WORKSPACE_FILES.USER)),
    read(join(workspacePath, WORKSPACE_FILES.SOUL)),
  ]);

  return { agent, identity, user, soul };
}

/**
 * 覆盖保存工作区主配置文件
 * 空字符串会写入为空文件，便于用户“清空”某一项配置
 */
export async function saveWorkspaceFiles(workspacePath: string, content: WorkspaceContent): Promise<void> {
  ensureWorkspaceDir(workspacePath);
  const writes: Array<Promise<void>> = [
    writeFile(join(workspacePath, WORKSPACE_FILES.AGENT), normalizeWorkspaceField(content.agent), 'utf-8'),
    writeFile(join(workspacePath, WORKSPACE_FILES.IDENTITY), normalizeWorkspaceField(content.identity), 'utf-8'),
    writeFile(join(workspacePath, WORKSPACE_FILES.USER), normalizeWorkspaceField(content.user), 'utf-8'),
    writeFile(join(workspacePath, WORKSPACE_FILES.SOUL), normalizeWorkspaceField(content.soul), 'utf-8'),
  ];
  await Promise.all(writes);
}

/**
 * 判断工作区是否为空（需引导用户填写）
 * 只要 AGENT / IDENTITY / USER 三者之一存在，就认为用户已经开始配置，不再强制 Bootstrap
 */
export function isWorkspaceEmpty(content: WorkspaceContent): boolean {
  return !content.agent.trim() && !content.identity.trim() && !content.user.trim();
}

/**
 * 组装完整 system prompt
 * @param prompts PromptRegistry（已在启动时加载并缓存）
 * @param workspaceContent 工作区文件内容
 */
export function buildSystemPrompt(prompts: PromptRegistry, workspaceContent: WorkspaceContent): string {
  const parts: string[] = [prompts.system.base];

  if (workspaceContent.agent) {
    parts.push(`\n【用户主提示（AGENT.md）】\n${workspaceContent.agent}`);
  }

  if (workspaceContent.identity) {
    parts.push(`\n【你的身份】\n${workspaceContent.identity}`);
  }
  if (workspaceContent.user) {
    parts.push(`\n【用户信息】\n${workspaceContent.user}`);
  }
  if (workspaceContent.soul) {
    parts.push(`\n【性格边界】\n${workspaceContent.soul}`);
  }

  if (isWorkspaceEmpty(workspaceContent)) {
    parts.push(prompts.workspace.bootstrap);
  } else {
    parts.push(prompts.system.behavior);
  }

  parts.push(prompts.system.fileToolRules);
  parts.push(prompts.system.workspacePathRules);

  return parts.join('\n').trim();
}
