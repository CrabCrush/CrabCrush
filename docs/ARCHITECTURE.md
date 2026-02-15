# CrabCrush 技术架构设计

## 一、系统全景

```
微信 / 企业微信 / 钉钉 / 飞书 / QQ / Telegram / WebChat
│
▼
┌─────────────────────────────────────────────────────┐
│                   Channel Layer                      │
│          (渠道适配器 - 消息标准化)                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                    Gateway                           │
│              (WebSocket 控制面)                       │
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Session  │ │ Router   │ │  Queue   │            │
│  │ Manager  │ │          │ │ Manager  │            │
│  └──────────┘ └──────────┘ └──────────┘            │
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │  Auth    │ │  Config  │ │   Cron   │            │
│  │          │ │ Manager  │ │ Scheduler│            │
│  └──────────┘ └──────────┘ └──────────┘            │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │  Agent   │ │  Tools   │ │  Skills  │
  │ Runtime  │ │ Registry │ │  System  │
  └─────┬────┘ └──────────┘ └──────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│                   Model Layer                        │
│              (模型适配 + 路由)                         │
│                                                     │
│  DeepSeek | Qwen | Kimi | GLM | Claude | GPT | ... │
└─────────────────────────────────────────────────────┘
```

> **当前实现说明**：上图为目标架构。Phase 0/1 实现为简化版：Gateway 仅含 HTTP + WebSocket + 静态文件，Session/Queue/Cron 等由 Agent Runtime 和 Fastify 内置能力承担，未单独拆分为独立模块。随着 Phase 2+ 功能扩展，可逐步演进至完整架构。

## 二、核心模块设计

### 2.1 Gateway（网关核心）

Gateway 是整个系统的中枢，基于 **Fastify**（详见 DEC-019）构建，负责：
- 管理所有 WebSocket 连接（渠道、客户端、工具）
- 消息路由（入站消息 -> 正确的 Agent 会话）
- 会话管理（创建、恢复、清理）
- 配置管理（YAML + 环境变量 + Zod 校验，详见 DEC-022；热加载推迟到 Phase 2a，详见 DEC-018）
- 认证鉴权

```typescript
// Gateway 核心接口
interface Gateway {
  // 生命周期
  start(config: GatewayConfig): Promise<void>;
  stop(): Promise<void>;
  
  // WebSocket
  onConnection(handler: ConnectionHandler): void;
  broadcast(event: GatewayEvent): void;
  
  // 会话管理
  sessions: SessionManager;
  
  // 消息路由
  router: MessageRouter;
  
  // 配置
  config: ConfigManager;
}

interface GatewayConfig {
  port: number;                    // 默认 18790（避免与 OpenClaw 冲突）
  bind: 'loopback' | 'all';       // 绑定地址（本地模式默认 loopback）
  publicUrl?: string;              // 公网回调地址（设置后启用渠道 Webhook 回调）
  behindProxy?: boolean;           // 是否在反向代理后面
  tls?: {                          // TLS 配置（可选，也可用反向代理处理）
    cert: string;
    key: string;
  };
  tunnel?: {                       // 内网穿透（可选，Gateway 自动管理）
    provider: 'tailscale' | 'frp' | 'ngrok' | 'none';
    tailscale?: { mode: 'serve' | 'funnel' };
    frp?: { serverAddr: string; serverPort: number; token: string };
  };
  auth: AuthConfig;                // 认证配置
  channels: ChannelConfigs;        // 渠道配置
  agent: AgentConfig;              // Agent 配置
  models: ModelConfigs;            // 模型配置
}

// 部署模式通过配置推断（不设显式 mode 字段）：
// - 本地模式（默认）：bind = 'loopback'，publicUrl 未设置
// - 渠道模式：publicUrl 已设置，bind 可选 'all'
// 详见本文件"五、部署模式"章节
```

### 2.2 Channel Layer（渠道层）

每个渠道实现统一的 `ChannelAdapter` 接口。

**重要：国内平台的消息接入有两种模式（详见 DEC-003、本文件"五、部署模式"章节）：**

