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

/** 计划审批策略 */
export type ToolPlanPolicy = 'always' | 'covered_only' | 'safe_auto';

/** 确认作用域 */
export type ConfirmationScope = 'once' | 'session' | 'persistent';

/** 执行预览 */
export interface ToolExecutionPreview {
  title: string;
  summary?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  targets?: string[];
}

/** 工具确认请求 */
export interface ToolConfirmRequest {
  name: string;
  args: Record<string, unknown>;
  sessionId: string;
  senderId: string;
  /** 结构化审计/回放用操作 ID */
  operationId?: string;
  /** 当前确认对应的步骤序号（从 1 开始） */
  stepIndex?: number;
  /** confirmRequired(工具级) 或 permission_request(请求级) */
  kind?: 'confirm' | 'permission_request' | 'plan';
  /** 可选说明文案 */
  message?: string;
  /** 执行预览 */
  preview?: ToolExecutionPreview;
  /** 授权作用域选项 */
  scopeOptions?: ConfirmationScope[];
  /** 默认作用域 */
  defaultScope?: ConfirmationScope;
  /** 会话授权复用键 */
  grantKey?: string;
}

/** 工具确认结果 */
export interface ToolConfirmDecision {
  allow: boolean;
  scope?: ConfirmationScope;
  reason?: 'rejected' | 'timeout';
}

/** 工具确认处理器 */
export type ToolConfirmHandler = (request: ToolConfirmRequest) => Promise<ToolConfirmDecision>;

/** 运行时权限请求（请求级） */
export interface PermissionRequest {
  action: string;
  message: string;
  params?: Record<string, unknown>;
  operationId?: string;
  preview?: ToolExecutionPreview;
  scopeOptions?: ConfirmationScope[];
  defaultScope?: ConfirmationScope;
  grantKey?: string;
}

/**
 * 工具执行上下文
 */
export interface ToolContext {
  /** 渠道类型（webchat / dingtalk 等） */
  channel?: string;
  /** 发送者 ID（钉钉 userId / WebChat 固定本地主体 ID） */
  senderId: string;
  /** 权限主体键（如 webchat:default / dingtalk:staff-001） */
  principalKey?: string;
  /** 是否是 owner */
  isOwner: boolean;
  /** 会话 ID */
  sessionId: string;
  /** 当前执行链操作 ID，用于串起 plan / confirm / tool_result */
  operationId?: string;
  /** 当前工具所在步骤序号（从 1 开始） */
  stepIndex?: number;
  /** 当前用户消息（可选，用于安全策略） */
  userMessage?: string;
  /** 需要确认时的回调（由通道层提供） */
  confirm?: ToolConfirmHandler;
  /** 运行时权限请求（动态） */
  requestPermission?: (request: PermissionRequest) => Promise<ToolConfirmDecision>;
  /** 检查是否已有授权；touch=false 时仅探测，不刷新持久授权最近使用时间 */
  hasPermissionGrant?: (grantKey: string, options?: { touch?: boolean }) => boolean;
  /** 记录授权（session / persistent） */
  rememberPermissionGrant?: (
    grantKey: string,
    scope: ConfirmationScope,
    details?: {
      action?: string;
      preview?: ToolExecutionPreview;
    },
  ) => void;
  /** 审计日志回调（可选） */
  audit?: (event: { type: string; [key: string]: unknown }) => void;
}

export type ToolFailureKind =
  | 'rejected'
  | 'timeout'
  | 'confirmation_required'
  | 'confirmation_failed'
  | 'error';

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  /** 返回给模型的内容 */
  content: string;
  /** 结构化失败原因，避免运行时/前端依赖字符串匹配 */
  failureKind?: ToolFailureKind;
  /** 是否应停止后续执行并降级为只给方案 */
  degradeToAdvice?: boolean;
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
  /** 计划审批策略：默认 covered_only；safe_auto 用于低风险只读操作 */
  planPolicy?: ToolPlanPolicy;
  /** 构建确认请求（用于执行预览、会话授权作用域） */
  buildConfirmRequest?(args: Record<string, unknown>, context: ToolContext): Partial<ToolConfirmRequest>;
  /** 构建请求级权限元数据（用于计划阶段判断是否已被授权覆盖） */
  buildPermissionRequest?(args: Record<string, unknown>, context: ToolContext): Partial<PermissionRequest> | null;
  /** 执行前预检：返回 ToolResult 则直接返回，不再确认/执行 */
  precheck?(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult | null>;
  /** 执行工具 */
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
