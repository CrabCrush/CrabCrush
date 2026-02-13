# CrabCrush 开发路线图

## 版本规划总览

```
Phase 0 (当前)   Phase 1        Phase 2a       Phase 2b       Phase 2c       Phase 3        Phase 4
规划与脚手架 →  核心引擎  →  工具+飞书  →  渠道+生活  →  管理+部署  →  高级能力  →  生态建设
```

---

## Phase 0：规划与脚手架

> 目标：完成项目规划，搭建基础工程结构，能跑通最小闭环。

### 0.1 项目规划 ✅

已完成。详见 AGENTS.md "当前阶段" 和 docs/DECISIONS.md。

### 0.2 工程脚手架 ✅

> 验收标准（DoD）：`pnpm install && pnpm build && pnpm test` 全部通过，无报错。

- [x] git init + .gitignore（Node.js + TypeScript + IDE 配置）
- [x] 初始化 pnpm 项目（单包结构，详见 DEC-002）
- [x] TypeScript 配置（strict mode）
- [ ] ESLint + Prettier 配置
- [x] Vitest 测试框架（至少一个示例测试通过）
- [x] Fastify 基础服务骨架（详见 DEC-019）
- [ ] Vue 3 + Vite 前端骨架（当前用单页 HTML，后续迁移，详见 DEC-020）
- [x] Commander.js CLI 入口（详见 DEC-021）
- [x] 配置加载（YAML + 环境变量 + Zod 校验，详见 DEC-022）
- [ ] CI/CD 基础配置（GitHub Actions：lint + test + build）
- [x] 基础目录结构

### 0.3 最小可用原型（MVP）— 本地模式 ✅

> 整体验收标准：用户执行 `crabcrush start` 后，在浏览器打开 WebChat，能和 DeepSeek 流式对话。

各子项 DoD：

- [x] **Gateway 核心**
  - DoD：HTTP 服务启动，`GET /health` 返回 `{ status: "ok" }`
  - DoD：WebSocket 连接可建立，ping/pong 正常
  - DoD：统一错误码格式（如 `{ error: { code, message } }`）
  - DoD：基础审计日志接口可记录操作（详见 DEC-013）
- [x] **Agent Runtime**
  - DoD：接收一条文本消息，调用模型，返回流式回复
  - DoD：单轮对话和多轮对话（保持上下文）均可工作
  - DoD：模型超时（>30s 无响应）有错误处理，不会挂起
- [x] **DeepSeek 模型接入**
  - DoD：流式返回正常（SSE 逐字输出）
  - DoD：超时重试（至少 1 次）
  - DoD：Token 用量统计（输入/输出 token 数）
  - DoD：API Key 缺失/无效时给出清晰错误提示
- [x] **WebChat 渠道**
  - DoD：可发送文本消息
  - DoD：可接收流式回复（逐字显示）
  - DoD：可查看当前会话历史
  - DoD：可中断正在生成的回复（stop generation）
  - DoD：Markdown 基本渲染（代码块、加粗、列表）
- [x] **CLI 基础命令**
  - DoD：`crabcrush start` 启动 Gateway + WebChat
  - ~~DoD：`crabcrush stop` 正常停止服务~~（用 Ctrl+C 优雅关闭代替）
  - DoD：启动时打印访问地址（如 `WebChat: http://localhost:18790`）

**里程碑：在浏览器里能和 DeepSeek 流式对话，支持多轮上下文。** ✅

---

## Phase 1：核心引擎

> 目标：打磨核心引擎，支持多模型，接入钉钉。V1 只做纯对话（详见 DEC-011）。

### 1.1 钉钉渠道 — 企业内部应用机器人（详见 DEC-003）
- [x] Stream 模式接入（优先，不需要公网入口）
  - DoD：本地启动 Gateway，钉钉群内 @机器人 → 收到回复，完整链路跑通
- [ ] HTTP 回调模式（备选）
  - DoD：配置 publicUrl 后，通过 webhook 回调方式同样能收发消息
- [ ] 回调签名验证
  - DoD：伪造的回调请求被拒绝（返回 401）
- [x] 消息卡片（Markdown ActionCard）
  - DoD：长文本回复以 Markdown 卡片形式展示（自动检测 Markdown 特征）
- [x] 验证渠道抽象层
  - DoD：钉钉适配器完全通过 ChannelAdapter 接口实现，无特殊硬编码
- [x] 多人 Session 隔离（详见 DEC-011）
  - DoD：同一群内不同用户 @机器人，各自上下文独立（按 senderStaffId 隔离）

### 1.2 模型层完善
- [ ] 统一模型接口 + 能力探测（详见 DEC-009）
  - DoD：ModelProvider 接口 + ModelCapabilities 定义完成，有单元测试
- [x] 通义千问接入（第二个模型）
  - DoD：通过修改配置文件（不改代码）切换到通义千问，对话正常
- [ ] 模型 Failover
  - DoD：主模型返回 500/超时时，自动切换到备选模型，用户无感知
- [ ] 费用估算
  - DoD：每次对话后显示 token 用量和估算费用

### 1.3 CLI 工具
- [ ] `crabcrush onboard` — 向导式引导配置
  - DoD：新用户跟着向导走完，配置文件自动生成
- [ ] `crabcrush doctor` — 自检诊断
  - DoD：检查 Node 版本、配置文件、API Key 有效性、网络连通性

**里程碑（= V1 发布）：在钉钉里能和 DeepSeek / 通义千问纯对话。模型切换只需改配置。**