1. **HTTP 回调（Webhook）模式**：平台 POST 到我们的公网 HTTP 端点，需要公网 IP / 域名
2. **Stream / 长连接模式**：客户端主动连接平台服务器（类似 WebSocket），**不需要公网 IP**
   - 钉钉：Stream 模式（V1 优先采用）
   - 飞书：事件订阅 v2.0 WebSocket 模式（后续接入时评估）

渠道适配器需要能处理这两种模式。发送消息统一通过平台 HTTP API。

```typescript
// 统一消息格式
interface CrabMessage {
  id: string;
  channelType: ChannelType;        // 'wecom' | 'dingtalk' | 'feishu' | ...
  channelId: string;               // 渠道实例 ID
  direction: 'inbound' | 'outbound';
  
  // 发送者信息
  sender: {
    id: string;
    name: string;
    avatar?: string;
  };
  
  // 对话信息
  conversation: {
    id: string;
    type: 'dm' | 'group';
    name?: string;
  };
  
  // 消息内容（统一格式）
  content: MessageContent;
  
  // 回复/引用关系
  replyTo?: {
    messageId: string;             // 被引用的消息 ID
    content?: MessageContent;      // 被引用的消息内容（可选，用于展示）
  };
  
  // 原始数据（保留渠道特有信息）
  raw?: unknown;
  
  timestamp: number;
}

// 消息内容类型
type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'voice'; url: string; duration: number; transcript?: string }
  | { type: 'video'; url: string; duration: number }
  | { type: 'file'; url: string; name: string; size: number }
  | { type: 'location'; latitude: number; longitude: number; name?: string }
  | { type: 'card'; card: RichCard }     // 富文本卡片（飞书/钉钉特有）
  | { type: 'composite'; parts: MessageContent[] };  // 混合消息

// 渠道适配器接口
interface ChannelAdapter {
  type: ChannelType;
  
  // 生命周期
  start(config: ChannelConfig): Promise<void>;  // 启动（注册 webhook 路由等）
  stop(): Promise<void>;                         // 停止
  isReady(): boolean;                            // 是否就绪
  
  // 消息处理
  onMessage(handler: (msg: CrabMessage) => Promise<void>): void;
  
  // 发送消息
  send(conversationId: string, content: MessageContent, options?: SendOptions): Promise<SentMessage>;
  
  // 更新已发消息（用于流式输出场景：先发送再编辑追加）
  update?(messageId: string, content: MessageContent): Promise<void>;
  
  // 发送状态提示（"正在输入..."）
  sendTypingIndicator?(conversationId: string): Promise<void>;
  
  // Webhook 路由（供 Gateway HTTP 服务器挂载）
  webhookRoutes?(): WebhookRoute[];
  
  // 能力声明
  capabilities(): ChannelCapabilities;
}

interface SendOptions {
  replyTo?: string;          // 回复某条消息
  silent?: boolean;          // 静默发送（不触发通知）
}

interface SentMessage {
  id: string;                // 已发送消息的 ID（用于后续 update）
  timestamp: number;
}

// Webhook 路由定义
interface WebhookRoute {
  method: 'GET' | 'POST';
  path: string;              // 如 '/webhook/dingtalk'
  handler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// 渠道能力声明
interface ChannelCapabilities {
  richCard: boolean;       // 是否支持富文本卡片
  reaction: boolean;       // 是否支持消息回应/表情
  thread: boolean;         // 是否支持消息线程
  edit: boolean;           // 是否支持编辑已发消息（流式输出关键能力）
  delete: boolean;         // 是否支持撤回消息
  reply: boolean;          // 是否支持引用回复
  voice: boolean;          // 是否支持语音消息
  file: boolean;           // 是否支持文件
  typingIndicator: boolean; // 是否支持"正在输入"状态
  maxTextLength: number;   // 单条文本消息最大长度
}
```

#### 流式输出的渠道侧处理策略

模型层输出是流式的（`AsyncIterable`），但渠道层发送是一次性的。处理策略：

