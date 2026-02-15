/**
 * 内置工具：网页搜索
 *
 * 背景：同 browse_url，模型不会上网。用户说"帮我搜一下 XX"时，需要工具打开搜索引擎、
 * 抓取结果页，再把结果喂给模型。
 *
 * 智能引擎选择（有代理优先 Google）：
 * - auto（默认）：先试 Google（5s），失败则 Bing，再失败则 Baidu
 * - 环境变量 CRABCRUSH_SEARCH_ENGINE=google|bing|baidu 可强制指定
 *
 * 权限：owner（操作本地浏览器，DEC-026）
 */

import { chromium } from 'playwright';
import type { Tool, ToolContext, ToolResult } from '../types.js';

const GOOGLE_TIMEOUT_MS = 5_000; // 有代理时很快，无代理会超时
const BING_BAIDU_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 10;

function encodeQuery(q: string): string {
  return encodeURIComponent(q.trim());
}

type SearchResult = { title: string; link: string; snippet: string };
type EngineId = 'google' | 'bing' | 'baidu';

interface EngineSelectors {
  container: string;
  title: string;
  link: string;
  snippet: string;
  /** 过滤：排除的 link 前缀（如 Google 内部链接） */
  excludeLinkPrefix?: string;
}

interface EngineConfig {
  url: (q: string) => string;
  selectors: EngineSelectors;
  fallbackSelector: string;
  label: string;
}

const ENGINES: Record<EngineId, EngineConfig> = {
  google: {
    url: (q) => `https://www.google.com/search?q=${encodeQuery(q)}`,
    selectors: {
      container: '#search .g, div[data-ved]',
      title: 'h3, .LC20lb, [role="heading"]',
      link: 'a[href^="http"]',
      snippet: '.VwiC3b, .IsZvec, .aCOpRe',
      excludeLinkPrefix: 'https://www.google.com/',
    },
    fallbackSelector: '#search, #rso, main',
    label: 'Google',
  },
  bing: {
    url: (q) => `https://www.bing.com/search?q=${encodeQuery(q)}`,
    selectors: {
      container: '.b_algo, li.b_algo',
      title: 'h2 a, .b_tpcn a',
      link: 'h2 a, a[href^="http"]',
      snippet: '.b_caption p, .b_snippet',
    },
    fallbackSelector: '#b_results, main, .b_content',
    label: 'Bing',
  },
  baidu: {
    url: (q) => `https://www.baidu.com/s?wd=${encodeQuery(q)}`,
    selectors: {
      container: '#content_left .c-container, #content_left .result',
      title: '.c-title a, .t a, h3 a',
      link: '.c-title a, .t a, h3 a',
      snippet: '.c-abstract, .c-span18',
    },
    fallbackSelector: '#content_left, main',
    label: '百度',
  },
};


function getEngineOrder(): EngineId[] {
  const env = process.env.CRABCRUSH_SEARCH_ENGINE?.toLowerCase();
  if (env === 'google' || env === 'bing' || env === 'baidu') {
    return [env];
  }
  return ['google', 'bing', 'baidu'];
}

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>;

async function tryEngine(
  page: Page,
  engineId: EngineId,
  query: string,
): Promise<{ success: boolean; results?: SearchResult[]; fallback?: string; label: string }> {
  const cfg = ENGINES[engineId];
  const timeout = engineId === 'google' ? GOOGLE_TIMEOUT_MS : BING_BAIDU_TIMEOUT_MS;

  try {
    await page.goto(cfg.url(query), {
      waitUntil: 'domcontentloaded',
      timeout,
    });

    const results = await page.evaluate(
      (arg: { sel: EngineSelectors; max: number }) => {
        const { sel, max } = arg;
        const items: SearchResult[] = [];
        const containers = document.querySelectorAll(sel.container);
        for (let i = 0; i < Math.min(containers.length, max); i++) {
          const el = containers[i];
          const titleEl = el.querySelector(sel.title);
          const linkEl = el.querySelector(sel.link);
          const snippetEl = el.querySelector(sel.snippet);
          const title = titleEl?.textContent?.trim() || '';
          const link = (linkEl && 'href' in linkEl ? (linkEl as HTMLAnchorElement).href : '') || '';
          const snippet = snippetEl?.textContent?.trim() || '';
          if (sel.excludeLinkPrefix && link.startsWith(sel.excludeLinkPrefix)) continue;
          if (title) items.push({ title, link, snippet });
        }
        return items;
      },
      { sel: cfg.selectors, max: MAX_RESULTS },
    );

    if (results.length > 0) {
      return { success: true, results, label: cfg.label };
    }

    const fallback = await page.evaluate((sel) => {
      const main = document.querySelector(sel) || document.body;
      return (main as HTMLElement).innerText?.slice(0, 6000) || '';
    }, cfg.fallbackSelector);
    return {
      success: true,
      fallback: fallback.replace(/\s+/g, ' ').trim(),
      label: cfg.label,
    };
  } catch {
    return { success: false, label: cfg.label };
  }
}

export const searchWebTool: Tool = {
  definition: {
    name: 'search_web',
    description:
      '在搜索引擎中搜索关键词并返回结果。支持 Google/Bing/百度，有代理时优先 Google。当用户说"帮我搜一下 XX"、"百度一下 XXX"、"查一下 XX"时调用。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词',
        },
      },
      required: ['query'],
    },
  },
  permission: 'owner',
  confirmRequired: false,

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const query = args.query as string;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return { success: false, content: '请提供有效的 query 参数' };
    }

    const order = getEngineOrder();
    let browser;

    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();

      for (const engineId of order) {
        const out = await tryEngine(page, engineId, query);
        if (!out.success) continue;

        if (out.results && out.results.length > 0) {
          const formatted = out.results
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet || ''}`)
            .join('\n\n');
          return {
            success: true,
            content: `【${out.label}搜索：${query}】\n\n${formatted}`,
          };
        }

        if (out.fallback) {
          return {
            success: true,
            content: `【${out.label}搜索：${query}】\n\n（未能解析结构化结果，以下是页面摘要）\n\n${out.fallback || '（无结果）'}`,
          };
        }
      }

      return {
        success: false,
        content: `所有搜索引擎均不可用（已尝试：${order.join('、')}）。若使用代理，请确保可访问 Google；否则请检查网络。`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Timeout') || msg.includes('timeout')) {
        return { success: false, content: `搜索超时，请检查网络` };
      }
      if (msg.includes('net::') || msg.includes('NS_')) {
        return { success: false, content: `无法访问搜索引擎：${msg}` };
      }
      if (msg.includes('Executable') || msg.includes('browserType') || msg.includes('playwright')) {
        return {
          success: false,
          content: 'Chromium 未安装。请先执行：npx playwright install chromium',
        };
      }
      return { success: false, content: `搜索失败：${msg}` };
    } finally {
      await browser?.close();
    }
  },
};
