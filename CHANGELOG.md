# 更新日志

本项目遵循语义化版本。所有重要变更记录在此文件中。

---

## [未发布]

### 2026-03-19

#### fix: 收口执行底座边界与状态同步

- 修复模型路由对通用 4xx 的误判：不再把配置类错误错误地 failover 到备选模型
- 收紧 `write_file` 的确认前预检：路径越界、扩展名不支持、缺少参数等请求不再先弹确认后失败
- 文件工具从“短扩展名白名单”调整为“文本优先 + 二进制探测”，常见代码文件不再被误拒绝
- 调整 `search_web` 的持久授权键，从“所有搜索共用一个授权”改为按搜索引擎域名集建模
- 修复 WebSocket 历史分页 `hasMore` 判定，避免剩余消息刚好等于页大小时多显示一次“加载更多”
- 修复 WebChat owner 身份判断：配置 `ownerIds` 后不再错误绑定随机 `sessionId`
- 统一计划确认 / 工具确认 / 权限请求的结构化失败原因，前端与审计可区分拒绝、超时与缺少确认能力
- 同步 CLI 版本号为 `0.1.0`

#### docs: 收口文档体系并明确职责边界

- README 收回到“项目介绍 + 上手 + 当前能力边界”，不再重复承担 AI 协作说明
- AGENTS 收回到“AI 工作入口”，只保留规则、权威来源、当前阶段、下一步和文档地图
- ROADMAP 改为聚焦当前 Phase 2a，压缩已完成阶段和远期阶段的细粒度待办
- VISION 改为聚焦产品定位、战略优先级和成功标准，不再承载过深的参考材料
- 合并 `docs/DESIGN/permissions.md` 与 `docs/DESIGN/actionable-errors.md` 为 `docs/DESIGN/execution-ux.md`
- 将 `docs/OPENCLAW_ANALYSIS.md` 移至 `docs/reference/OPENCLAW_ANALYSIS.md`
- 将 `docs/SMART_EXPERIENCE_PLAN.md` 移至 `docs/archive/SMART_EXPERIENCE_PLAN.md`
- 清理 `CHANGELOG.md` 中不再适合作为标准 changelog 的开发过程记录

### 2026-03-18

#### feat: Prompt 分层加载与工作区主入口收敛

- 新增 `prompts/` 外部覆盖目录与 `PromptRegistry` 加载器，支持按层覆盖 system / runtime / workspace / tool prompts
- 内置工具描述改为从 PromptRegistry 注入，避免工具内部继续散落维护 prompt 文案
- WebChat 新增“工作区设置”面板，可直接编辑本地 `workspace/AGENT.md` 等文件
- 首次启动会自动创建默认 `workspace/AGENT.md`，普通用户默认只需维护这一份主文件
- `USER.md / IDENTITY.md / SOUL.md` 保留为高级可选层，不再作为普通用户的默认入口

#### fix: Prompt 路径解析与工作区文件写入护栏

- 修复 `prompts.dir` 相对路径解析：现在按配置文件所在目录解析，避免更换启动目录后失效
- 修复显式配置 `prompts.dir` 时的静默回退问题：路径不存在时不再误用其他 prompts 目录
- 为 Prompt JSON 覆盖文件补充可读错误提示，用户写坏 JSON 时会明确指出具体文件
- `write_file` 对 `AGENT.md / USER.md / IDENTITY.md / SOUL.md` 的根目录误写入做大小写不敏感拦截，统一要求写到 `workspace/` 下

#### refactor: WebChat 工作台抽屉与界面清理

- 将“当前任务 / 审计回放 / 持久授权记录 / 工作区设置”统一收敛到右侧抽屉工作台，避免遮挡主聊天区
- 清理 WebChat 中遗留的旧双侧栏状态、空实现和无效样式，减少后续维护成本
- README 同步调整为“普通用户默认只维护 AGENT.md”，移除临时备忘式文案
- 全量测试、构建通过；`pnpm lint` 仅剩既有的 4 条非本次引入 warning

#### feat: 审计回放联动当前任务面板

- 为 `tool_plan / tool_call / tool_result` 审计事件补充 `summary / steps / args / result` payload，方便历史任务重建
- WebChat 现在会基于 `audit_events` 重建历史任务状态，刷新页面或切换旧会话后也能恢复最近一次执行视图
- 审计回放时间线支持按 `operationId` 选中任务，并同步切换“当前任务”面板内容
- 为 Gateway 审计回放补充回归断言，锁住任务重建所依赖的 payload 字段
- 全量测试与构建通过

### 2026-03-17

#### feat: WebChat 当前任务面板 V1

- 为 `tool_plan / confirm / tool_call` 事件补齐 `operationId` 与 `stepIndex`，把一次执行的计划、确认与步骤结果串成同一条任务链路
- WebSocket 下发的计划、确认、工具执行事件新增任务级元数据，便于 Web 控制面按步骤聚合展示
- WebChat 新增“当前任务”面板，显示任务标题、状态、步骤进度、风险摘要、授权覆盖与执行结果
- 切换会话、新建会话、加载历史、确认、执行完成等关键路径都会同步刷新任务视图，避免残留旧任务状态
- 为运行时与 Gateway 增加 `operationId / stepIndex` 回归断言，覆盖单步和多步任务场景
- 全量测试与构建通过