| 渠道能力 | 策略 | 示例渠道 |
|---------|------|---------|
| 支持编辑已发消息 | 先发初始内容，流式追加时调用 `update()` 更新 | 飞书 |
| 不支持编辑 | 等流式结束后一次性发送完整内容 | 钉钉群机器人 |
| 支持 typing 指示 | 流式期间发送"正在输入"状态 | WebChat |
| 文本超长 | 按 `maxTextLength` 自动拆分为多条消息 | 所有渠道 |

### 2.3 Agent Runtime（Agent 运行时）

Agent 是对话的核心引擎：

```typescript
interface AgentRuntime {
  // 处理消息
  process(session: Session, message: CrabMessage): AsyncIterable<AgentChunk>;
  
  // 模型调用
  model: ModelRouter;
  
  // 工具调用
  tools: ToolRegistry;
  
  // 提示词管理
  prompts: PromptManager;
}

// 推理深度（DeepSeek R1 等支持推理模式的模型）
type ThinkingLevel = 'none' | 'standard' | 'deep';

// 会话
interface Session {
  id: string;
  channelType: ChannelType;
  conversationType: 'dm' | 'group';
  
  // 对话历史
  messages: ConversationMessage[];
  
  // 会话配置
  config: {
    model: string;               // 当前使用的模型
    thinkingLevel: ThinkingLevel;
    systemPrompt: string;
    tools: string[];             // 启用的工具列表
    maxTokens: number;
  };
  
  // 上下文压缩（对话历史超出模型上下文窗口时自动触发）
  compact(): Promise<void>;
  
  // 会话元数据
  metadata: Record<string, unknown>;
  
  // 时间戳
  createdAt: number;
  lastActiveAt: number;
}
```

#### Session 管理策略（V1）

| 维度 | V1 策略 | 说明 |
|------|---------|------|
| **隔离方式** | 按 sender ID 隔离（详见 DEC-011） | 同一钉钉群内不同用户各有独立 Session |
| **持久化** | JSON 文件（`~/.crabcrush/data/sessions/`） | 每个 Session 一个文件，Gateway 重启后可恢复 |
| **清理策略** | TTL 过期（默认 7 天不活跃自动清理） | 避免 Session 文件无限增长 |
| **最大数量** | 默认 1000 个活跃 Session | 超出时清理最久未活跃的 Session |
| **内存管理** | 仅加载活跃 Session 到内存 | 不活跃的 Session 保持在磁盘，按需加载 |
| **上下文窗口** | 超出 `maxContextTokens` 时调用 `compact()` | V1 策略：截断最早的消息，保留最近 N 轮 |
| **优雅关闭** | Gateway 收到 SIGTERM 时，完成进行中的回复后再退出 | 不会丢失正在生成的消息 |

#### 进程管理（V1）

```typescript
// Gateway 生命周期
interface GatewayLifecycle {
  // 启动：加载配置 → 初始化模型 → 启动渠道适配器 → 监听端口
  start(config: GatewayConfig): Promise<void>;
  
  // 优雅关闭：停止接收新请求 → 等待进行中的回复完成（超时 30s）→ 关闭连接 → 退出
  stop(options?: { timeout?: number }): Promise<void>;
  
  // 健康检查
  health(): { status: 'ok' | 'degraded' | 'error'; details: Record<string, unknown> };
}
```

- **进程崩溃**：V1 不内置守护进程。建议用户使用 `pm2` 或系统 `systemd` 管理进程。`crabcrush doctor` 可检测并建议安装 pm2
- **日志策略**：使用 **pino**（JSON 结构化日志），输出到 `~/.crabcrush/logs/`，支持滚动（按大小/日期）。开发时 `pino-pretty` 美化输出
- **崩溃恢复**：Session 已持久化到磁盘，Gateway 重启后自动恢复活跃 Session

### 2.4 Model Layer（模型层）

统一的模型调用和路由。

**重要简化：** 大部分国产模型（DeepSeek、通义千问、Kimi、智谱 GLM、豆包等）的 API 都兼容
OpenAI 的 `chat/completions` 格式。因此**不需要为每个模型写独立适配器**，只需要：
1. 一个 `OpenAICompatibleProvider`（通用适配器），通过不同配置（baseURL + apiKey）接入不同模型
2. 仅对 API 有显著差异的模型（如特殊鉴权方式）才写独立适配器

