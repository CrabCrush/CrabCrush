import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { configSchema, KNOWN_PROVIDERS, type CrabCrushConfig } from './schema.js';

/**
 * 按优先级查找配置文件
 * 1. 当前目录 crabcrush.yaml
 * 2. ~/.crabcrush/config/crabcrush.yaml
 */
export function findConfigPath(): string | null {
  const candidates = [
    join(process.cwd(), 'crabcrush.yaml'),
    join(homedir(), '.crabcrush', 'config', 'crabcrush.yaml'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * 加载并校验配置
 * - 读取 YAML 配置文件
 * - 合并环境变量（CRABCRUSH_<PROVIDER>_API_KEY）
 * - 补全已知提供商的 baseURL
 * - 用 Zod 校验
 */
export function loadConfig(configPath?: string): CrabCrushConfig {
  // 用户明确指定了配置路径，但文件不存在 → 报错
  if (configPath && !existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}`);
  }

  const path = configPath ?? findConfigPath();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawConfig: Record<string, any> = {};

  if (path && existsSync(path)) {
    const content = readFileSync(path, 'utf-8');
    rawConfig = (parseYaml(content) as Record<string, unknown>) ?? {};
  }

  // 环境变量覆盖端口
  if (process.env.CRABCRUSH_PORT) {
    rawConfig.port = parseInt(process.env.CRABCRUSH_PORT, 10);
  }

  // 初始化 models（如果没有）
  if (!rawConfig.models || typeof rawConfig.models !== 'object') {
    rawConfig.models = {};
  }

  const models = rawConfig.models as Record<string, Record<string, unknown>>;

  // 环境变量注入 API Key: CRABCRUSH_DEEPSEEK_API_KEY, CRABCRUSH_QWEN_API_KEY, ...
  for (const providerId of Object.keys(KNOWN_PROVIDERS)) {
    const envKey = `CRABCRUSH_${providerId.toUpperCase()}_API_KEY`;
    const envValue = process.env[envKey];
    if (envValue) {
      if (!models[providerId]) {
        models[providerId] = {};
      }
      // 环境变量优先级高于配置文件
      models[providerId].apiKey = envValue;
    }
  }

  // 补全已知提供商的 baseURL
  for (const [providerId, config] of Object.entries(models)) {
    if (!config.baseURL && KNOWN_PROVIDERS[providerId]) {
      config.baseURL = KNOWN_PROVIDERS[providerId].baseURL;
    }
  }

  // 工具配置：环境变量 CRABCRUSH_FILE_BASE 优先于 YAML
  if (process.env.CRABCRUSH_FILE_BASE) {
    if (!rawConfig.tools) rawConfig.tools = {};
    rawConfig.tools.fileBase = process.env.CRABCRUSH_FILE_BASE;
  }

  // 钉钉渠道环境变量
  if (process.env.CRABCRUSH_DINGTALK_CLIENT_ID || process.env.CRABCRUSH_DINGTALK_CLIENT_SECRET) {
    if (!rawConfig.channels) rawConfig.channels = {};
    if (!rawConfig.channels.dingtalk) rawConfig.channels.dingtalk = {};
    const dt = rawConfig.channels.dingtalk;
    if (process.env.CRABCRUSH_DINGTALK_CLIENT_ID) {
      dt.clientId = process.env.CRABCRUSH_DINGTALK_CLIENT_ID;
    }
    if (process.env.CRABCRUSH_DINGTALK_CLIENT_SECRET) {
      dt.clientSecret = process.env.CRABCRUSH_DINGTALK_CLIENT_SECRET;
    }
    if (dt.clientId && dt.clientSecret) {
      dt.enabled = true;
    }
  }

  return configSchema.parse(rawConfig);
}
