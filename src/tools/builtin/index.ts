/**
 * 内置工具汇总
 */

import type { Tool } from '../types.js';
import { getCurrentTimeTool } from './time.js';

/** 所有内置工具 */
export const builtinTools: Tool[] = [
  getCurrentTimeTool,
];
