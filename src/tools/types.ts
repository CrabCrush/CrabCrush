/**
 * 工具系统类型定义
 * 基于 OpenAI Function Calling 标准格式（行业通用，详见 DEC-029）
 */

/**
 * JSON Schema 子集（用于描述工具参数）
 * 遵循 OpenAI function calling 的 parameters 格式
 */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    items?: { type: string };
    default?: unknown;
  }>;
  required?: string[];
}

/**
 * 工具定义（发给模型的部分）
 */
export interface ToolDefinition {
  /** 工具名称，全局唯一（如 "get_current_time"） */
  name: string;
  /** 工具描述，模型据此决定是否调用 */
  description: string;
  /** 参数 JSON Schema */
  parameters: ToolParameters;
}

/**
 * 工具权限等级（详见 DEC-026）
 * - public: 所有人可用（查天气、翻译等云端 API 类）
 * - owner:  仅 owner 可用（文件操作、命令执行等本地操作类）
 */
export type ToolPermission = 'public' | 'owner';

/** 工具确认请求 */
export interface ToolConfirmRequest {
  name: string;
  args: Record<string, unknown>;
  sessionId: string;
  senderId: string;
}

/** 工具确认处理器 */
export type ToolConfirmHandler = (request: ToolConfirmRequest) => Promise<boolean>;

/**
 * 工具执行上下文
 */
export interface ToolContext {
  /** 发送者 ID（钉钉 userId / WebChat sessionId） */
  senderId: string;
  /** 是否是 owner */
  isOwner: boolean;
  /** 会话 ID */
  sessionId: string;
  /** 需要确认时的回调（由通道层提供） */
  confirm?: ToolConfirmHandler;
  /** 审计日志回调（可选） */
  audit?: (event: { type: string; [key: string]: unknown }) => void;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  /** 返回给模型的内容 */
  content: string;
}

/**
 * 工具接口 — 每个工具实现这个接口
 */
export interface Tool {
  /** 工具定义（发给模型 API 的） */
  definition: ToolDefinition;
  /** 权限等级 */
  permission: ToolPermission;
  /** 是否需要用户确认才执行（高危操作，详见 DEC-026） */
  confirmRequired: boolean;
  /** 执行工具 */
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
