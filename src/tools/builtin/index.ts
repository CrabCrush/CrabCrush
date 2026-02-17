/**
 * 内置工具汇总
 */

import type { Tool } from '../types.js';
import type { CrabCrushConfig } from '../../config/schema.js';
import { getCurrentTimeTool } from './time.js';
import { browseUrlTool } from './browser.js';
import { searchWebTool } from './search.js';
import { createReadFileTool } from './file.js';

/** 获取所有内置工具（需传入配置以支持 tools.fileBase） */
export function getBuiltinTools(config?: CrabCrushConfig): Tool[] {
  return [
    getCurrentTimeTool,
    browseUrlTool,
    searchWebTool,
    createReadFileTool(config?.tools),
  ];
}
