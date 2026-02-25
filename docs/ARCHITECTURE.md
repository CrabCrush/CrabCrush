# CrabCrush 技术架构设计

> 本文档为架构概览。详细接口定义在实现时写在 `src/` 代码中，不在此重复。

## 阅读指南（省 token）

- **什么时候读**：涉及模块边界、部署模式、鉴权/安全、跨渠道抽象等改动时。
- **什么时候不读**：只是改某个函数/小功能/修 bug 时，通常直接读 `src/` 即可。
- **设计细节**：交互协议/UX 细节尽量放在 `docs/DESIGN/`，需要时再按链接阅读。

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
│              (OpenAI 兼容适配器 + 路由)               │
└─────────────────────────────────────────────────────┘
```

**当前实现**：Gateway 为 Fastify HTTP + WebSocket + 静态文件；Session 由 Agent Runtime 管理；对话持久化到 SQLite。详见 `src/`。

## 二、核心模块职责

| 模块 | 职责 | 参考 |
|------|------|------|
| **Gateway** | HTTP 服务、WebSocket、静态文件、Token 认证 | DEC-019 |
| **Channel** | 消息标准化、发送；钉钉 Stream / 飞书 WebSocket / Webhook 两种模式 | DEC-003 |
| **Agent Runtime** | 会话管理、多轮上下文、模型调用、工具执行 | — |
| **Model Layer** | OpenAI 兼容适配器，baseURL + apiKey 接入多模型 | DEC-009 |
| **Tools** | Function Calling、owner 权限、confirmRequired | DEC-026 |

**渠道流式策略**：钉钉不支持编辑已发消息 → 等流式结束后一次性发送；WebChat 支持流式逐字。

## 三、数据存储

```
~/.crabcrush/
├── config/crabcrush.yaml    # 主配置（DEC-022）
├── data/conversations.db    # 对话历史（SQLite）
├── logs/                    # 日志（DEC-024，Phase 2）
├── workspace/               # 工作区（2a.5）
└── credentials/             # 凭证（Phase 2+）
```

## 四、部署模式（详见 DEC-010）

### 本地模式（默认）

- **无需公网 IP**：钉钉 Stream 模式为客户端主动连接钉钉服务器
- 配置：`bind: loopback`，`publicUrl` 不设置
- `crabcrush start` 即可用 WebChat + 钉钉

### 渠道模式（需公网入口）

- 适用：企业微信（仅 Webhook）、正式部署
- 配置：`publicUrl` 设置后启用
- 公网方案：云服务器 / frp / Tailscale Funnel / ngrok

| 渠道 | 长连接模式 | 需公网 |
|------|-----------|--------|
| 钉钉 | Stream ✅ | 否 |
| 飞书 | WebSocket 订阅 | 否 |
| 企业微信 | 无 | 是 |

## 五、安全与安装

- **安全**：Token 认证、owner 工具权限、confirmRequired（2a.2）
- **安装**：`pnpm install && pnpm dev`；Docker 见 ROADMAP Phase 2c

## 六、与 OpenClaw 对比

| 维度 | OpenClaw | CrabCrush |
|------|----------|----------|
| 端口 | 18789 | 18790 |
| 数据目录 | ~/.openclaw/ | ~/.crabcrush/ |
| 配置 | openclaw.json | crabcrush.yaml |
| 钉钉 | 无 | Stream 模式，无需公网 |
