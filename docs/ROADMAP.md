# CrabCrush 开发路线图

## 阅读指南（给 AI / 开发者，省 token）

- **日常开发**：只需要读“当前 Phase（目前是 Phase 2a）”相关小节；其他 Phase 仅在要做长期规划时再看。
- **遇到 DEC 引用**：不要通读 `DECISIONS.md`，只按 `DEC-xxx` 定位到对应条目即可。
- **设计细节**：ROADMAP 只保留目标/DoD；较长的交互/协议设计下沉到 `docs/DESIGN/`，按需阅读。

## 版本规划总览

```
Phase 0 + 1 ✅        Phase 2a (当前)        Phase 2b         Phase 2c         Phase 3        Phase 4
规划与脚手架 →  核心引擎  →  可控执行底座  →  高价值工具闭环  →  任务体验+部署  →  渠道与高级能力  →  生态建设
```

### 版本与里程碑对应

| 版本 | 里程碑 | 对应 Phase |
|------|--------|------------|
| v0.1.0 | V1 发布：WebChat + 钉钉纯对话 | Phase 0 + Phase 1 ✅ |
| v0.2.0 | 可控执行底座：权限、确认、审计、预览 | Phase 2a |
| v0.3.0 | 高价值工具闭环：浏览器/数据库/受限执行 | Phase 2b |
| v0.4.0 | 任务体验 + 部署体验 | Phase 2c |
| v0.5.0 | 渠道扩展 + 知识/语音 | Phase 3 |

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
- [x] ESLint 配置（flat config，@typescript-eslint）
- [x] Vitest 测试框架（至少一个示例测试通过）
- [x] Fastify 基础服务骨架（详见 DEC-019）
- [ ] Vue 3 + Vite 前端骨架（当前用单页 HTML，后续迁移，详见 DEC-020）
- [x] Commander.js CLI 入口（详见 DEC-021）
- [x] 配置加载（YAML + 环境变量 + Zod 校验，详见 DEC-022）
- [x] CI/CD 基础配置（GitHub Actions：lint + test + build，Node 20 + 22）
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
- [ ] HTTP 回调模式（备选）→ 推迟到 Phase 3（飞书/企微需要时再做）
- [ ] 回调签名验证 → 推迟到 Phase 3（依赖 HTTP 回调）
- [x] 消息卡片（Markdown ActionCard）
  - DoD：长文本回复以 Markdown 卡片形式展示（自动检测 Markdown 特征）
- [x] 验证渠道抽象层
  - DoD：钉钉适配器完全通过 ChannelAdapter 接口实现，无特殊硬编码
- [x] 多人 Session 隔离（详见 DEC-011）
  - DoD：同一群内不同用户 @机器人，各自上下文独立（按 senderStaffId 隔离）
- [x] 钉钉 Block Streaming（借鉴 OpenClaw）
  - DoD：钉钉回复不再等整条生成完成；按块分片发送，支持字符阈值与定时 flush
  - 备注：当前已通过 `BlockStreamer` 以通用 helper 形式落地，后续飞书/企微可复用

### 1.2 模型层完善
- [x] 模型路由器（自动匹配提供商 + 显式 `providerId/modelName` 格式）
  - DoD：`agent.model: qwen-max` 自动路由到 qwen 提供商，多提供商不再发错 API
- [ ] 统一模型接口 + 能力探测 → 推迟到 Phase 2a.2（工具调用需要能力探测，纯对话不需要）
- [x] 通义千问接入（第二个模型）
  - DoD：通过修改配置文件（不改代码）切换到通义千问，对话正常
- [x] 模型 Failover
  - DoD：主模型返回 500/超时时，自动切换到备选模型，用户无感知
- [x] 费用估算
  - DoD：每次对话后显示 token 用量和估算费用（WebChat 显示模型名 + tokens + 费用）

### 1.3 CLI 工具
- [x] `crabcrush onboard` — 向导式引导配置
  - DoD：新用户跟着向导走完，配置文件自动生成
- [x] `crabcrush doctor` — 自检诊断
  - DoD：检查 Node 版本、配置文件、API Key 有效性、网络连通性

**里程碑（= V1 发布）：在钉钉里能和 DeepSeek / 通义千问纯对话。模型切换只需改配置。**

---

