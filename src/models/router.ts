/**
 * 模型路由器
 * - 根据 agent.model 自动匹配正确的提供商
 * - 支持显式格式 "providerId/modelName"（如 "qwen/qwen-max"）
 * - 支持自动检测（如 "qwen-max" → qwen 提供商）
 * - Failover：主模型失败时自动切换备选
 */

import { OpenAICompatibleProvider } from './provider.js';
import type { ChatMessage, ChatChunk, ChatOptions } from './provider.js';
import { KNOWN_PROVIDERS } from '../config/schema.js';

/** 解析后的模型规格 */
interface ModelSpec {
  providerId: string;
  modelName: string;
}

export class ModelRouter {
  private providers: Map<string, OpenAICompatibleProvider>;
  private primaryModel: ModelSpec;
  private fallbackModels: ModelSpec[];

  constructor(
    providers: Map<string, OpenAICompatibleProvider>,
    primaryModel: string,
    fallbackModels: string[] = [],
  ) {
    this.providers = providers;
    this.primaryModel = this.parseModelSpec(primaryModel);
    this.fallbackModels = fallbackModels.map((m) => this.parseModelSpec(m));
  }

  /**
   * 解析模型标识
   * - "qwen/qwen-max" → { providerId: "qwen", modelName: "qwen-max" }
   * - "qwen-max" → 自动匹配到 qwen 提供商
   * - "deepseek-chat" → 自动匹配到 deepseek 提供商
   */
  private parseModelSpec(spec: string): ModelSpec {
    // 显式格式：providerId/modelName
    if (spec.includes('/')) {
      const slashIndex = spec.indexOf('/');
      const providerId = spec.slice(0, slashIndex);
      const modelName = spec.slice(slashIndex + 1);

      if (!this.providers.has(providerId)) {
        throw new Error(
          `模型 "${spec}" 指定的提供商 "${providerId}" 未配置。` +
          `已配置的提供商：${[...this.providers.keys()].join(', ')}`,
        );
      }

      return { providerId, modelName };
    }

    // 自动检测：按模型名前缀匹配已知提供商
    for (const [providerId, info] of Object.entries(KNOWN_PROVIDERS)) {
      const prefixes = info.modelPrefixes ?? [];
      if (prefixes.some((prefix) => spec.startsWith(prefix))) {
        if (this.providers.has(providerId)) {
          return { providerId, modelName: spec };
        }
      }
    }

    // 兜底：如果只配了一个提供商，就用它
    if (this.providers.size === 1) {
      const providerId = [...this.providers.keys()][0];
      return { providerId, modelName: spec };
    }

    // 多个提供商但无法自动匹配 → 报错
    throw new Error(
      `无法为模型 "${spec}" 自动匹配提供商。\n` +
      `请使用显式格式：providerId/modelName（如 "qwen/qwen-max"）\n` +
      `已配置的提供商：${[...this.providers.keys()].join(', ')}`,
    );
  }

  /**
   * 流式对话，带 Failover
   * - 4xx 错误（API Key 问题、余额不足）不触发 Failover
   * - 5xx / 超时 / 网络错误 → 自动切换到下一个备选模型
   */
  async *chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<ChatChunk> {
    const models = [this.primaryModel, ...this.fallbackModels];

    for (let i = 0; i < models.length; i++) {
      const { providerId, modelName } = models[i];
      const provider = this.providers.get(providerId);

      if (!provider) {
        console.warn(`[ModelRouter] 提供商 "${providerId}" 未配置，跳过`);
        continue;
      }

      try {
        const chatOptions: ChatOptions = { ...options, model: modelName };
        yield* provider.chat(messages, chatOptions);
        return; // 成功，不需要 failover
      } catch (err) {
        const isLast = i === models.length - 1;

        // 4xx 错误（客户端配置问题）不 failover，直接抛
        if (err instanceof Error && this.isClientError(err)) {
          throw err;
        }

        if (isLast) {
          throw err; // 没有更多备选了
        }

        // 记录并切换到下一个
        const next = models[i + 1];
        const providerName = KNOWN_PROVIDERS[providerId]?.name ?? providerId;
        const nextName = KNOWN_PROVIDERS[next.providerId]?.name ?? next.providerId;
        console.warn(
          `[ModelRouter] ${providerName}(${modelName}) 失败: ${err instanceof Error ? err.message : err}`,
        );
        console.warn(
          `[ModelRouter] 自动切换到备选: ${nextName}(${next.modelName})`,
        );
      }
    }
  }

  /** 4xx 类错误：API Key / 余额 / 限流，不应该 failover */
  private isClientError(err: Error): boolean {
    return (
      err.message.includes('API Key') ||
      err.message.includes('余额不足') ||
      err.message.includes('已被限流')
    );
  }

  /** 主模型信息（用于启动日志） */
  get primaryInfo(): { providerId: string; modelName: string; providerName: string } {
    const { providerId, modelName } = this.primaryModel;
    const providerName = KNOWN_PROVIDERS[providerId]?.name ?? providerId;
    return { providerId, modelName, providerName };
  }

  /** 是否配置了 Failover */
  get hasFallback(): boolean {
    return this.fallbackModels.length > 0;
  }

  /** 所有模型链（主 + 备选），用于日志 */
  get modelChain(): string[] {
    return [this.primaryModel, ...this.fallbackModels].map(
      (m) => `${KNOWN_PROVIDERS[m.providerId]?.name ?? m.providerId}(${m.modelName})`,
    );
  }
}
