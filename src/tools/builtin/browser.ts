/**
 * 内置工具：抓取网页内容
 *
 * 背景：AI 模型不会上网，没有浏览器、没有网络访问能力。它只能处理你发给它的文本。
 * 当用户问"帮我总结这个链接"时，模型无法自己打开 URL，必须通过工具抓取内容再喂给它。
 *
 * 用途：让 AI 能"看"网页，回答"这个页面讲了什么"、"帮我总结这个链接"等问题
 * 权限：owner（操作本地浏览器，消耗资源，DEC-026）
 */

import { chromium } from 'playwright';
import type { Tool, ToolContext, ToolResult } from '../types.js';

const PAGE_LOAD_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CHARS = 8000; // 避免返回过多内容给模型

export const browseUrlTool: Tool = {
  definition: {
    name: 'browse_url',
    description: '打开一个网页并获取其文本内容。当用户提供链接、询问网页内容、要求总结某页面时调用。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要访问的完整 URL，必须以 http:// 或 https:// 开头',
        },
        maxChars: {
          type: 'number',
          description: '返回内容的最大字符数，默认 8000',
          default: DEFAULT_MAX_CHARS,
        },
      },
      required: ['url'],
    },
  },
  permission: 'owner',
  confirmRequired: false,

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const url = args.url as string;
    const maxChars = (args.maxChars as number) || DEFAULT_MAX_CHARS;

    if (!url || typeof url !== 'string') {
      return { success: false, content: '请提供有效的 url 参数' };
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { success: false, content: 'URL 必须以 http:// 或 https:// 开头' };
    }

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_LOAD_TIMEOUT_MS,
      });

      // 获取页面标题和主体文本
      const title = await page.title();
      const bodyText = await page.evaluate(() => {
        // 移除 script、style 等，只取可见文本
        const clone = document.body.cloneNode(true) as HTMLElement;
        for (const el of clone.querySelectorAll('script, style, noscript')) {
          el.remove();
        }
        return clone.innerText || '';
      });

      // 清理空白字符，截断
      const cleaned = bodyText
        .replace(/\s+/g, ' ')
        .trim();

      const truncated = cleaned.length > maxChars
        ? cleaned.slice(0, maxChars) + `\n\n...（已截断，原文共 ${cleaned.length} 字符）`
        : cleaned;

      const summary = `【标题】${title}\n\n【正文】\n${truncated || '（无正文内容）'}`;

      return { success: true, content: summary };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Timeout') || msg.includes('timeout')) {
        return { success: false, content: `页面加载超时（${PAGE_LOAD_TIMEOUT_MS / 1000} 秒），请检查 URL 或网络` };
      }
      if (msg.includes('net::') || msg.includes('NS_')) {
        return { success: false, content: `无法访问该 URL：${msg}` };
      }
      if (msg.includes('Executable') || msg.includes('browserType') || msg.includes('playwright')) {
        return {
          success: false,
          content: 'Chromium 未安装。请先执行：npx playwright install chromium',
        };
      }
      return { success: false, content: `抓取失败：${msg}` };
    } finally {
      await browser?.close();
    }
  },
};