```typescript
interface ModelRouter {
  // 模型调用（自动路由或指定模型）
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
  
  // 注册模型提供商
  register(provider: ModelProvider): void;
  
  // 列出可用模型
  listModels(): ModelInfo[];
  
  // 模型健康检查
  healthCheck(): Promise<ModelHealth[]>;
}

interface ModelProvider {
  id: string;                     // "deepseek", "qwen", "kimi", ...
  name: string;
  
  // 核心方法
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
  
  // 模型列表
  models(): ModelInfo[];
  
  // 费用估算
  estimateCost(usage: TokenUsage): number;
  
  // 健康检查
  ping(): Promise<boolean>;
}

// 大部分模型通过这个配置即可接入，无需写代码
interface OpenAICompatibleConfig {
  id: string;                     // "deepseek"
  name: string;                   // "DeepSeek"
  baseURL: string;                // "https://api.deepseek.com/v1"
  apiKey: string;                 // 用户配置
  models: ModelInfo[];            // 可用模型列表
  pricing?: ModelPricing;         // 价格信息（用于费用估算）
}

// 能力探测（DEC-009：避免上层写死假设）
interface ModelCapabilities {
  streaming: boolean;          // 是否支持流式输出
  toolCall: boolean;           // 是否支持 Function Calling / Tool Use
  jsonMode: boolean;           // 是否支持 JSON Mode 输出
  vision: boolean;             // 是否支持图片输入
  maxContextTokens: number;    // 最大上下文长度
}

// 预置的 OpenAI 兼容模型配置
// DeepSeek  → baseURL: https://api.deepseek.com/v1
// 通义千问  → baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
// Kimi      → baseURL: https://api.moonshot.cn/v1
// 智谱 GLM  → baseURL: https://open.bigmodel.cn/api/paas/v4
// 豆包      → baseURL: https://ark.cn-beijing.volces.com/api/v3
//
// 注意：兼容度约 70%，剩余差异（流式格式、tool_call 参数等）
// 通过 ModelCapabilities 声明 + 运行时降级处理（详见 DEC-009）

interface ChatRequest {
  model: string;                  // "deepseek-chat", "qwen-max", ...
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];       // 函数调用（Function Calling）
  stream: boolean;
}

// 模型路由策略
interface RoutingStrategy {
  type: 'fixed' | 'auto' | 'cost-optimized' | 'quality-first';
  
  // 自动路由时的规则
  rules?: RoutingRule[];
  
  // Failover 配置
  failover?: {
    enabled: boolean;
    maxRetries: number;
    fallbackModels: string[];
  };
  
  // 成本控制
  budget?: {
    dailyLimit: number;           // 每日上限（元）
    monthlyLimit: number;         // 每月上限（元）
    alertThreshold: number;       // 告警阈值（百分比）
  };
}
```

### 2.5 Tools & Skills（工具与技能系统）— Phase 2a 实现，详见 DEC-011

> V1 不含工具调用和 Skills 框架。以下仅记录设计方向，详细接口在 Phase 2a 启动时定义。

**设计方向**：
- **Tool**：工具 = 名称 + 描述 + JSON Schema 参数 + execute 方法
- **Skill**：技能 = 一组工具 + 系统提示词 + 生命周期钩子，可打包分发
- **降级策略**：模型不支持 Function Calling 时，通过提示词注入方式实现（基于 ModelCapabilities）
- **沙箱**：代码执行工具需要沙箱隔离，选型在 Phase 2a 决策

### 2.6 Voice（语音模块）— Phase 3 实现

> V1/V1.1 不含语音能力。以下仅记录设计方向，详细接口在 Phase 3 启动时定义。

**设计方向**：
- ASR（语音识别）：讯飞/阿里/腾讯/Whisper，中文准确率优先
- TTS（语音合成）：讯飞/阿里/腾讯/Edge TTS，支持方言
- Talk Mode（实时对话）：WebRTC + ASR + TTS 流式处理

## 三、数据存储