## Phase 2a：可控执行底座（让 CrabCrush 先“安全地能干活”）

> 目标：先把“执行风险可控”做扎实，再继续扩工具和渠道。详见 DEC-026、DEC-034、DEC-035。
> 核心逻辑：如果没有权限边界、执行预览和审计回放，“能干活”就会退化成“能闯祸”。
> **版本节奏**：2a 聚焦权限与执行底座；高价值工具闭环放到 2b。

### 2a.0 快速胜利（小改动、大价值）
- [x] WebChat Token 认证（当前任何人知道 IP+端口就能访问，安全隐患）
- [ ] API 响应缓存（相同问题不重复调 API，省 token 省钱）
- [x] 审计日志持久化（`audit.log` + SQLite `audit_events`）
- [ ] WebSocket 连接数限制与入口级限流配置化

### 2a.1 本地对话持久化 + 上下文管理（兑现“本地优先”承诺）

存储和发送是分开的：SQLite 存所有历史（持久化），API 只发精选上下文（省 token）。

- [x] SQLite 存储对话历史（`~/.crabcrush/data/conversations.db`）
- [x] Gateway 重启后恢复历史会话（WebChat 重连时 loadHistory）
- [x] WebChat 显示历史对话列表（多会话切换，侧边栏点击切换）
- [x] WebChat 消息历史分页（滚动到顶加载更早消息，limit 100 + offset）
- [x] WebChat 会话列表分页（加载更多）
- [ ] 对话搜索（按关键词 / 时间范围）
- [ ] 对话导出（JSON / Markdown）
- [x] 上下文窗口管理（替代当前“全发”策略）：
  - [x] 滑动窗口：只发最近 N 轮（默认 40 条 = 20 轮，可配置 `agent.contextWindow`）
  - [ ] Token 预算：设定上下文上限（如 8000 token），按预算裁剪
  - [ ] 摘要压缩（可选）：旧对话自动压缩为一段摘要，保留关键信息

### 2a.2 Function Calling + 安全沙箱（必须同步上线，详见 DEC-026、DEC-028）
- [x] Function Calling 协议支持（OpenAI 兼容格式）
- [x] 能力不足时的降级策略（不支持 tool_call → 明确退回纯文本方案模式）
- [x] Owner 认证机制（`ownerIds` 配置，未配置时默认所有人是 owner）
- [ ] 受限执行路线与沙箱边界决策：明确“预定义修复动作 / 宿主机受限命令 / 真正代码沙箱”三层边界，并确认是否需要调整 DEC-026
- [ ] 数据安全防线（DEC-028）：工具结果脱敏、列白名单、确认机制
- [x] **安全可控原则（DEC-034）**：当前已上线的高风险内置工具均走 `confirmRequired`（工具级）或 `permission_request`（请求级）确认流程
- [x] **运行时权限请求**（Cursor 式）：执行前主动询问「是否允许访问 XX」「是否允许安装 XX」（设计见 [`docs/DESIGN/permissions.md`](./DESIGN/permissions.md)）
- [x] 权限作用域：一次授权 / 会话内授权 / 永久授权到指定目录、域名、数据库
- [x] 执行预览：展示即将访问的路径、域名、命令、写入目标，再执行
- [x] 拒绝后降级：用户拒绝执行时，自动退回“只给方案，不动手”
- [x] 审计回放：记录每次申请、批准、拒绝和最终执行结果

> 说明：该部分属于“交互/协议设计”，已下沉到 `docs/DESIGN/permissions.md`，避免路线图过长；ROADMAP 这里仅保留目标与待办。

### 2a.3 执行体验（把“确认”做成产品能力）
- [x] WebChat 执行工作台基础版：当前任务 / 审计回放 / 授权中心（会话授权 + 长期授权） / 工作区设置
- [ ] WebChat 任务确认面板增强：比当前确认弹窗更清楚地展示风险和影响范围
- [x] 多步任务执行摘要基础版：模型先给 plan，再逐步申请权限和执行，WebChat 可回放最近任务状态
- [ ] 工具错误“可操作”化：缺依赖、缺权限、越界访问时给出下一步动作（优先做预定义 repair action，不直接演变成任意命令执行入口）