---

## Phase 2a：工具调用与飞书接入

> 目标：加入工具调用能力，接入第三个渠道（V1.1）。

### 2a.1 工具调用 + Skills 框架（从 V1 推迟到此阶段，详见 DEC-011）
- [ ] Function Calling 协议支持（基于模型 ModelCapabilities 能力探测）
- [ ] 能力不足时的降级策略（不支持 tool_call → 提示词注入方式）
- [ ] 代码执行沙箱选型决策（Docker vs 隔离进程 vs worker_threads）
- [ ] 内置工具：网页搜索（2-3 个高频工具先行）
- [ ] Skills 框架基础：Skill 接口、加载器、生命周期管理（src/skills/）

### 2a.2 飞书渠道
- [ ] 飞书适配器（验证渠道抽象层，优先评估 WebSocket 事件订阅模式）
- [ ] 验证渠道抽象层复用度

### 2a.3 配置热加载（详见 DEC-018）
- [ ] 配置文件变更检测
- [ ] 运行时重新加载（不重启 Gateway）

**里程碑：在飞书里也能聊天，支持基础工具调用。**

---

## Phase 2b：渠道扩展与生活工具

> 目标：覆盖主流渠道，加入中国特色生活工具。

### 2b.1 更多渠道
- [ ] 企业微信适配器（需要渠道模式 + 公网入口）
- [ ] Telegram 适配器
- [ ] QQ 适配器（QQ 机器人平台）
- [ ] ~~微信个人号~~（暂缓，详见 DEC-005）

### 2b.2 中国特色工具
- [ ] 快递查询
- [ ] 天气查询（含穿衣/出行建议）
- [ ] 中国日历（农历 + 节假日 + 调休）
- [ ] 实时翻译
- [ ] 汇率查询
- [ ] 热搜聚合（微博/知乎/抖音）

### 2b.3 知识库（RAG）
- [ ] 本地向量数据库（sqlite-vss）
- [ ] 文档导入（PDF / Word / Excel / Markdown）
- [ ] 网页收藏 + 自动摘要
- [ ] 知识库问答

**里程碑：在企业微信/Telegram 里也能聊天，具备中国特色生活工具。**

---

## Phase 2c：管理界面与部署体验

> 目标：让非技术用户也能用起来。

### 2c.1 Web 管理界面
- [ ] 仪表盘（会话统计、模型用量、费用）
- [ ] 渠道管理（连接状态、配置）
- [ ] 会话查看 + 管理
- [ ] 模型配置

### 2c.2 Docker 部署与运维
- [ ] Dockerfile + docker-compose.yml
- [ ] 一键部署脚本
- [ ] 宝塔面板一键安装
- [ ] 群晖 NAS 安装指南

**里程碑：非技术用户可通过 Docker / 宝塔面板一键部署和管理。**

---

## Phase 3：高级能力

> 目标：语音、多模态、自动化等高级功能。

### 3.1 语音能力
- [ ] 语音识别（ASR）— 讯飞/阿里
- [ ] 语音合成（TTS）— 讯飞/阿里/Edge TTS
- [ ] 语音消息自动转文字
- [ ] 语音唤醒（"你好螃蟹"）
- [ ] 实时对话模式（Talk Mode）

### 3.2 多模态
- [ ] 图片理解（视觉模型）
- [ ] 图片生成（集成国产图片模型）
- [ ] 文档 OCR

### 3.3 自动化
- [ ] 定时任务（Cron）
- [ ] Webhook 触发器
- [ ] 工作流编排（简单的 IF-THEN 规则）
- [ ] 邮件监控 + 自动回复

### 3.4 更多模型接入（通过 OpenAI 兼容适配器，详见 DEC-009）
- [ ] Claude（Anthropic）
- [ ] GPT-4o / GPT-5（OpenAI）
- [ ] Gemini（Google）
- [ ] 本地模型支持（Ollama）

### 3.5 安全加固
- [ ] 内容审核模块
- [ ] 操作审计日志
- [ ] 数据加密存储
- [ ] 沙箱隔离增强

**里程碑：支持语音交互，具备自动化能力，安全机制完善。**

---

## Phase 4：生态建设

> 目标：构建社区和生态。

### 4.1 技能生态
- [ ] 技能开发 SDK
- [ ] 技能商店（CrabHub？）
- [ ] 社区技能贡献机制

### 4.2 多 Agent
- [ ] Agent 间通信
- [ ] 角色分工（助手、翻译、程序员、...）
- [ ] 多 Agent 协作工作流

### 4.3 桌面/移动端
- [ ] Electron 桌面客户端（可选）
- [ ] 移动端 App 或小程序（可选）

### 4.4 企业版能力
- [ ] 多用户支持
- [ ] 权限管理（RBAC）
- [ ] 团队知识库
- [ ] 使用量报表

---

## 技术债务与持续改进

以下事项贯穿所有阶段，持续进行：

- **测试覆盖率**：核心模块 > 80%
- **文档完善**：API 文档、使用指南、开发者文档
- **性能优化**：响应延迟、内存占用、并发能力
- **国际化**：虽然主打中文，但保持 i18n 能力
- **无障碍**：Web UI 符合 WCAG 标准

---

## 开源协作

- **贡献指南**：CONTRIBUTING.md
- **Issue 模板**：Bug Report / Feature Request / Channel Request
- **PR 规范**：Conventional Commits + 代码审查
- **社区渠道**：GitHub Discussions + 微信群/QQ群
