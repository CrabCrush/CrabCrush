import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createDefaultPromptRegistry } from './defaults.js';
import type { PromptRegistry, ToolPromptMeta } from './types.js';

export interface PromptLoadOptions {
  promptsDir?: string;
  defaultSystemBase?: string;
}

function clonePromptMeta(meta: ToolPromptMeta): ToolPromptMeta {
  return {
    description: meta.description,
    parameters: { ...meta.parameters },
  };
}

function clonePromptRegistry(registry: PromptRegistry): PromptRegistry {
  return {
    system: { ...registry.system },
    workspace: { ...registry.workspace },
    runtime: { ...registry.runtime },
    tools: {
      time: {
        get_current_time: clonePromptMeta(registry.tools.time.get_current_time),
      },
      browser: {
        browse_url: clonePromptMeta(registry.tools.browser.browse_url),
      },
      search: {
        search_web: clonePromptMeta(registry.tools.search.search_web),
      },
      file: {
        read_file: clonePromptMeta(registry.tools.file.read_file),
        list_files: clonePromptMeta(registry.tools.file.list_files),
        write_file: clonePromptMeta(registry.tools.file.write_file),
      },
    },
  };
}

function readTextIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf-8').trim();
  return content || null;
}

function mergeToolMeta(target: ToolPromptMeta, input: unknown): void {
  if (!input || typeof input !== 'object') return;
  const record = input as Record<string, unknown>;
  if (typeof record.description === 'string' && record.description.trim()) {
    target.description = record.description.trim();
  }
  const params = record.parameters;
  if (!params || typeof params !== 'object') return;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.trim()) {
      target.parameters[key] = value.trim();
    }
  }
}

export function resolvePromptsDir(explicitDir?: string): string | null {
  const explicit = explicitDir?.trim();
  if (explicit) {
    return existsSync(explicit) ? explicit : null;
  }

  const envDir = process.env.CRABCRUSH_PROMPTS_DIR?.trim();
  if (envDir) {
    return existsSync(envDir) ? envDir : null;
  }

  const candidates = [
    join(process.cwd(), 'prompts'),
    join(homedir(), '.crabcrush', 'prompts'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function loadToolJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Prompt JSON 解析失败：${filePath}\n${message}`);
  }
}

export function loadPromptRegistry(options: PromptLoadOptions = {}): PromptRegistry {
  const registry = clonePromptRegistry(createDefaultPromptRegistry(options.defaultSystemBase));
  const promptsDir = resolvePromptsDir(options.promptsDir);
  if (!promptsDir) return registry;

  const textOverrides: Array<[
    keyof PromptRegistry['system']
    | 'bootstrap'
    | keyof PromptRegistry['runtime'],
    string,
  ]> = [
    ['base', join(promptsDir, 'system', 'base.md')],
    ['behavior', join(promptsDir, 'system', 'behavior.md')],
    ['fileToolRules', join(promptsDir, 'system', 'file-tool-rules.md')],
    ['workspacePathRules', join(promptsDir, 'system', 'workspace-path-rules.md')],
    ['bootstrap', join(promptsDir, 'workspace', 'bootstrap.md')],
    ['fileToolEnforcement', join(promptsDir, 'runtime', 'file-tool-enforcement.md')],
    ['fileToolRequiredMessage', join(promptsDir, 'runtime', 'file-tool-required-message.md')],
    ['adviceOnlyDegrade', join(promptsDir, 'runtime', 'advice-only-degrade.md')],
    ['planApprovalMessage', join(promptsDir, 'runtime', 'plan-approval-message.md')],
    ['planSummarySingle', join(promptsDir, 'runtime', 'plan-summary-single.md')],
    ['planSummaryMultiple', join(promptsDir, 'runtime', 'plan-summary-multiple.md')],
  ];

  for (const [key, filePath] of textOverrides) {
    const content = readTextIfExists(filePath);
    if (!content) continue;
    if (key === 'bootstrap') {
      registry.workspace.bootstrap = content;
      continue;
    }
    if (key in registry.runtime) {
      registry.runtime[key as keyof PromptRegistry['runtime']] = content as never;
      continue;
    }
    registry.system[key as keyof PromptRegistry['system']] = content as never;
  }

  const timeToolPrompt = loadToolJson(join(promptsDir, 'tools', 'time.json'));
  if (timeToolPrompt) mergeToolMeta(registry.tools.time.get_current_time, timeToolPrompt.get_current_time);

  const browserToolPrompt = loadToolJson(join(promptsDir, 'tools', 'browser.json'));
  if (browserToolPrompt) mergeToolMeta(registry.tools.browser.browse_url, browserToolPrompt.browse_url);

  const searchToolPrompt = loadToolJson(join(promptsDir, 'tools', 'search.json'));
  if (searchToolPrompt) mergeToolMeta(registry.tools.search.search_web, searchToolPrompt.search_web);

  const fileToolPrompt = loadToolJson(join(promptsDir, 'tools', 'file.json'));
  if (fileToolPrompt) {
    mergeToolMeta(registry.tools.file.read_file, fileToolPrompt.read_file);
    mergeToolMeta(registry.tools.file.list_files, fileToolPrompt.list_files);
    mergeToolMeta(registry.tools.file.write_file, fileToolPrompt.write_file);
  }

  return registry;
}