### 2a.4 当前已具备的工具基座
- [x] 浏览器控制（Playwright Core：抓取网页内容 `browse_url`）
- [x] 文件操作：`read_file`（读取 ~/.crabcrush 下文本文件，默认截断 8000 字符）
- [x] 文件操作：`list_files`（查找/列出文件，支持 path、pattern、recursive）
- [x] 文件操作：`write_file`（写入 fileBase 下文件，自动创建父目录；高危写入走 confirmRequired + 执行预览）
- [x] 网页搜索（`search_web`：Google/Bing/百度 智能选择）

### 2a.5 配置热加载（详见 DEC-018）
- [ ] 配置文件变更检测
- [ ] 运行时重新加载（不重启 Gateway）

**里程碑：用户可以在本地 Web 控制面发起一个多步任务，看到计划、逐步授权、查看审计记录，并安全完成执行。**

---

## Phase 2b：高价值工具闭环

> 目标：在可控执行底座之上，把最有壁垒的工具做深，而不是先铺很多低壁垒功能。

### 2b.1 浏览器能力深化
- [ ] 浏览器控制：截图、填表
- [ ] 页面元素定位与操作回执
- [ ] 浏览器会话复用（同一任务内保持登录态/上下文）

### 2b.2 数据与本地环境
- [ ] 文件操作（续）：文档解析
  - **设计时必读**：DEC-030 — 文件单独存、消息存引用；大内容不塞进 `messages.content`；可选的消息长度限制与自动清理
- [ ] 数据库查询（MySQL/PostgreSQL/SQLite，默认只读，列白名单）
- [ ] 受限执行 v0：预定义修复动作 / 安装动作（如 `install_chromium`），只允许白名单 action，不开放任意命令
- [ ] 受限执行 v1：若允许宿主机命令执行，则仅开放 owner + 始终确认 + 执行预览（shell / cwd / command）+ 超时 + 输出截断 + 禁止交互/常驻进程
- [ ] 受限执行 v1：命令边界先限制在 workspace / allowlist 场景，不做自动安装、自由重试、模型自行改写命令链
- [ ] 受限执行 v2：真正的代码沙箱（Python/JS/Shell），与宿主机命令执行分层设计，不混为一个工具

> 说明：这里故意把“修复动作”“宿主机命令”“代码沙箱”拆成三层。它们的风险边界、确认方式、失败兜底都不同；如果一开始混成“exec 一把梭”，后面很容易变成又难控又难审计的脏代码。

### 2b.3 Skills 框架（详见 DEC-029）

> 策略：技能建立在稳定的执行原语之上；先把内置工具打磨稳，再开放可安装技能。

- [ ] Skill 接口、加载器、生命周期管理（src/skills/）
- [ ] `crabcrush skills install <name>` + `crabcrush skills configure <name>` 命令
- [ ] 内置技能包：2-3 个示例技能（如 database、browser）
- [ ] 用户自定义技能目录：~/.crabcrush/workspace/skills/

### 2b.4 人格化与工作区（借鉴 OpenClaw，详见 DEC-032）✅

> 目标：AI 有名字、知道如何称呼用户、可配置语气性格，首次对话主动询问并持久化。
> 实现时可参考 [OpenClaw 实现分析](OPENCLAW_ANALYSIS.md)（规则/记忆/人格化与 Token 策略）。

- [x] 工作区目录 `~/.crabcrush/workspace/`：IDENTITY.md（AI 名字/emoji/语气）、USER.md（用户名字/称呼）、SOUL.md（性格边界，可选）
- [x] 系统提示词组装：每次对话前注入工作区文件内容（替代或补充 `agent.systemPrompt`）
- [x] Bootstrap 首次会话：工作区为空时主动问询人格；用户没回答可后续再问；用户拒绝则用默认值
- [ ] **待优化**：当前人格化不够智能，后续需改进（自然过渡、时机把握、记忆沉淀等）

**里程碑：用户可以安全地完成“查资料 → 打开网页 → 读写文件 / 查库 / 受限执行”的闭环任务。**

---

## Phase 2c：任务体验与部署体验

> 目标：让非技术用户也能理解、确认和使用执行能力。

### 2c.1 Web 管理界面 / 控制台
- [ ] 仪表盘（会话统计、模型用量、费用）
- [ ] 权限中心（目录/域名/数据库授权管理）
- [ ] 执行记录与审计回放
- [ ] 任务计划 / 执行摘要视图
- [ ] 渠道管理（连接状态、配置）
- [ ] 会话查看 + 管理
- [ ] 模型配置

