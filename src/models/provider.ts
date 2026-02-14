/**
 * OpenAI 兼容模型适配器
 * 覆盖 DeepSeek、通义千问、Kimi、智谱 GLM、豆包等国产模型（详见 DEC-009）
 *
 * Phase 2a.2: 新增 Function Calling 支持
 */

import type { ToolDefinition } from '../tools/types.js';

// ── 消息类型 ──

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 消息中的工具调用请求 */
  tool_calls?: ToolCall[];
  /** tool 消息：对应的 tool_call ID */
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// ── 流式 chunk ──

export interface ChatChunk {
  content: string;
  done: boolean;
  /** 实际使用的模型名（仅在 done=true 的最终 chunk 中） */
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 模型请求的工具调用（在流结束时汇总） */
  toolCalls?: ToolCall[];
}

// ── 选项 ──

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** 可用的工具列表（传给模型 API 的 tools 参数） */
  tools?: ToolDefinition[];
}

/** 请求超时时间（毫秒） */
const REQUEST_TIMEOUT_MS = 30_000;
/** 超时后重试次数 */
const MAX_RETRIES = 1;

export class OpenAICompatibleProvider {
  constructor(
    public readonly id: string,
    private readonly baseURL: string,
    private readonly apiKey: string,
    private readonly defaultModel: string,
  ) {}

  /**
   * 流式对话
   * - 支持 AbortSignal（用于中断生成）
   * - 自动超时（30s）
   * - 失败自动重试 1 次（仅 5xx / 网络错误）
   * - 支持 Function Calling（传入 tools 参数）
   */
  async *chat(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const model = options.model ?? this.defaultModel;
    const url = `${this.baseURL}/chat/completions`;

    // 构建请求体
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: Record<string, any> = {
      model,
      messages: messages.map(m => this.serializeMessage(m)),
      stream: true,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    };

    // 如果有工具定义，加入 tools 参数
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const body = JSON.stringify(requestBody);

    // 带超时和重试的 fetch
    const response = await this.fetchWithRetry(url, body, options.signal);

    if (!response.body) {
      throw new Error('模型 API 返回空响应');
    }

    // 解析 SSE 流
    yield* this.parseSSEStream(response.body, model, options.signal);
  }

  /**
   * 序列化消息为 OpenAI API 格式
   */
  private serializeMessage(msg: ChatMessage): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {
      role: msg.role,
      content: msg.content,
    };

    // assistant 消息的 tool_calls
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      result.tool_calls = msg.tool_calls;
    }

    // tool 消息的 tool_call_id
    if (msg.tool_call_id) {
      result.tool_call_id = msg.tool_call_id;
    }

    return result;
  }

  /**
   * 带超时和重试的 fetch
   */
  private async fetchWithRetry(
    url: string,
    body: string,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const onExternalAbort = () => controller.abort();
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', onExternalAbort);

        if (response.ok) return response;

        // 4xx — 客户端问题，不重试
        if (response.status < 500) {
          const errorText = await response.text();
          const msg = this.formatApiError(response.status, errorText);
          throw new Error(msg);
        }

        // 5xx — 服务端问题，可重试
        const errorText = await response.text();
        lastError = new Error(
          `模型 API 服务端错误 (${response.status}): ${errorText.slice(0, 200)}`,
        );
      } catch (err) {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', onExternalAbort);

        if (err instanceof Error) {
          if (externalSignal?.aborted) {
            throw new Error('生成已中断');
          }
          if (err.name === 'AbortError') {
            lastError = new Error('模型响应超时（30秒无响应）');
          } else {
            lastError = err;
          }
        } else {
          lastError = new Error(String(err));
        }
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    throw lastError ?? new Error('模型调用失败');
  }

  /**
   * 解析 SSE 流，逐块 yield ChatChunk
   * 支持 tool_calls 的增量拼接
   */
  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
    model: string,
    signal?: AbortSignal,
  ): AsyncIterable<ChatChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // 累积 tool_calls（流式中分多个 chunk 传来）
    const pendingToolCalls = new Map<number, {
      id: string;
      name: string;
      arguments: string;
    }>();

    try {
      while (true) {
        if (signal?.aborted) {
          yield { content: '', done: true, model };
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            // 流结束，如果有累积的 tool_calls，在最终 chunk 中返回
            const toolCalls = this.finalizePendingToolCalls(pendingToolCalls);
            yield { content: '', done: true, model, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
            return;
          }

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const json = JSON.parse(data) as any;
            const choice = json.choices?.[0];
            const delta = choice?.delta;

            // 文本内容
            if (delta?.content) {
              yield { content: delta.content, done: false };
            }

            // 工具调用（增量拼接）
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!pendingToolCalls.has(idx)) {
                  pendingToolCalls.set(idx, {
                    id: tc.id ?? '',
                    name: tc.function?.name ?? '',
                    arguments: '',
                  });
                }
                const pending = pendingToolCalls.get(idx)!;
                if (tc.id) pending.id = tc.id;
                if (tc.function?.name) pending.name = tc.function.name;
                if (tc.function?.arguments) pending.arguments += tc.function.arguments;
              }
            }

            // 部分模型在最后一个 chunk 返回 usage
            if (json.usage) {
              const toolCalls = this.finalizePendingToolCalls(pendingToolCalls);
              yield {
                content: '',
                done: true,
                model,
                usage: {
                  promptTokens: json.usage.prompt_tokens,
                  completionTokens: json.usage.completion_tokens,
                  totalTokens: json.usage.total_tokens,
                },
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              };
              return;
            }
          } catch {
            // 跳过格式不正确的 SSE 事件
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls = this.finalizePendingToolCalls(pendingToolCalls);
    yield { content: '', done: true, model, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  /**
   * 将累积的 tool_calls 转为最终格式
   */
  private finalizePendingToolCalls(
    pending: Map<number, { id: string; name: string; arguments: string }>,
  ): ToolCall[] {
    if (pending.size === 0) return [];
    const result: ToolCall[] = [];
    for (const [, tc] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
      result.push({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      });
    }
    return result;
  }

  /**
   * 格式化 API 错误信息
   */
  private formatApiError(status: number, body: string): string {
    if (status === 401) {
      return `API Key 无效或已过期。请检查 ${this.id} 的 API Key 配置。`;
    }
    if (status === 429) {
      return '请求过于频繁，已被限流。请稍后再试。';
    }
    if (status === 402 || body.includes('insufficient')) {
      return `${this.id} 账户余额不足。请充值后再试。`;
    }
    return `模型 API 调用失败 (${status}): ${body.slice(0, 200)}`;
  }
}
