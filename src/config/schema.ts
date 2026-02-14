import { z } from 'zod';

/**
 * 已知模型提供商的默认配置
 * 用户只需提供 apiKey，baseURL 自动填充
 */
export const KNOWN_PROVIDERS: Record<string, {
  baseURL: string;
  name: string;
  /** 模型名前缀，用于 agent.model 自动匹配提供商 */
  modelPrefixes?: string[];
}> = {
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    name: 'DeepSeek',
    modelPrefixes: ['deepseek'],
  },
  qwen: {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    name: '通义千问',
    modelPrefixes: ['qwen'],
  },
  kimi: {
    baseURL: 'https://api.moonshot.cn/v1',
    name: 'Kimi',
    modelPrefixes: ['moonshot'],
  },
  glm: {
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    name: '智谱 GLM',
    modelPrefixes: ['glm', 'chatglm'],
  },
  doubao: {
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    name: '豆包',
    modelPrefixes: ['doubao', 'ep-'],
  },
};

// 模型提供商配置
const modelProviderSchema = z.object({
  baseURL: z.string().optional(),
  apiKey: z.string().min(1, 'API Key 不能为空'),
  defaultModel: z.string().optional(),
});

// 渠道配置
const dingtalkChannelSchema = z.object({
  enabled: z.boolean().default(false),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

const channelsSchema = z.object({
  dingtalk: dingtalkChannelSchema.default({ enabled: false }),
}).default({
  dingtalk: { enabled: false },
});

// 认证配置
const authSchema = z.object({
  /** WebChat 访问令牌。不设则每次启动自动生成 */
  token: z.string().optional(),
}).default({});

// 主配置
export const configSchema = z.object({
  port: z.number().int().min(1).max(65535).default(18790),
  bind: z.enum(['loopback', 'all']).default('loopback'),

  auth: authSchema,

  models: z.record(z.string(), modelProviderSchema).default({}),

  agent: z.object({
    model: z.string().default('deepseek-chat'),
    fallbackModels: z.array(z.string()).default([]),
    systemPrompt: z.string().default('你是 CrabCrush，一个友好的 AI 助手。请用中文回复。'),
    maxTokens: z.number().int().default(4096),
    /** 发给 API 的最大消息条数（1 轮 = 2 条，默认 40 条 = 20 轮） */
    contextWindow: z.number().int().min(2).max(200).default(40),
  }).default({
    model: 'deepseek-chat',
    fallbackModels: [],
    systemPrompt: '你是 CrabCrush，一个友好的 AI 助手。请用中文回复。',
    maxTokens: 4096,
    contextWindow: 40,
  }),

  channels: channelsSchema,
});

export type CrabCrushConfig = z.infer<typeof configSchema>;
export type ModelProviderConfig = z.infer<typeof modelProviderSchema>;
export type DingTalkChannelConfig = z.infer<typeof dingtalkChannelSchema>;
