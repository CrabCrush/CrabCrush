# 更新日志

本项目遵循语义化版本。所有重要变更记录在此文件中。

---

## [未发布]

### 2026-02-13

#### feat: CLI tools - crabcrush onboard + doctor

新用户引导和自检诊断。

- **`crabcrush onboard`** — 向导式配置：
  - 交互式选择模型提供商（DeepSeek / 通义千问 / Kimi / GLM / 豆包）
  - 输入 API Key（附带各平台获取链接）
  - 选择模型（提供默认值）
  - 可选配置钉钉机器人
  - 自动生成 `crabcrush.yaml`
- **`crabcrush doctor`** — 自检诊断：
  - Node.js 版本检查（>= 20）
  - 配置文件检测（YAML 文件 / 环境变量）
  - 模型配置校验（API Key 预览）
  - API 连通性测试（10s 超时，区分 401 / 网络错误）
  - 渠道状态汇总
  - 所有检查通过 / 有问题的清晰反馈

#### feat: model router, failover, cost estimation

智能模型路由 + 自动 Failover + 费用估算。

- **模型路由器**（`src/models/router.ts`）：
  - `agent.model` 自动匹配正确的提供商（`qwen-max` → qwen，`deepseek-chat` → deepseek）
  - 支持显式格式 `providerId/modelName`（如 `qwen/qwen-max`）
  - 修复同时配多个提供商时请求发错 API 的问题
- **Model Failover**：
  - 新增 `agent.fallbackModels` 配置
  - 主模型 5xx / 超时 / 网络错误时自动切换备选模型，用户无感知
  - 4xx 错误（API Key / 余额问题）不触发 Failover
  - 启动日志显示完整 Failover 链
- **费用估算**（`src/models/pricing.ts`）：
  - 内置 DeepSeek / 通义千问 / Kimi / GLM 主要模型定价
  - WebChat 每次对话后显示：模型名 | token 用量 | 估算费用
  - 修复 WebChat 在 usage 为空时不显示模型名的 bug
- 所有已配置的提供商统一初始化，不再只用第一个
- 新增 12 个测试（ModelRouter 8 个 + 费用估算 3 个 + 原有 1 个），共 24 个

#### chore: review, bug fixes, docs update

项目全面审查 + 修复 + 文档同步。

- **Bug 修复：**
  - `dingtalk.ts`：`stop()` 后消息到达不再崩溃（添加 null guard）
  - `dingtalk.ts`：短消息日志不再多余追加 `...`
  - `config/loader.ts`：用户指定 `-c` 不存在的路径时报错，而非静默忽略
- **文档同步：**
  - `AGENTS.md`：当前阶段从 Phase 0.3 更新到 Phase 1，技术栈改为实际值，目录结构改为实际结构
  - `ROADMAP.md`：Phase 0.2 / 0.3 / 1.1 已完成项标记为 `[x]`
  - `README.md`：精简钉钉教程为链接，更新导航栏
- **新增：**
  - `CHANGELOG.md`：更新日志
  - `guide/dingtalk-setup.md`：钉钉机器人接入完整指南（含 FAQ）
- **测试：** 新增配置路径校验测试，13/13 全部通过

#### feat: Phase 1 - DingTalk Stream adapter + channel abstraction (`fc4c137`)

钉钉渠道接入，第一个外部渠道。

- 新增 `ChannelAdapter` 接口（`src/channels/types.ts`），统一渠道抽象
- 新增钉钉 Stream 适配器（`src/channels/dingtalk.ts`）
  - 通过 `dingtalk-stream` SDK 长连接，不需要公网 IP
  - 收到 @机器人 消息后调用 Agent，通过 sessionWebhook 回复
  - 按 `senderStaffId` 隔离会话，同群不同人独立上下文
  - 自动检测 Markdown 特征，长文本用 Markdown 格式回复
- 配置系统支持钉钉（`channels.dingtalk` + 环境变量 `CRABCRUSH_DINGTALK_*`）
- CLI 启动时自动连接钉钉（如已配置）
- 新增渠道相关测试（`test/channels.test.ts`）

#### chore: add ws dev dependency (`37b47db`)

- 添加 `ws` + `@types/ws` 为 dev 依赖，用于 WebSocket E2E 测试

#### docs: update progress to Phase 0.3 MVP (`ee172c5`)

- 更新 `AGENTS.md` 当前阶段为 Phase 0.3 MVP

#### feat: complete Phase 0.3 MVP features (`11db27b`)

WebChat 和核心引擎的完善，从"能跑"到"好用"。

- WebSocket 支持 `stop` 消息 + `AbortController` 中断生成
- WebSocket ping/pong 保活 + 优雅关闭（SIGINT/SIGTERM）
- 模型适配器增强：30s 超时、5xx 自动重试 1 次、友好错误提示（401/402/429）
- Agent Runtime 增加系统提示词注入 + `maxTokens` 控制
- WebChat 全面升级：
  - Markdown 渲染（markdown-it + highlight.js CDN）
  - 代码块语法高亮 + 复制按钮
  - 停止生成按钮
  - 流式打字光标效果
  - session 持久化（localStorage）
  - token 用量显示

#### feat: MVP core - config, model adapter, agent runtime, WebChat (`4d2f1e9`)

核心功能首次实现，从骨架到最小可用。

- 配置系统：YAML 文件 + 环境变量 + Zod 校验
  - 5 个国产模型 baseURL 预置（deepseek / qwen / kimi / glm / doubao）
  - 环境变量 `CRABCRUSH_<PROVIDER>_API_KEY` 自动注入
- OpenAI 兼容模型适配器（`src/models/provider.ts`）：SSE 流式解析
- Agent Runtime（`src/agent/runtime.ts`）：会话管理 + 多轮上下文
- Gateway WebSocket 端点（`/ws`）：chat 消息收发 + 流式 chunk 推送
- WebChat 首版（`public/index.html`）：暗色主题、发送消息、接收流式回复
- CLI `crabcrush start` 命令：加载配置 → 初始化模型 → 启动 Gateway
- 新增配置和模型测试

#### feat: initial project scaffolding (`0244d52`)

项目从零开始搭建。

- 项目文档体系：AGENTS.md / DECISIONS.md / ROADMAP.md / ARCHITECTURE.md / VISION.md
- 技术选型：TypeScript + Node.js + pnpm + Fastify v5 + Vitest
- 基础 Gateway 骨架：Fastify 服务 + `/health` 端点
- CLI 入口：Commander.js
- TypeScript strict mode 配置
- GPL-3.0 License
