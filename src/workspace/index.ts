/**
 * 工作区模块 — 人格化与工作区（DEC-032）
 *
 * 工作区目录存放 IDENTITY.md（AI 身份）、USER.md（用户信息）、SOUL.md（性格边界，可选）。
 * 每次对话前注入工作区内容到 system prompt；工作区为空时注入 Bootstrap 引导（分步询问）。
 * 工作区路径必须与文件工具的 fileBase 一致，确保 write_file 写入的位置与 read 读取的位置相同。
 *
 * 参考：docs/OPENCLAW_ANALYSIS.md、docs/SMART_EXPERIENCE_PLAN.md
 */

import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** 工作区文件名 */
export const WORKSPACE_FILES = {
  IDENTITY: 'IDENTITY.md',
  USER: 'USER.md',
  SOUL: 'SOUL.md',
} as const;

/** 默认 fileBase（与 file.ts 的 getFileBasePath 一致） */
const DEFAULT_FILE_BASE = join(homedir(), '.crabcrush');

/**
 * 获取工作区路径（必须与 write_file 的 fileBase 一致，否则写入和读取会不一致）
 * @param fileBase 文件工具根目录，默认 ~/.crabcrush
 */
export function getWorkspacePath(fileBase?: string): string {
  const base = fileBase?.trim() || DEFAULT_FILE_BASE;
  return join(base, 'workspace');
}

/**
 * 确保工作区目录存在（首次启动时创建，避免 read 时目录不存在）
 */
export function ensureWorkspaceDir(workspacePath: string): void {
  mkdirSync(workspacePath, { recursive: true });
}

export interface WorkspaceContent {
  identity: string;
  user: string;
  soul: string;
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

  const [identity, user, soul] = await Promise.all([
    read(join(workspacePath, WORKSPACE_FILES.IDENTITY)),
    read(join(workspacePath, WORKSPACE_FILES.USER)),
    read(join(workspacePath, WORKSPACE_FILES.SOUL)),
  ]);

  return { identity, user, soul };
}

/**
 * 判断工作区是否为空（需引导用户填写）
 * 当 IDENTITY 和 USER 都为空或不存在时视为空
 */
export function isWorkspaceEmpty(content: WorkspaceContent): boolean {
  return !content.identity.trim() && !content.user.trim();
}

/**
 * Bootstrap 提示词 — 精简版：自然开场、一次一问、不填表
 * 与 BEHAVIOR_RULES 合并，避免重复
 */
const BOOTSTRAP_PROMPT = `
【人格引导】工作区未配置。自然开场如「嗨，刚上线。我是谁？你是谁？」一次只问 1 个问题，卡住可给建议。
收集顺序：USER.md（名字/称呼/时区/notes）→ IDENTITY.md（emoji/vibe/名字）→ SOUL.md（边界/偏好）。用 write_file 写入 workspace/ 下。
用户说「不用了」则停止，默认 USER「朋友」、IDENTITY「小螃蟹 🦀」。优先满足当前需求。
`;

/** 行为规则 — 仅在工作区已配置时注入（Bootstrap 已含规则） */
const BEHAVIOR_RULES = `
【行为规则】一次最多问 1 个问题；用户拒绝 → 停止；优先解决问题。
`;

/**
 * 组装完整 system prompt
 * @param basePrompt 配置中的 agent.systemPrompt
 * @param workspaceContent 工作区文件内容
 */
export function buildSystemPrompt(basePrompt: string, workspaceContent: WorkspaceContent): string {
  const parts: string[] = [basePrompt];

  // 若有工作区内容，注入
  if (workspaceContent.identity) {
    parts.push(`\n【你的身份】\n${workspaceContent.identity}`);
  }
  if (workspaceContent.user) {
    parts.push(`\n【用户信息】\n${workspaceContent.user}`);
  }
  if (workspaceContent.soul) {
    parts.push(`\n【性格边界】\n${workspaceContent.soul}`);
  }

  // 工作区为空：注入 Bootstrap（已含行为规则，不重复注入）
  if (isWorkspaceEmpty(workspaceContent)) {
    parts.push(BOOTSTRAP_PROMPT);
  } else {
    parts.push(BEHAVIOR_RULES);
  }

  return parts.join('\n').trim();
}
