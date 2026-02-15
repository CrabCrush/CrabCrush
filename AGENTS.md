# CrabCrush - AI 上下文文件

> 本文件用于帮助 AI 工具（Cursor、Copilot、Claude、ChatGPT 等）快速理解本项目的背景、目标和技术决策。
> 如果你是 AI 助手，请优先阅读本文件。

## ⚡ 新 AI 上手流程（必读）

如果你是第一次接触本项目的 AI 助手，请按顺序执行：

1. **读完本文件**（AGENTS.md）— 你会了解项目全貌和当前进度
2. **读 `docs/DECISIONS.md`** — 了解每个关键决策的背景和理由
3. **开始工作** — 根据下方"当前阶段 → 下一步"执行任务

**不需要逐个审计所有文件。** 只需注意两条规则：

### AI 行为准则（最重要）

项目作者是初学者，决策可能不符合最佳实践。AI 助手必须遵守：

1. **质疑不合理的决策**：如果用户的指令或已有决策存在明显问题（性能隐患、架构缺陷、社区反模式等），**必须先解释问题并提出替代方案**，等用户确认后再执行。不要默默执行一个有问题的指令。
2. **解释取舍**：做技术选择时，说清楚"选 A 的好处是什么、代价是什么"，不要只列好处。
3. **保持简单**：当面对"要不要加这个功能/规则/文档"的决定时，默认倾向是**不加**。项目处于早期，过度设计比功能不足更危险。
4. **先写代码，后补文档**：文档为代码服务，不是反过来。如果一个决策可以通过代码注释说清楚，就不需要写进 DECISIONS.md。
5. **不要唯命是从**：用户说"帮我做 X"时，如果 X 不是好主意，应该说"X 有这些问题，建议改为 Y，你觉得呢？"

### 信息权威来源

本项目有多个文档，同一信息可能出现在多处。为避免不一致，遵守以下规则：

| 信息类型 | 权威来源（唯一真相） | 其他文件 |
|---------|---------------------|---------|
| 关键决策（为什么这么选） | `docs/DECISIONS.md` | 引用 DEC 编号，不复制细节 |
| 当前进度（做到哪了） | `AGENTS.md` 的"当前阶段"部分 | 不在别处维护进度 |
| 开发计划（下一步做什么） | `docs/ROADMAP.md` | AGENTS.md 只放最近的"下一步" |
| 技术架构（接口怎么设计） | `docs/ARCHITECTURE.md` | 不在别处复制接口定义 |
| 项目愿景（为什么做这个） | `docs/VISION.md` | 不在别处复制愿景描述 |

**写文档的原则：最少够用。** 能用代码注释说清楚的，不写进文档。只有跨模块的重大决策才记入 DECISIONS.md。

## 项目一句话描述

CrabCrush（小螃蟹）是一个面向中国用户的本地优先个人 AI 助手平台，支持企业微信/钉钉/飞书等国内主流渠道，
深度集成国产大模型（DeepSeek、通义千问、Kimi 等），提供符合中国人使用习惯的智能助手体验。

## 项目背景