### 2c.2 Docker 部署与运维
- [ ] Dockerfile + docker-compose.yml
- [ ] 一键部署脚本
- [ ] 宝塔面板一键安装
- [ ] 群晖 NAS 安装指南

**里程碑：非技术用户可以理解一个任务会做什么、批准哪些步骤、并在部署后持续管理权限和审计记录。**

---

## Phase 3：渠道扩展与高级能力

> 目标：在执行底座和主控制面成熟后，再扩展渠道和高级能力。

### 3.1 渠道扩展
- [ ] 飞书适配器（验证渠道抽象层复用度）
- [ ] 企业微信适配器（需要渠道模式 + 公网入口）
- [ ] Telegram 适配器
- [ ] QQ 适配器（QQ 机器人平台）
- [ ] ~~微信个人号~~（暂缓，详见 DEC-005）

### 3.2 知识与语音
- [ ] 本地向量数据库（sqlite-vss）
- [ ] 文档导入（PDF / Word / Excel / Markdown）
- [ ] 网页收藏 + 自动摘要
- [ ] 知识库问答
- [ ] 语音识别（ASR）— 讯飞/阿里
- [ ] 语音合成（TTS）— 讯飞/阿里/Edge TTS
- [ ] 语音消息自动转文字
- [ ] 语音唤醒（"你好螃蟹"）
- [ ] 实时对话模式（Talk Mode）

### 3.3 多模态
- [ ] 图片理解（视觉模型）
- [ ] 图片生成（集成国产图片模型）
- [ ] 文档 OCR

### 3.4 自动化
- [ ] 定时任务（Cron）
- [ ] Webhook 触发器
- [ ] 工作流编排（简单的 IF-THEN 规则）
- [ ] 邮件监控 + 自动回复

### 3.5 更多模型接入（通过 OpenAI 兼容适配器，详见 DEC-009）
- [ ] Claude（Anthropic）
- [ ] GPT-4o / GPT-5（OpenAI）
- [ ] Gemini（Google）
- [ ] 本地模型支持（Ollama）

### 3.6 安全加固
- [ ] 内容审核模块
- [ ] 数据加密存储
- [ ] 沙箱隔离增强

**里程碑：在保持可控执行体验不退化的前提下，扩展更多入口与高级能力。**

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

> 说明：这些能力全部建立在 Phase 2 的可控执行底座稳定之后；在此之前不作为主线。

---

## 技术债务与持续改进

以下事项贯穿所有阶段，持续进行：

- **测试覆盖率**：核心模块 > 80%
- **文档完善**：API 文档、使用指南、开发者文档
- **性能优化**：响应延迟、内存占用、并发能力
- **国际化**：虽然主打中文，但保持 i18n 能力
- **无障碍**：Web UI 符合 WCAG 标准

### 运维与安全待办（Phase 2 优先）

| 项目 | 现状 | 规划 |
|------|------|------|
| **Gateway 请求限流** | WebSocket 基础限流已实现 | 规则配置化与覆盖更多入口（Phase 2a） |
| **持久化日志** | `~/.crabcrush/logs/audit.log` + SQLite `audit_events` 已实现 | 后续补管理界面与导出能力 |
| **危险操作确认** | confirmRequired / permission_request / 范围授权 / 审计回放已基础实现 | 继续收口权限中心与后续新增工具的一致性 |
| **WebSocket 连接数限制** | 无 | 防止资源耗尽，Phase 2a |

---

## 已知问题（待后续解决）

| 问题 | 现象 | 期望行为 | 备注 |
|------|------|----------|------|
| **search_web 工具调用体验** | 用户说「搜下明天天气」时，模型直接调用 search_web，查完才问地点；且只返回搜索引擎默认前几条，缺乏思考 | 提案式沟通：先问「请问您想查询哪个城市的天气？」再查；查前应思考搜索词（城市+日期+天气） | 涉及模型行为引导；或等专用天气工具 |

---

## 开源协作

- **贡献指南**：CONTRIBUTING.md
- **Issue 模板**：Bug Report / Feature Request / Channel Request
- **PR 规范**：Conventional Commits + 代码审查
- **社区渠道**：GitHub Discussions + 微信群/QQ群
