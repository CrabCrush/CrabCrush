/**
 * 仅维护者使用：从 CDN 拉取 markdown-it、highlight.js 到 public/vendor/。
 * 普通用户无需运行——仓库已包含 public/vendor/，克隆即用。
 *
 * 何时用：要升级这两个库的版本时，改下面 MD_URLS / HL_URLS / HL_CSS_URLS 的版本号，
 * 在有网络（或设好 HTTPS_PROXY）下执行 node scripts/copy-vendor.js，再提交 public/vendor/。
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const vendorDir = join(root, 'public', 'vendor');

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

async function fetchToFile(url, filepath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} => ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  ensureDir(dirname(filepath));
  writeFileSync(filepath, buf);
}

// 1. markdown-it：从 CDN 下载
const MD_URLS = [
  'https://cdn.jsdelivr.net/npm/markdown-it@14/dist/markdown-it.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/markdown-it/14.1.0/markdown-it.min.js',
  'https://cdn.bootcdn.net/ajax/libs/markdown-it/14.1.0/markdown-it.min.js',
];

// 2. highlight.js
const HL_URLS = [
  'https://cdn.jsdelivr.net/npm/highlight.js@11/highlight.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  'https://cdn.bootcdn.net/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  'https://unpkg.npmmirror.com/highlight.js@11.11.1/build/highlight.min.js',
];
const HL_CSS_URLS = [
  'https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css',
  'https://cdn.bootcdn.net/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css',
];

async function tryMarkdownIt() {
  for (const url of MD_URLS) {
    try {
      await fetchToFile(url, join(vendorDir, 'markdown-it.min.js'));
      console.log('OK: markdown-it.min.js (from', url.slice(0, 50) + '...)');
      return;
    } catch (e) {
      continue;
    }
  }
  console.warn('WARN: markdown-it.min.js download failed (tried multiple CDNs).');
}

async function tryHighlight() {
  for (const url of HL_URLS) {
    try {
      await fetchToFile(url, join(vendorDir, 'highlight.min.js'));
      console.log('OK: highlight.min.js (from', url.slice(0, 50) + '...)');
      for (const cssUrl of HL_CSS_URLS) {
        try {
          await fetchToFile(cssUrl, join(vendorDir, 'github-dark.min.css'));
          console.log('OK: github-dark.min.css');
          break;
        } catch (e2) {
          continue;
        }
      }
      return;
    } catch (e) {
      continue;
    }
  }
  console.warn('WARN: highlight.min.js download failed (tried multiple CDNs).');
  console.warn('      若使用代理，请先设置环境变量再运行: set HTTPS_PROXY=http://127.0.0.1:7890');
}

try {
  await tryMarkdownIt();
  await tryHighlight();
} catch (e) {
  console.warn('WARN:', e.message);
}
