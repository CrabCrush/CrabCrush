# 🦀 CrabCrush — 你的私人 AI 助手

**做你的虾兵蟹将 🦀**

CrabCrush 是一个面向中国用户的本地优先个人 AI 助手平台。
在你已有的聊天工具（钉钉、飞书、企业微信等）里直接使用，数据存在你自己的设备上。

[架构](./docs/ARCHITECTURE.md) · [路线图](./docs/ROADMAP.md) · [决策记录](./docs/DECISIONS.md) · [愿景](./docs/VISION.md) · [更新日志](./CHANGELOG.md)

## 它是什么？

CrabCrush **不是一个在线服务，是一个装在你自己电脑上的软件。** 钉钉/飞书只是你跟它交互的"遥控器"。

**每个人自己部署、自己使用：**

1. 自己申请模型 API Key（DeepSeek / 通义千问 / Kimi …）
2. 自己在钉钉/飞书/企微创建一个机器人应用
3. 自己在电脑上运行 CrabCrush
4. 在聊天工具里 @自己的机器人 开始对话

**这意味着：**

- 对话记录、API Key、本地文件全在你自己手里，不经过任何第三方
- 以后加本地工具（文件操作、跑脚本）天然就是操作你自己的机器
- 不存在"谁付 API 费"的问题 — 各用各的 Key
- 不存在隐私泄露 — 你的数据你做主
- 群聊安全 — 当前只有纯对话，群里别人 @你的机器人不会操控你的电脑；未来加工具能力时，本地操作仅限 owner 触发（详见 [DEC-026](./docs/DECISIONS.md)）

## 快速开始

> 需要 Node.js >= 20 + pnpm

### 1. 克隆项目

```bash
git clone https://github.com/CrabCrush/CrabCrush.git
cd CrabCrush
pnpm install
```

### 2. 配置模型

复制示例配置并填入你的 API Key：

```bash
cp crabcrush.example.yaml crabcrush.yaml
```

编辑 `crabcrush.yaml`，把 DeepSeek 的 API Key 换成你自己的：

```yaml
models:
  deepseek:
    apiKey: sk-your-deepseek-api-key
```

> DeepSeek API Key 获取：https://platform.deepseek.com/api_keys
>
> 也可以用环境变量：`export CRABCRUSH_DEEPSEEK_API_KEY=sk-xxx`

### 3. 启动

```bash
pnpm dev
```

看到以下输出就说明启动成功：

```
🦀 CrabCrush Gateway 已启动
   模型: DeepSeek (deepseek-chat)
   WebChat: http://127.0.0.1:18790
```

### 4. 开始聊天

打开浏览器访问 **http://127.0.0.1:18790**，即可与 AI 对话。

> 想接入钉钉？查看 [钉钉机器人接入指南](./guide/dingtalk-setup.md)（Stream 模式，不需要公网 IP）

---

## 支持的模型

通过 OpenAI 兼容适配器，在配置文件中添加即可使用，无需改代码：

| 模型 | 配置 ID | 状态 |
|------|---------|------|
| DeepSeek-V3 / R1 | `deepseek` | ✅ 已支持 |
| 通义千问 | `qwen` | ✅ 已支持 |
| Kimi (Moonshot) | `kimi` | ✅ 已支持 |
| 智谱 GLM | `glm` | ✅ 已支持 |
| 豆包 | `doubao` | ✅ 已支持 |

已知提供商的 baseURL 自动补全，只需填 apiKey：

```yaml
models:
  deepseek:
    apiKey: sk-xxx
  qwen:
    apiKey: sk-xxx
    defaultModel: qwen-max
```

## 支持的渠道

| 渠道 | 状态 | 说明 |
|------|------|------|
| WebChat | ✅ 已实现 | 浏览器聊天，Markdown 渲染 + 代码高亮 |
| 钉钉 | ✅ 已实现 | Stream 模式，不需要公网 IP |
| 飞书 | 🔜 规划中 | Phase 2 |
| 企业微信 | 🔜 规划中 | Phase 2 |

## 项目结构

```
crabcrush/
├── src/
│   ├── index.ts              # CLI 入口
│   ├── config/               # 配置加载 (YAML + env + Zod)
│   ├── models/               # 模型适配器 (OpenAI 兼容)
│   ├── agent/                # Agent 运行时 (会话 + 多轮对话)
│   ├── channels/             # 渠道适配器
│   │   ├── types.ts          # ChannelAdapter 接口
│   │   └── dingtalk.ts       # 钉钉 Stream
│   └── gateway/              # Fastify 服务 (HTTP + WebSocket)
├── public/                   # WebChat 前端
├── test/                     # 测试
├── docs/                     # 项目文档
├── crabcrush.example.yaml    # 配置示例
└── crabcrush.yaml            # 你的配置（不入 git）
```

## 给开发者和 AI 助手

本项目采用"文档即大脑"的协作模式。AI 助手请先阅读：

1. [`AGENTS.md`](./AGENTS.md) — 项目全貌 + 当前进度
2. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — 关键决策的背景和理由

## 灵感来源

受 [OpenClaw](https://github.com/openclaw/openclaw) 启发。
🦞 OpenClaw = 龙虾 → 🦀 CrabCrush = 螃蟹 —— 同属甲壳纲，做你的虾兵蟹将！

## 许可证

[GPL-3.0 License](./LICENSE)

---

> *AI build by AI — 你放心，我绝不手写一行代码！*