### 2026-03-07

#### feat: 持久授权与审计回放（Phase 2a 收口）

- 新增 `persistent` 授权范围，补齐 `once / session / persistent` 三层授权链路
- 新增 SQLite 结构化存储：
  - `permission_grants`：保存可复用的持久授权记录
  - `audit_events`：保存可查询、可回放的计划/确认/执行事件流
- 明确授权主体建模规则：
  - `webchat` 统一视为一个主体，即 `webchat:default`
  - `dingtalk` 等支持群聊/多用户的渠道，按 `渠道 + 用户` 建模，例如 `dingtalk:staff-001`
- 持久授权支持按资源复用：
  - 文件/目录类授权按路径范围复用
  - 网页访问/搜索类授权按域名范围复用
- 运行时从“仅内存 session grant”升级为“双层授权模型”：
  - `session` 仍只在当前会话有效
  - `persistent` 会写入 SQLite，并在后续会话或重启后继续复用
- 为 plan / permission / confirm / tool execution 链路补充统一 `operationId`，方便把一次执行串成完整审计轨迹
- `audit.log` 继续保留为运维/debug 日志；产品侧查询与回放改走 SQLite `audit_events`
- WebChat 新增最小版“审计回放”时间线，可按会话查看执行计划、批准/拒绝结果、权限确认、工具执行与结果
- WebChat 确认弹窗新增“永久允许”选项；钉钉支持文本确认 `允许 永久 <id>`
- 优化计划确认体验：当本轮是“单步操作”且对应资源已被 `session` 或 `persistent` 授权覆盖时，跳过重复的 `execute_plan` 确认
- 修复持久授权 `lastUsedAt` 的刷新时机：仅在真实执行复用授权时更新，不再把“计划阶段的授权覆盖判断”误记为一次使用
- 新增持久授权恢复、审计查询、WebChat 回放、钉钉永久授权解析等测试用例
- 全量测试与构建通过

#### feat: 计划审批、作用域授权与更安全的执行流

- 在工具真正执行前增加计划级审批，并把预览元数据持久化到对话历史中，供 WebChat 展示
- 扩展 confirm / request permission 流程，支持 `once` 与 `session` 作用域、执行预览、授权复用和更丰富的审计元数据
- `search_web`：外部联网搜索前必须经过运行时权限确认，与 `browse_url` 的安全策略保持一致
- 创建会话时持久化真实的 `channel / sender` 元数据，修复非 WebChat 渠道的历史归属问题
- 强化运行时文件安全：当请求依赖文件真实状态时，优先要求模型显式调用工具核实，而不是接受纯文本猜测
- 修复钉钉确认解析，正确支持 `允许 <id>` / `拒绝 <id>` / `允许 本会话 <id>`
- 增加工具计划、钉钉确认解析、联网搜索权限门控、会话元数据持久化等回归测试

#### refactor: 收敛意图启发式并补充集成覆盖

- 将文件相关意图启发式提取到 `src/tools/intent.ts`，让运行时约束和 `write_file` 护栏共享同一套实现
- 在中文之外补充常见英文文件/写入表达式的启发式匹配，减少英文请求下的误判
- 增加中文注释，明确当前启发式只是过渡方案，长期方向仍是把真实授权收敛到计划审批、执行预览和确认机制
- 增加 WebSocket 集成测试，覆盖完整的 WebChat 确认流与会话级授权复用
- 增加面向意图识别的测试，覆盖英文文件检查与英文写文件请求

#### fix: 拒绝后降级与审计/存储清理加固

- 当用户拒绝计划或工具确认时，自动降级为“只给方案、不动手”的回复模式，而不是直接中断
- 加固 `audit/logger.ts`：支持可关闭的 logger handle、初始化/运行期写失败时回退到 `stderr`，并补充 flush / fallback 测试
- 开启 SQLite 外键约束，确保 `messages.conversation_id` 在运行时真正受保护
- 在 Fastify 关闭时清理 Gateway 的限流定时器，避免长期运行或多次启动/停止后残留
- 进程退出前主动 flush 审计日志，避免缓冲内容丢失

### 2026-03-05

#### feat: 运行时权限请求（请求级）与更安全的读取

- 在工具级 `confirmRequired` 之外，新增请求级权限提示 `permission_request`
- `browse_url`：访问非 loopback URL 前先询问权限，即使 Chromium 已安装也一样生效
- `read_file` / `list_files`：默认允许读取 `tools.fileBase` 下路径；对 base 之外的绝对路径要求权限确认
- 在确认事件中加入 `kind / message` 元数据，并在 WebChat / 钉钉确认界面中展示
- 修复 `file` 工具源码中的字面量 `\\n` 残留，避免 TypeScript 解析异常
- 更新 `read_file` 绝对路径测试，使其与新的权限门控行为保持一致

