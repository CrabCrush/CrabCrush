# CrabCrush 部署模式

> 本文件是部署形态的权威定义。详见 DEC-010。

## 背景

国内平台（钉钉/飞书/企微）的机器人消息传统上需要平台 POST 到**公网可达的 HTTP 端点**（Webhook 回调），
这与"本地优先"理念存在张力。但 **Stream/长连接模式**（钉钉 Stream、飞书 WebSocket 订阅）改变了这一局面——
客户端主动连接平台服务器，**不需要公网 IP**。这是 CrabCrush 部署架构的关键发现（详见 DEC-003）。

## 两种部署模式

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
- **支持的渠道**：
  - WebChat（浏览器直连 localhost）
  - 钉钉（Stream 长连接模式，V1 支持）
  - 飞书（WebSocket 事件订阅模式，后续评估）
  - 其他支持客户端长连接的渠道
- **网络要求**：无需公网 IP、无需域名、无需证书。只需能访问外网 API
- **配置难度**：零配置（WebChat）/ 低配置（钉钉需填 AppKey）
- **数据隐私**：最高，所有数据都在本地

**这是 V1 的主力模式。** 用户执行 `crabcrush start` 即可同时使用 WebChat 和钉钉，无需任何公网基础设施。

### 模式二：渠道模式（Channel Mode）— 需要公网入口

```
钉钉/飞书/企微平台
     │
     │ HTTP POST (webhook 回调)
     ▼
┌──────────────┐
│  公网入口     │  ← 三选一：
│              │     a) 云服务器直接部署
│              │     b) 内网穿透（frp/ngrok）
│              │     c) Tailscale Funnel
└──────┬───────┘
       │
       ▼
   Gateway (HTTP + WebSocket)
       │
       ├─ Agent Runtime
       └─ Model API
```

- **适用场景**：使用 Webhook 回调模式的渠道、企业正式部署
- **渠道支持**：所有渠道（包括只支持 Webhook 回调的渠道如企业微信）
- **网络要求**：需要公网可达的 HTTPS 端点
- **配置难度**：中等

#### 公网入口方案对比

| 方案 | 成本 | 稳定性 | 复杂度 | 适合谁 |
|------|------|--------|--------|--------|
| **云服务器部署** | 月付（约 50-200 元） | 高 | 低 | 长期使用的用户/团队 |
| **frp 内网穿透** | 需自建或租用 frp 服务 | 中 | 中 | 有一定运维能力的用户 |
| **ngrok** | 免费版有限制 | 中 | 低 | 快速测试 |
| **Tailscale Funnel** | 免费 | 高 | 低 | 推荐（类似 OpenClaw 方案） |

#### 回调安全要求

无论哪种方案，Gateway 在渠道生产模式下必须满足：

1. **HTTPS**：所有平台都要求回调地址为 HTTPS
2. **签名验证**：验证回调请求确实来自钉钉/飞书/企微（每个平台都有签名机制）
3. **Token 鉴权**：防止未授权访问
4. **速率限制**：防止恶意请求

## Gateway 如何支持两种模式

Gateway 通过 `GatewayConfig` 的配置字段推断部署模式（接口定义详见 `docs/ARCHITECTURE.md` 2.1 节）：

- **`publicUrl` 未设置** → 本地模式（`bind` 默认 `loopback`，仅绑定 `127.0.0.1`）
- **`publicUrl` 已设置** → 渠道模式（如 `https://crab.example.com`，支持 Webhook 回调）

关键配置字段：

| 字段 | 本地模式 | 渠道模式 |
|------|---------|---------|
| `bind` | `loopback`（默认） | `loopback` 或 `all` |
| `publicUrl` | 不设置 | 必须设置（公网 HTTPS 地址） |
| `tls` | 不需要 | 可选（也可用反向代理处理） |
| `behindProxy` | 不需要 | 如使用 nginx/caddy 反向代理则设为 `true` |
| `tunnel` | 不需要 | 可选（Tailscale / frp / ngrok） |

注意：Stream/长连接模式的渠道（如钉钉 Stream）在本地模式下也能工作，不需要 `publicUrl`。

## 设计原则

1. **本地模式是默认值**：`crabcrush start` 不带任何参数 = 本地模式 + WebChat
2. **渠道模式通过向导配置**：`crabcrush onboard --channel dingtalk` 引导用户配置公网入口
3. **Gateway 代码不区分模式**：两种模式的差异只在配置层，Gateway 核心代码是同一套
4. **内网穿透可选内置**：如果用户选择 Tailscale/frp，Gateway 可以自动启动和管理隧道进程

## Stream/长连接模式：关键架构优势（详见 DEC-003）

| 渠道 | 长连接模式 | 说明 |
|------|-----------|------|
| 钉钉 | Stream 模式 | V1 优先采用，客户端主动连接钉钉服务器 |
| 飞书 | 事件订阅 v2.0 WebSocket | 后续接入时评估，原理类似 |
| 企业微信 | 无 | 仅支持 Webhook 回调，必须使用渠道模式 |

**核心结论：** 支持长连接模式的渠道可在本地模式下工作，无需公网基础设施。这使得 V1 用户只需 `crabcrush start`，本地即可同时使用 WebChat 和钉钉。

## 对路线图的影响

- **Phase 0 MVP**：本地模式（WebChat + DeepSeek），不需要处理公网问题
- **Phase 1 钉钉接入**：本地模式 + Stream 模式，HTTP 回调作为备选
- **Phase 2+**：飞书接入时评估其 WebSocket 模式；企业微信需要渠道模式 + 公网入口