- 灵感来源：[OpenClaw](https://github.com/openclaw/openclaw)（189k+ stars 的开源 AI 助手项目）
- 核心差异：OpenClaw 面向欧美用户（WhatsApp/iMessage/Slack），CrabCrush 面向中国用户（企业微信/钉钉/飞书）
- 命名寓意：OpenClaw 是龙虾🦞，CrabCrush 是螃蟹🦀 —— 同属甲壳纲，"做你的虾兵蟹将"
- 开源协议：GPL-3.0 License

## 核心设计原则

1. **本地优先（Local-First）**：数据存储在用户自己的设备上，隐私可控
2. **中文原生（Chinese-Native）**：不是"汉化"，而是从底层为中文场景设计
3. **渠道即入口（Channel as Entry）**：在用户已有的聊天工具上无缝使用，无需安装新 App
4. **模型无关（Model-Agnostic）**：支持国产和国际大模型，用户自由选择
5. **插件化扩展（Plugin-First）**：通过 Skills 系统扩展能力，社区可贡献

## 技术栈（已确认）

- **语言**：TypeScript（已确认，详见 DEC-002）
- **运行时**：Node.js >= 20（详见 DEC-002）
- **包管理**：pnpm（单包项目，非 monorepo，详见 DEC-002）
- **构建工具**：tsc（当前）；tsdown 待评估（DEC-023）
- **测试框架**：Vitest
- **Markdown 渲染**：markdown-it + highlight.js（WebChat 用，详见 DEC-025）
- **HTTP 框架**：Fastify v5 + @fastify/websocket + @fastify/static（详见 DEC-019）
- **前端**：单页 HTML（public/index.html）；Vue 3 + Vite 待后续迁移（DEC-020）
- **CLI**：Commander.js（详见 DEC-021）
- **配置**：YAML + 环境变量 + Zod 校验（详见 DEC-022）
- **核心架构**：Gateway（HTTP + WebSocket 控制面）+ Agent Runtime + Channel Adapters
- **模型接入**：OpenAI 兼容适配器覆盖大部分国产模型（详见 DEC-009）
- **选型理由**：项目本质是 I/O 密集型消息网关，Node.js 异步模型天然适合；全栈统一语言减少复杂度；快速原型验证

## 目录结构（实际）

```
crabcrush/
├── AGENTS.md              # AI 上下文文件（本文件）
├── README.md              # 项目介绍
├── package.json           # 项目依赖
├── tsconfig.json          # TypeScript 配置
├── crabcrush.example.yaml # 配置示例
├── docs/                  # 项目文档
│   ├── VISION.md          # 项目愿景与竞品分析
│   ├── ARCHITECTURE.md    # 技术架构 + 部署模式
│   ├── ROADMAP.md         # 开发路线图
│   └── DECISIONS.md       # 决策记录
├── guide/                 # 使用指南
│   └── dingtalk-setup.md  # 钉钉机器人接入指南
├── src/                   # 源代码
│   ├── index.ts           # CLI 入口（Commander.js）
│   ├── config/            # 配置加载（YAML + env + Zod）
│   │   ├── schema.ts      # Zod 校验 schema + KNOWN_PROVIDERS
│   │   └── loader.ts      # 配置文件查找、环境变量合并
│   ├── gateway/           # 网关核心
│   │   └── server.ts      # Fastify HTTP + WebSocket + 静态文件
│   ├── agent/             # Agent 运行时
│   │   └── runtime.ts     # 会话管理 + 多轮上下文 + 工具调用循环
│   ├── models/            # 模型适配层
│   │   ├── provider.ts    # OpenAI 兼容适配器（SSE 流式 + Function Calling）
│   │   ├── router.ts      # 模型路由器 + Failover
│   │   └── pricing.ts    # 费用估算
│   ├── storage/           # 本地持久化
│   │   └── database.ts    # SQLite 对话存储
│   ├── tools/             # 工具系统
│   │   ├── types.ts       # Tool 接口（OpenAI Function Calling 格式）
│   │   ├── registry.ts   # 工具注册中心
│   │   └── builtin/       # 内置工具
│   │       ├── index.ts
│   │       ├── time.ts    # get_current_time
│   │       ├── browser.ts # browse_url
│   │       └── search.ts  # search_web
│   ├── cli/               # CLI 子命令
│   │   ├── onboard.ts     # 向导式配置
│   │   └── doctor.ts      # 自检诊断
│   └── channels/          # 渠道适配器
│       ├── types.ts       # ChannelAdapter 接口 + ChatHandler 类型
│       └── dingtalk.ts    # 钉钉 Stream 模式
├── public/                # WebChat 前端（单页 HTML）
│   └── index.html         # 聊天界面（Markdown + 代码高亮 + 流式输出 + 工具调用展示）
└── test/                  # 测试
    ├── gateway.test.ts    # Gateway 单元测试
    ├── config.test.ts     # 配置模块测试
    ├── models.test.ts     # 模型适配器测试
    ├── storage.test.ts    # 存储层测试
    ├── tools.test.ts      # 工具系统测试
    └── channels.test.ts   # 渠道适配器测试
```

## 支持的渠道与模型

- **渠道开发顺序**：WebChat → 钉钉 → 飞书 → 企业微信 → 更多（详见 DEC-003、DEC-004、DEC-005）
- **V1 渠道**：WebChat + 钉钉（Stream 模式优先，不需要公网 IP）
- **V1 模型**：DeepSeek + 通义千问（OpenAI 兼容适配器，详见 DEC-009）
- **完整的渠道/模型清单和规划**：见 `docs/VISION.md` 3.1 和 3.2 章节（权威来源）

## V1 产品硬边界（详见 DEC-011）

V1 只做 WebChat + 钉钉两个渠道、DeepSeek + 通义千问两个模型的**纯对话**（多轮上下文 + 流式输出）。
DEC-011 定义 V1 不含工具调用；V1 发布后 Phase 2a 已部分实现（见下方当前阶段）。

## 部署模式（详见 DEC-010、docs/ARCHITECTURE.md 第五章）

本地模式（默认，零配置）+ 渠道模式（公网入口）。钉钉 Stream 模式不需要公网 IP，本地即可工作（DEC-003）。

## 关键差异化能力

中文语境理解、国内渠道深度集成、合规与安全、网络适配、中文语音、生活服务集成。
详见 `docs/VISION.md` 第三章。注意：语音和生活服务是远期能力（Phase 2/3），V1 不含。

## 开发约定

- 代码注释：复杂逻辑用中文注释，API/接口用英文
- 提交信息：英文（遵循 Conventional Commits）
- 文档：中英双语（中文为主）
- 分支策略：main（稳定）、dev（开发）、feature/*（功能分支）

## 当前阶段

**V1 已发布（v0.1.0）** — 最后更新：2026-02-14

### V1 已完成
- [x] 工程脚手架：pnpm + TypeScript strict + Fastify v5 + Commander.js + Zod + Vitest + ESLint + GitHub Actions CI
- [x] 配置系统：YAML + 环境变量 + Zod 校验，5 个国产模型 baseURL 预置
- [x] OpenAI 兼容模型适配器：SSE 流式、30s 超时、自动重试、AbortController 中断
- [x] 模型路由器 + Failover + 费用估算
- [x] Agent Runtime：会话管理 + 多轮上下文
- [x] Gateway：HTTP + WebSocket + 静态文件 + 优雅关闭
- [x] WebChat：Markdown 渲染 + 代码高亮 + 停止生成
- [x] 钉钉渠道：Stream 模式 + Markdown 卡片 + 会话隔离
- [x] CLI：`crabcrush start` / `onboard` / `doctor`
- [x] 24 条决策记录 + 完整文档体系

### Phase 2a 已完成（部分）
- [x] WebChat Token 认证（2a.0）
- [x] SQLite 对话持久化 + 滑动窗口（2a.1）
- [x] Function Calling + Owner 认证（2a.2）
- [x] 内置工具 `get_current_time`（2a.2 验证）
- [x] 内置工具 `browse_url`（2a.3 抓取网页内容）
- [x] 内置工具 `search_web`（2a.3 智能多引擎：Google/Bing/百度）

### 下一步（Phase 2a 续）
- [ ] 内置工具：浏览器截图/填表、文件操作、数据库查询（2a.3）
- [ ] Skills 框架（2a.4）
- [ ] 飞书渠道（2a.5）
- 详见 `docs/ROADMAP.md` Phase 2a

### 文档体系
| 文件 | 作用 | 何时读 |
|------|------|--------|
| `AGENTS.md`（本文件） | 项目全貌 + 当前进度 | **第一个读这个** |
| `docs/DECISIONS.md` | 决策记录（24 条当前有效决策） | **第二个读这个** |
| `docs/ROADMAP.md` | 路线图 + 每项任务的验收标准（DoD） | 想知道"下一步做什么" |
| `docs/ARCHITECTURE.md` | 技术架构 + 部署模式 | 想了解"怎么实现/怎么部署" |
| `docs/VISION.md` | 愿景、竞品分析 | 想了解"为什么做这个" |