### 2026-02-26

#### feat: tool confirmation + audit + safety hardening

- Implement confirmRequired handling in tool registry (exec blocked without confirmation)
- WebChat confirm modal + runtime confirm flow (WebSocket confirm/confirm_result)
- DingTalk text-based confirm flow (allow/deny + better formatting + auto-match latest)
- Basic WebSocket chat rate limiting and audit logging (audit.log)
- Harden file tool path safety on Windows + add tests

#### fix: tool streaming + write_file UX

- Stream rollback for tool calls via `stream_control` (clear speculative output)
- Persist tool call blocks even when tool confirmation is rejected
- Improve write_file intent checks and overwrite messaging
- WebChat clears speculative bubble and shows a hint when rollback happens
- Ignore stream_control in DingTalk stream handler
- Add tests for write_file intent and overwrite

#### docs: roadmap progress update

- 更新 ROADMAP：标记 WebSocket 限流与工具确认现状，移除已解决问题

#### docs: prompt dedup

- 去除示例配置与向导中的 systemPrompt，统一使用默认提示词

### 2026-02-24

#### docs: streamline documentation for AI-assisted development

- Add minimal reading paths / when-to-read guides across core docs (AGENTS/README/ROADMAP/ARCHITECTURE/VISION/DECISIONS)
- Move long ROADMAP design details into `docs/DESIGN/`
- Fix README wording to match current file tool sandbox (`tools.fileBase` relative paths only)

### 2026-02-17

#### feat: WebChat 体验优化

- 新建会话、历史分页、会话列表分页、停止按钮与工具后自然语言总结体验优化
- `list_files` 的 pattern 对文件名大小写不敏感

#### feat: write_file 内置工具（Phase 2a.3）

- 写入 `~/.crabcrush` 下文件，自动创建父目录
- 路径穿越检查、扩展名白名单
- `confirmRequired: true`（后续确认机制落地后正式生效）

### 2026-02-15

#### feat: 内置工具 read_file（Phase 2a.3 文件操作）

- `read_file`：读取 `~/.crabcrush` 下的文本文件
- 权限：owner；安全：路径限制、拒绝 `..` 穿越、扩展名白名单
- 截断：默认 8000 字符；`CRABCRUSH_FILE_BASE` 可覆盖根目录

#### fix: WebChat 前端本地化（解决国内 CDN 超时）

- 前端依赖预置到 `public/vendor/`
- `/favicon.ico`、`/vendor/*` 不再要求 token
- 普通用户克隆后即可使用，无需额外跑前端依赖脚本

#### docs: OpenClaw 分析与人格化引用

- 新增 `docs/OPENCLAW_ANALYSIS.md`（后续迁移至 `docs/reference/OPENCLAW_ANALYSIS.md`）
- AGENTS / ROADMAP 开始引用这份参考材料

### 2026-02-14

#### feat: Function Calling + 工具系统（Phase 2a.2）

- 工具类型系统、工具注册中心、模型层工具调用支持、Agent 工具执行循环、Owner 认证、`get_current_time`、WebChat 工具调用 UI 全部落地

#### feat: SQLite 对话持久化 + 滑动窗口（Phase 2a.1）

- SQLite 存储层、滑动窗口、WebChat 历史恢复落地

#### feat: WebChat Token 认证（Phase 2a.0 快速胜利）

- WebChat 访问令牌、带 token 的完整访问地址、公开 `/health`、友好错误页落地

---

## [0.1.0] — 2026-02-13 (V1 Release)

CrabCrush V1 正式发布。核心能力：WebChat + 钉钉双渠道纯对话，DeepSeek + 通义千问双模型，流式输出。

### 核心功能

- WebChat：浏览器聊天界面，Markdown 渲染 + 代码高亮 + 一键复制 + 停止生成
- 钉钉渠道：Stream 模式（不需要公网 IP），@机器人收发消息，Markdown 卡片，按用户隔离会话
- 模型适配：OpenAI 兼容适配器，支持 DeepSeek / 通义千问 / Kimi / GLM / 豆包
- 模型路由：自动匹配提供商 + 显式 `providerId/modelName` 格式
- 模型 Failover：主模型失败自动切换备选
- 费用估算：对话后显示模型名 + token 用量 + 估算费用（¥）
- CLI：`crabcrush start`、`crabcrush onboard`、`crabcrush doctor`
- 配置：YAML + 环境变量 + Zod 校验，已知提供商 `baseURL` 自动补全

### 工程

- TypeScript strict + Fastify v5 + Commander.js + Vitest
- ESLint flat config + GitHub Actions CI（Node 20 + 22）
- 24 个单元测试全部通过

### 文档

- 决策记录（DEC-001 ~ DEC-027）
- 钉钉机器人接入指南
- README“为什么不直接用 ChatGPT”对比表
