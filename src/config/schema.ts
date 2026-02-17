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
  /** 调试模式：打印发给模型的上下文摘要等详细日志 */
  debug: z.boolean().default(false),

  auth: authSchema,

  models: z.record(z.string(), modelProviderSchema).default({}),

  agent: z.object({
    model: z.string().default('deepseek-chat'),
    fallbackModels: z.array(z.string()).default([]),
    systemPrompt: z.string().default(
      '你是 CrabCrush，一个友好的 AI 助手。请用中文回复。\n' +
      '调用工具后，必须用自然语言总结工具结果并给出建议，不要只让用户去调用另一个工具。例如 list_files 找到文件后，应简要列出关键文件并询问用户想查看哪个，而不是只说「用 read_file 读取」。',
    ),
    maxTokens: z.number().int().default(4096),
    /** 发给 API 的最大消息条数（1 轮 = 2 条，默认 40 条 = 20 轮） */
    contextWindow: z.number().int().min(2).max(200).default(40),
  }).default({
    model: 'deepseek-chat',
    fallbackModels: [],
    systemPrompt:
      '你是 CrabCrush，一个友好的 AI 助手。请用中文回复。\n' +
      '调用工具后，必须用自然语言总结工具结果并给出建议，不要只让用户去调用另一个工具。例如 list_files 找到文件后，应简要列出关键文件并询问用户想查看哪个，而不是只说「用 read_file 读取」。',
    maxTokens: 4096,
    contextWindow: 40,
  }),

  /** Owner 用户 ID（只有 owner 能触发本地操作类工具，详见 DEC-026） */
  ownerIds: z.array(z.string()).default([]),

  /** 工具相关配置 */
  tools: z.object({
    /** read_file 可读取的根目录，默认 ~/.crabcrush。环境变量 CRABCRUSH_FILE_BASE 优先 */
    fileBase: z.string().optional(),
  }).optional(),

  channels: channelsSchema,
});

export type CrabCrushConfig = z.infer<typeof configSchema>;
export type ModelProviderConfig = z.infer<typeof modelProviderSchema>;
export type DingTalkChannelConfig = z.infer<typeof dingtalkChannelSchema>;
