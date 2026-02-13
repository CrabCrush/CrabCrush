import { z } from 'zod';

/**
 * 已知模型提供商的默认配置
 * 用户只需提供 apiKey，baseURL 自动填充
 */
export const KNOWN_PROVIDERS: Record<string, { baseURL: string; name: string }> = {
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    name: 'DeepSeek',
  },
  qwen: {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    name: '通义千问',
  },
  kimi: {
    baseURL: 'https://api.moonshot.cn/v1',
    name: 'Kimi',
  },
  glm: {
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    name: '智谱 GLM',
  },
  doubao: {
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    name: '豆包',
  },
};

// 模型提供商配置
const modelProviderSchema = z.object({
  baseURL: z.string().optional(),
  apiKey: z.string().min(1, 'API Key 不能为空'),
  defaultModel: z.string().optional(),
});

// 主配置
export const configSchema = z.object({
  port: z.number().int().min(1).max(65535).default(18790),
  bind: z.enum(['loopback', 'all']).default('loopback'),

  models: z.record(z.string(), modelProviderSchema).default({}),

  agent: z.object({
    model: z.string().default('deepseek-chat'),
    systemPrompt: z.string().default('你是 CrabCrush，一个友好的 AI 助手。请用中文回复。'),
    maxTokens: z.number().int().default(4096),
  }).default({
    model: 'deepseek-chat',
    systemPrompt: '你是 CrabCrush，一个友好的 AI 助手。请用中文回复。',
    maxTokens: 4096,
  }),
});

export type CrabCrushConfig = z.infer<typeof configSchema>;
export type ModelProviderConfig = z.infer<typeof modelProviderSchema>;
