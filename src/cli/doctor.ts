/**
 * crabcrush doctor — 自检诊断
 * 检查运行环境、配置、网络连通性
 */

import { existsSync } from 'node:fs';
import { findConfigPath, loadConfig } from '../config/loader.js';
import { KNOWN_PROVIDERS } from '../config/schema.js';
import type { CrabCrushConfig } from '../config/schema.js';

interface CheckResult {
  name: string;
  ok: boolean;
  message: string;
}

export async function runDoctor(): Promise<void> {
  console.log('🦀 CrabCrush Doctor — 自检诊断\n');

  const results: CheckResult[] = [];

  // 1. Node.js 版本
  results.push(checkNodeVersion());

  // 2. 配置文件
  const configResult = checkConfigFile();
  results.push(configResult);

  // 3. 加载配置并检查模型
  let config: CrabCrushConfig | null = null;
  try {
    config = loadConfig();
  } catch {
    // 配置加载失败在 checkConfigFile 中已报告
  }

  if (config) {
    results.push(checkModels(config));
    results.push(checkPort(config));
    results.push(checkChannels(config));

    // 4. API 连通性测试（仅当有模型配置时）
    const apiResult = await checkApiConnectivity(config);
    if (apiResult) results.push(apiResult);
  }

  // 输出结果
  console.log('\n─── 诊断结果 ───\n');
  let hasError = false;
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`${icon} ${r.name}: ${r.message}`);
    if (!r.ok) hasError = true;
  }

  console.log('');
  if (hasError) {
    console.log('⚠️  存在问题，请根据上方提示修复后重新运行 crabcrush doctor\n');
  } else {
    console.log('🎉 所有检查通过！可以运行 crabcrush start 启动服务\n');
  }
}

function checkNodeVersion(): CheckResult {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0], 10);
  return {
    name: 'Node.js 版本',
    ok: major >= 20,
    message: major >= 20
      ? `v${version}（>= 20 ✓）`
      : `v${version}（需要 >= 20，请升级 Node.js）`,
  };
}

function checkConfigFile(): CheckResult {
  const configPath = findConfigPath();
  if (configPath && existsSync(configPath)) {
    return {
      name: '配置文件',
      ok: true,
      message: configPath,
    };
  }

  // 检查是否有环境变量配置
  const hasEnvKey = Object.keys(KNOWN_PROVIDERS).some(
    (id) => process.env[`CRABCRUSH_${id.toUpperCase()}_API_KEY`],
  );

  if (hasEnvKey) {
    return {
      name: '配置文件',
      ok: true,
      message: '未找到配置文件，但检测到环境变量配置',
    };
  }

  return {
    name: '配置文件',
    ok: false,
    message: '未找到 crabcrush.yaml，也没有 CRABCRUSH_*_API_KEY 环境变量。运行 crabcrush onboard 创建配置。',
  };
}

function checkModels(config: CrabCrushConfig): CheckResult {
  const entries = Object.entries(config.models);
  if (entries.length === 0) {
    return {
      name: '模型配置',
      ok: false,
      message: '未配置任何模型。请在 crabcrush.yaml 或环境变量中配置 API Key。',
    };
  }

  const details = entries.map(([id, cfg]) => {
    const name = KNOWN_PROVIDERS[id]?.name ?? id;
    const hasKey = cfg.apiKey && cfg.apiKey.length > 5;
    const keyPreview = hasKey ? `${cfg.apiKey.slice(0, 5)}...` : '(空)';
    return `${name}(${keyPreview})`;
  });

  return {
    name: '模型配置',
    ok: true,
    message: details.join(', '),
  };
}

function checkPort(config: CrabCrushConfig): CheckResult {
  return {
    name: '端口',
    ok: config.port > 0 && config.port <= 65535,
    message: `${config.port}`,
  };
}

function checkChannels(config: CrabCrushConfig): CheckResult {
  const active: string[] = [];

  // WebChat 始终可用
  active.push('WebChat');

  const dt = config.channels.dingtalk;
  if (dt.enabled && dt.clientId && dt.clientSecret) {
    active.push('钉钉');
  }

  return {
    name: '渠道',
    ok: true,
    message: active.join(', '),
  };
}

/**
 * 快速测试 API 连通性：向模型 API 发一个 models 列表请求
 */
async function checkApiConnectivity(config: CrabCrushConfig): Promise<CheckResult | null> {
  const entries = Object.entries(config.models);
  if (entries.length === 0) return null;

  // 测试第一个配置的提供商
  const [providerId, providerConfig] = entries[0];
  const baseURL = providerConfig.baseURL ?? KNOWN_PROVIDERS[providerId]?.baseURL;
  const providerName = KNOWN_PROVIDERS[providerId]?.name ?? providerId;

  if (!baseURL) {
    return {
      name: `API 连通性 (${providerName})`,
      ok: false,
      message: '缺少 baseURL',
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(`${baseURL}/models`, {
      headers: { 'Authorization': `Bearer ${providerConfig.apiKey}` },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      return {
        name: `API 连通性 (${providerName})`,
        ok: true,
        message: '连接正常',
      };
    }

    if (response.status === 401) {
      return {
        name: `API 连通性 (${providerName})`,
        ok: false,
        message: 'API Key 无效或已过期，请检查配置',
      };
    }

    // 有些 API 不支持 /models 端点但连接本身没问题
    return {
      name: `API 连通性 (${providerName})`,
      ok: true,
      message: `服务可达（HTTP ${response.status}）`,
    };
  } catch (err) {
    const message = err instanceof Error
      ? (err.name === 'AbortError' ? '连接超时（10秒）' : err.message)
      : '未知错误';

    return {
      name: `API 连通性 (${providerName})`,
      ok: false,
      message: `无法连接: ${message}`,
    };
  }
}
