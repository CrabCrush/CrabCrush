/**
 * OpenAI 兼容模型适配器
 * 覆盖 DeepSeek、通义千问、Kimi、智谱 GLM、豆包等国产模型（详见 DEC-009）
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

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
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
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
   */
  async *chat(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const model = options.model ?? this.defaultModel;
    const url = `${this.baseURL}/chat/completions`;
    const body = JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    });

    // 带超时和重试的 fetch
    const response = await this.fetchWithRetry(url, body, options.signal);

    if (!response.body) {
      throw new Error('模型 API 返回空响应');
    }

    // 解析 SSE 流，传入模型名用于最终 chunk
    yield* this.parseSSEStream(response.body, model, options.signal);
  }

  /**
   * 带超时和重试的 fetch
   * - 4xx 错误不重试（客户端问题）
   * - 5xx / 网络错误重试 1 次
   * - AbortSignal 触发时立即中断，不重试
   */
  private async fetchWithRetry(
    url: string,
    body: string,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // 组合外部 signal 和超时 signal
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      // 监听外部 abort
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
          // 外部主动中断 — 不重试
          if (externalSignal?.aborted) {
            throw new Error('生成已中断');
          }
          // 超时
          if (err.name === 'AbortError') {
            lastError = new Error('模型响应超时（30秒无响应）');
          } else {
            lastError = err;
          }
        } else {
          lastError = new Error(String(err));
        }
      }

      // 重试前等 1 秒
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    throw lastError ?? new Error('模型调用失败');
  }

  /**
   * 解析 SSE 流，逐块 yield ChatChunk
   */
  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
    model: string,
    signal?: AbortSignal,
  ): AsyncIterable<ChatChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
            yield { content: '', done: true, model };
            return;
          }

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const json = JSON.parse(data) as any;
            const delta = json.choices?.[0]?.delta;

            if (delta?.content) {
              yield { content: delta.content, done: false };
            }

            // 部分模型在最后一个 chunk 返回 usage
            if (json.usage) {
              yield {
                content: '',
                done: true,
                model,
                usage: {
                  promptTokens: json.usage.prompt_tokens,
                  completionTokens: json.usage.completion_tokens,
                  totalTokens: json.usage.total_tokens,
                },
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

    yield { content: '', done: true, model };
  }

  /**
   * 格式化 API 错误信息，给用户更清晰的提示
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
