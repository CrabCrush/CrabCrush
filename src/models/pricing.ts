/**
 * 模型定价数据（单位：人民币/百万 tokens）
 * 价格会变动，这里提供参考值，用户也可以不关心
 */

export interface ModelPricing {
  /** 输入价格（元/百万 tokens） */
  inputPerMillion: number;
  /** 输出价格（元/百万 tokens） */
  outputPerMillion: number;
}

/**
 * 已知模型的参考定价
 * 数据来源：各厂商官网（2026-02 参考价格，可能随时调整）
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // DeepSeek
  'deepseek-chat': { inputPerMillion: 1, outputPerMillion: 2 },
  'deepseek-reasoner': { inputPerMillion: 4, outputPerMillion: 16 },

  // 通义千问
  'qwen-max': { inputPerMillion: 20, outputPerMillion: 60 },
  'qwen-plus': { inputPerMillion: 0.8, outputPerMillion: 2 },
  'qwen-turbo': { inputPerMillion: 0.3, outputPerMillion: 0.6 },
  'qwen-long': { inputPerMillion: 0.5, outputPerMillion: 2 },

  // Kimi (Moonshot)
  'moonshot-v1-8k': { inputPerMillion: 12, outputPerMillion: 12 },
  'moonshot-v1-32k': { inputPerMillion: 24, outputPerMillion: 24 },
  'moonshot-v1-128k': { inputPerMillion: 60, outputPerMillion: 60 },

  // 智谱 GLM
  'glm-4': { inputPerMillion: 100, outputPerMillion: 100 },
  'glm-4-plus': { inputPerMillion: 50, outputPerMillion: 50 },
  'glm-4-flash': { inputPerMillion: 0, outputPerMillion: 0.1 },

  // 豆包 — 定价按推理接入点计费，这里放一个参考值
  // 用户使用自定义 endpoint ID 时无法自动匹配
};

/**
 * 估算本次对话费用
 * @returns 费用信息，如果没有该模型的定价数据则返回 null
 */
export function estimateCost(
  modelName: string,
  promptTokens: number,
  completionTokens: number,
): { cost: number; formatted: string } | null {
  const pricing = MODEL_PRICING[modelName];
  if (!pricing) return null;

  const cost =
    (promptTokens / 1_000_000) * pricing.inputPerMillion +
    (completionTokens / 1_000_000) * pricing.outputPerMillion;

  // 格式化：小于 0.01 元显示 4 位小数，否则 2 位
  const formatted = cost < 0.01
    ? `¥${cost.toFixed(4)}`
    : `¥${cost.toFixed(2)}`;

  return { cost, formatted };
}