**原则：本地优先，文件存储为主，按需引入数据库。**

```
~/.crabcrush/
├── config/
│   └── crabcrush.yaml              # 主配置文件（详见 DEC-022）
├── data/
│   ├── sessions/                  # 会话数据（JSON 文件）
│   ├── knowledge/                 # 知识库（向量数据库）
│   └── media/                     # 媒体文件缓存
├── credentials/                   # 渠道凭证（加密存储）
├── logs/                          # 日志
├── skills/                        # 已安装的技能
└── workspace/                     # 用户工作空间
    ├── AGENTS.md                  # Agent 提示词
    ├── SOUL.md                    # 人格设定
    └── skills/                    # 用户自定义技能
```

### 存储选型

| 数据类型 | 存储方式 | 说明 |
|---------|---------|------|
| 配置 | YAML 文件（详见 DEC-022） | 支持注释，可读性好，启动时加载（热加载 Phase 2a） |
| 会话历史 | JSON 文件 / SQLite | 小规模用文件，大规模用 SQLite |
| 知识库 | SQLite + sqlite-vss | 本地向量检索 |
| 凭证 | 加密 JSON | AES-256 加密 |
| 媒体 | 本地文件 + LRU 清理 | 自动清理过期缓存 |
| 日志 | 滚动日志文件 | pino logger |

## 四、安全架构

```
┌─────────────────────────────────────────────────┐
│                  安全层级                         │
│                                                 │
│  L1: 网络安全                                    │
│    - Gateway 默认绑定 loopback                   │
│    - WSS/HTTPS 加密传输                          │
│    - 可选：内网穿透（frp/Tailscale）              │
│                                                 │
│  L2: 认证鉴权                                    │
│    - 配对码机制（参考 OpenClaw）                   │
│    - Token 认证（Web UI / API）                  │
│    - 渠道级别的白名单                             │
│                                                 │
│  L3: 内容安全                                    │
│    - 敏感词过滤（本地词库）                        │
│    - 可选：云端内容审核 API                       │
│    - 输出审查（防止模型泄露隐私）                   │
│                                                 │
│  L4: 执行安全                                    │
│    - 代码执行沙箱（Docker）                       │
│    - 文件访问权限控制                             │
│    - 工具调用审批机制（高危操作需确认）             │
│                                                 │
│  L5: 数据安全                                    │
│    - 本地数据加密存储                             │
│    - 凭证加密                                    │
│    - 审计日志                                    │
└─────────────────────────────────────────────────┘
```

## 五、部署模式（原 DEPLOYMENT_MODES.md，已合并至此）

> 详见 DEC-010。

### 背景

国内平台（钉钉/飞书/企微）的机器人消息传统上需要平台 POST 到**公网可达的 HTTP 端点**（Webhook 回调），
这与"本地优先"理念存在张力。但 **Stream/长连接模式**（钉钉 Stream、飞书 WebSocket 订阅）改变了这一局面——
客户端主动连接平台服务器，**不需要公网 IP**。这是 CrabCrush 部署架构的关键发现（详见 DEC-003）。

### 模式一：本地模式（Local Mode）— 默认

```
用户浏览器 ──→ WebChat ──→ Gateway (localhost:18790)
                                │
                                ├─ Agent Runtime
                                ├─ Model API (DeepSeek/Qwen/...)
                                └─ 钉钉适配器 ──→ 主动连接钉钉 Stream 服务器
                                                  （长连接，不需要公网 IP）
```

- **适用场景**：个人使用、开发调试、小团队
- **支持的渠道**：WebChat（直连 localhost）、钉钉（Stream 模式）、飞书（WebSocket 模式，待评估）
- **网络要求**：无需公网 IP、无需域名、无需证书。只需能访问外网 API
- **配置难度**：零配置（WebChat）/ 低配置（钉钉需填 AppKey）

**这是 V1 的主力模式。** `crabcrush start` 即可同时使用 WebChat 和钉钉。

### 模式二：渠道模式（Channel Mode）— 需要公网入口

