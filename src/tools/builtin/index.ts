/**
 * 内置工具汇总
 */

import type { Tool } from '../types.js';
import type { CrabCrushConfig } from '../../config/schema.js';
import type { PromptRegistry } from '../../prompts/types.js';
import { createGetCurrentTimeTool } from './time.js';
import { createBrowseUrlTool } from './browser.js';
import { createSearchWebTool } from './search.js';
import { createReadFileTool, createListFilesTool, createWriteFileTool } from './file.js';

/** 获取所有内置工具（需传入配置以支持 tools.fileBase / prompts） */
export function getBuiltinTools(config?: CrabCrushConfig, prompts?: PromptRegistry): Tool[] {
  return [
    createGetCurrentTimeTool(prompts),
    createBrowseUrlTool(prompts),
    createSearchWebTool(prompts),
    createReadFileTool(config?.tools, prompts),
    createListFilesTool(config?.tools, prompts),
    createWriteFileTool(config?.tools, prompts),
  ];
}
