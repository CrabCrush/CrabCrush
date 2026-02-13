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
}

export class OpenAICompatibleProvider {
  constructor(
    public readonly id: string,
    private readonly baseURL: string,
    private readonly apiKey: string,
    private readonly defaultModel: string,
  ) {}

  /**
   * 流式对话
   * 返回 AsyncIterable，逐块输出内容
   */
  async *chat(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const model = options.model ?? this.defaultModel;

    const url = `${this.baseURL}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `模型 API 调用失败 (${response.status}): ${errorText.slice(0, 200)}`,
      );
    }

    if (!response.body) {
      throw new Error('模型 API 返回空响应');
    }

    // 解析 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6); // 去掉 "data: " 前缀
          if (data === '[DONE]') {
            yield { content: '', done: true };
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

    // 如果没有收到 [DONE]，也要结束
    yield { content: '', done: true };
  }
}