```
钉钉/飞书/企微平台
     │ HTTP POST (webhook 回调)
     ▼
┌──────────────┐
│  公网入口     │  ← 云服务器 / 内网穿透(frp/ngrok) / Tailscale Funnel
└──────┬───────┘
       ▼
   Gateway (HTTP + WebSocket)
       ├─ Agent Runtime
       └─ Model API
```

- **适用场景**：使用 Webhook 回调模式的渠道（如企业微信）、企业正式部署
- **网络要求**：需要公网可达的 HTTPS 端点

| 公网入口方案 | 成本 | 稳定性 | 适合谁 |
|------------|------|--------|--------|
| 云服务器部署 | 月付 50-200 元 | 高 | 长期使用的团队 |
| frp 内网穿透 | 需自建 frp 服务 | 中 | 有运维能力的用户 |
| Tailscale Funnel | 免费 | 高 | 推荐 |
| ngrok | 免费版有限制 | 中 | 快速测试 |

### Gateway 模式推断

Gateway 通过配置字段推断部署模式（不设显式 mode 字段）：

- **`publicUrl` 未设置** → 本地模式（`bind` 默认 `loopback`，仅绑定 `127.0.0.1`）
- **`publicUrl` 已设置** → 渠道模式（如 `https://crab.example.com`，支持 Webhook 回调）

| 字段 | 本地模式 | 渠道模式 |
|------|---------|---------|
| `bind` | `loopback`（默认） | `loopback` 或 `all` |
| `publicUrl` | 不设置 | 必须设置 |
| `tls` | 不需要 | 可选（可用反向代理） |
| `behindProxy` | 不需要 | 如用 nginx/caddy 设为 `true` |

### Stream/长连接 = 关键架构优势

| 渠道 | 长连接模式 | 说明 |
|------|-----------|------|
| 钉钉 | Stream 模式 | V1 已采用 |
| 飞书 | WebSocket 事件订阅 v2.0 | Phase 2a 评估 |
| 企业微信 | 无 | 仅 Webhook，必须渠道模式 |

### 安装方式

```shell
# 方案 1：本地安装（推荐个人用户）
npm install -g crabcrush@latest
crabcrush onboard && crabcrush start

# 方案 2：Docker 部署（推荐服务器/团队）
docker run -d --name crabcrush -p 18790:18790 -v ~/.crabcrush:/root/.crabcrush crabcrush/crabcrush:latest

# 方案 3：一键脚本
curl -fsSL https://get.crabcrush.dev | bash
```

## 六、网络策略

```typescript
// 网络适配器 —— 解决国内特殊网络环境
interface NetworkAdapter {
  // 自动检测网络环境
  detectEnvironment(): Promise<'china' | 'global' | 'mixed'>;
  
  // 请求路由
  fetch(url: string, options?: RequestOptions): Promise<Response>;
  
  // 代理配置
  proxy?: {
    http: string;      // HTTP 代理
    https: string;     // HTTPS 代理
    noProxy: string[]; // 直连列表
  };
}

// 规则：
// - 国产模型 API（deepseek/qwen/kimi/...）-> 直连
// - 国际模型 API（claude/openai/...）-> 走代理（如果配置了）
// - 国内渠道 API -> 直连
// - 其他 -> 按规则匹配
```

## 七、与 OpenClaw 的架构对比

| 维度 | OpenClaw | CrabCrush | 差异原因 |
|------|----------|----------|---------|
| 默认端口 | 18789 | 18790 | 避免冲突，可共存 |
| Agent 运行时 | Pi (自研) | 自研（参考 Pi 设计） | 需要中文优化 |
| 渠道协议 | 基于各渠道 SDK | 基于各渠道 SDK | 渠道完全不同 |
| 模型调用 | 直接调用 API | 统一路由层 + Failover | 国内多模型切换需求更强 |
| 数据目录 | ~/.openclaw/ | ~/.crabcrush/ | 独立项目 |
| 配置文件 | openclaw.json | crabcrush.yaml（详见 DEC-022） | 独立项目 |
| 内容安全 | 无 | 内置审核模块 | 国内合规需要 |
| 网络层 | 直连 | 智能路由（直连/代理） | GFW |
