# 🦀 CrabCrush — 你的私人 AI 助手

**做你的虾兵蟹将 🦀**

CrabCrush 是一个面向中国用户的本地优先个人 AI 助手平台。
它运行在你自己的设备上，在你已经在用的聊天工具（企业微信、钉钉、飞书、QQ、Telegram 等）里，
为你提供一个强大的、隐私可控的 AI 助手。

你不需要安装新的 App。你不需要把聊天记录交给别人。
Gateway 是控制面——产品是助手本身。

如果你想要一个本地的、快速的、说中国话的、随时在线的个人 AI 助手，这就是它。

[文档](./docs/) · [愿景](./docs/VISION.md) · [架构](./docs/ARCHITECTURE.md) · [路线图](./docs/ROADMAP.md) · [决策记录](./docs/DECISIONS.md)

## 特性亮点

### V1 目标（开发中）

- 🇨🇳 **中文原生** — 不是"汉化"，从底层为中文语境设计
- 💬 **WebChat + 钉钉** — 网页聊天 + 钉钉 Stream 模式，本地即可工作，无需公网 IP
- 🤖 **国产模型** — DeepSeek + 通义千问，OpenAI 兼容适配器覆盖更多模型
- 🏠 **本地优先** — 数据存在你自己的设备上，隐私你说了算
- 🔄 **流式对话** — 多轮上下文 + 流式输出，首字节延迟 < 500ms

### 远期规划

- 💬 **更多渠道** — 飞书、企业微信、QQ、Telegram（Phase 2）
- 🔧 **工具能力** — 网页浏览、代码执行、知识库、快递查询、天气、日历…（Phase 2）
- 🗣️ **中文语音** — 语音识别 + 语音合成，支持讯飞/阿里/腾讯（Phase 3）
- 🧩 **技能扩展** — 插件化架构，社区可贡献技能包（Phase 2）
- 🐳 **一键部署** — Docker / 宝塔面板 / NAS（Phase 2）

## 快速开始

> 需要 Node.js >= 20

```shell
# 安装
npm install -g crabcrush@latest

# 向导式配置（引导填写 API Key、选择模型等）
crabcrush onboard

# 启动（默认本地模式，自动打开 WebChat）
crabcrush start

# 自检诊断（检查 Node 版本、配置、网络连通性）
crabcrush doctor
```

## 支持的渠道（按开发顺序）

| 渠道 | 状态 | 说明 |
|------|------|------|
| WebChat | 🔜 规划中 | 网页聊天，兜底渠道，零外部依赖 |
| 钉钉 | 🔜 规划中 | 第一个正式渠道，企业市场份额最大 |
| 飞书 | 🔜 规划中 | 第二个渠道，验证渠道抽象层 |
| 企业微信 | 🔜 规划中 | 第三个渠道，与微信生态打通 |
| Telegram | 🔜 规划中 | Bot API，技术圈用户 |
| QQ | 🔜 规划中 | QQ 机器人平台 |
| 微信个人号 | ⏸️ 暂缓 | 逆向风险高，近期不做 |

## 支持的模型

| 模型 | 厂商 | 状态 |
|------|------|------|
| DeepSeek-V3/R1 | 深度求索 | 🔜 优先支持 |
| Qwen-Max/Plus | 阿里巴巴 | 🔜 优先支持 |
| Moonshot (Kimi) | 月之暗面 | 🔜 优先支持 |
| GLM-4 | 智谱AI | 🔜 规划中 |
| 豆包 | 字节跳动 | 🔜 规划中 |
| Claude | Anthropic | 🔜 规划中 |
| GPT-4o | OpenAI | 🔜 规划中 |

## 架构概览

```
微信 / 企业微信 / 钉钉 / 飞书 / QQ / Telegram / WebChat
│
▼
┌───────────────────────────────┐
│            Gateway            │
│         (控制面)               │
│     ws://127.0.0.1:18790      │
└──────────────┬────────────────┘
               │
               ├─ Agent Runtime（对话引擎）
               ├─ Model Router（模型路由）
               ├─ Tool Registry（工具注册）
               ├─ Skill System（技能系统）
               ├─ CLI（crabcrush …）
               └─ Web UI（管理界面）
```

## 给开发者和 AI 助手的话

本项目采用**"文档即大脑"**的协作模式。所有关键决策、架构设计、当前进度都记录在项目文档中，
确保无论是换电脑、换 AI 工具、还是新贡献者加入，都能快速上手。

**如果你是开发者，使用 AI 辅助开发（Cursor / Copilot / ChatGPT / Claude 等），请先对 AI 说：**

> 请先阅读 AGENTS.md 和 docs/DECISIONS.md，了解项目背景、技术决策和当前进度，然后继续开发。

**如果你是 AI 助手，请按以下顺序阅读：**

1. [`AGENTS.md`](./AGENTS.md) — 项目全貌、技术栈、当前进度（**从这里开始**）
2. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — 每个关键决策的背景和理由（只保留当前有效决策）
3. [`docs/ROADMAP.md`](./docs/ROADMAP.md) — 路线图 + 每项任务的验收标准
4. [`docs/DEPLOYMENT_MODES.md`](./docs/DEPLOYMENT_MODES.md) — 部署模式（本地 vs 渠道）
5. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 技术架构和接口设计
6. [`docs/VISION.md`](./docs/VISION.md) — 项目愿景和竞品分析

**贡献代码时的规则：** 讨论中产生的重要决策，必须记录到 `docs/DECISIONS.md`；
阶段性进展必须同步更新 `AGENTS.md` 的"当前阶段"部分。保持文档鲜活，就是保持协作顺畅。

## 灵感来源

本项目受 [OpenClaw](https://github.com/openclaw/openclaw) 启发。
OpenClaw 是一个出色的个人 AI 助手项目（189k+ stars），但主要面向欧美用户。
CrabCrush 致力于为中国用户提供同等水准的、更贴合本土使用习惯的 AI 助手体验。

🦞 OpenClaw = 龙虾 → 🦀 CrabCrush = 螃蟹 —— 同属甲壳纲，做你的虾兵蟹将！

## 当前状态

**项目处于 Phase 0（规划阶段）**，正在完成架构设计和工程脚手架。

欢迎关注、Star、提 Issue 或参与讨论！

## 许可证

[GPL-3.0 License](./LICENSE)

---

> *用AI写AI：你放心，我绝不手写一行代码！*
