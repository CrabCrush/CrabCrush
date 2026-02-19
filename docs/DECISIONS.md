# CrabCrush 决策记录

> 本文件记录项目的**当前有效决策**，每条只保留最新结论。
> 历史变更通过 git 追溯，不在本文件中保留被推翻的旧版本。
> 其他文件通过 DEC 编号引用本文件，不复制决策细节。

---

## DEC-001：项目命名

- **决策**：项目命名为 **CrabCrush**（原名 OpenCrab，因名称被占用而更名）
- **Slogan**："做你的虾兵蟹将"
- **理由**：灵感来源 OpenClaw（龙虾🦞），CrabCrush（螃蟹🦀）延续甲壳纲主题；"Crush"暗示碾碎任务/难题，契合 AI 助手定位；"虾兵蟹将"谦逊有趣，寓意"为你服务"。

---

## DEC-002：技术选型 — TypeScript / Node.js

- **决策**：TypeScript + Node.js >= 20 + pnpm（单包项目）
- **候选**：TypeScript、Java、Go、Python
- **理由**：
  1. 项目本质是消息中转 + API 调用 + Web 界面，Node.js 异步 I/O 天然适合
  2. 全栈统一语言（Gateway + Web UI + WebChat），减少上下文切换
  3. 原型速度快，AI 辅助编码效果好
  4. SSE / WebSocket 流式处理在 Node.js 中非常自然
- **放弃其他方案的核心原因**：
  - Java：样板代码多、JVM 内存重、前端仍需 JS/TS
  - Go：Web 生态弱、国内平台 SDK 少
  - Python：I/O 密集场景不佳、类型安全弱
- **风险与缓解**：Node.js 生态碎片化 → 用 pnpm 严格管理依赖 + TypeScript strict mode + 完善测试
- **Node.js >= 20（而非 22）**：20 是国内服务器最广泛部署的 LTS 版本，降低安装门槛
- **单包项目（而非 monorepo）**：初期代码量小，monorepo 反而增加复杂度。当 Web UI 需要独立部署时（预计 Phase 2/3）再迁移

---

## DEC-003：渠道顺序与钉钉机器人类型

- **决策**：渠道开发顺序为 WebChat → 钉钉 → 飞书 → 企业微信；钉钉使用**企业内部应用机器人**，**Stream 模式优先**
- **渠道顺序理由**：
  - WebChat 零外部依赖，方便调试
  - 钉钉企业市场份额最大，开放平台成熟
  - 飞书排第二：API 设计好，验证渠道抽象层
  - 企业微信排第三：API 有历史包袱但与微信生态打通
  - 策略：**一个渠道做到位再做下一个，不并行铺开**
- **钉钉机器人类型选择**：
  | 类型 | API 能力 | 适合场景 |
  |------|---------|---------|
  | 群自定义机器人（Webhook） | 只能发，不能收 | 通知推送，不适合对话 |
  | **企业内部应用机器人** | **收发双向，完整 API** | **对话场景首选** |
- **Stream 模式是关键发现**：
  - 钉钉 Stream 模式是客户端主动连接钉钉服务器（类似 WebSocket），**不需要公网 IP**
  - 这意味着钉钉在本地电脑上就能工作，大幅降低部署门槛
  - V1 优先实现 Stream 模式，HTTP 回调作为备选

---

## DEC-004：务实的开发策略

- **决策**：逐步验证，每一步都要能跑通，不做半成品
- **开发顺序**：
  1. 工程脚手架 + Gateway 骨架
  2. DeepSeek 一个模型跑通
  3. WebChat 网页聊天
  4. 钉钉适配器
  5. 统一模型接口 + 第二个模型
  6. 飞书适配器
  7. 再扩展

---

## DEC-005：微信个人号 — 暂缓

- **决策**：近期不做
- **理由**：微信对逆向方案打击严厉（封号风险）、第三方库维护不稳定、企业微信是更稳定的替代
- **未来**：微信官方开放 API 或社区出现成熟方案时重新评估

---

## DEC-006：文档规则

- **决策**：文档只记录当前真相，不记录变更历史（历史通过 git 追溯）
- **核心原则**：
  1. DECISIONS.md 只保留当前有效结论，不追加旧版本
  2. 同一信息只在一个地方写详情，其他地方用 DEC 编号引用
  3. 能用代码注释说清楚的，不写进文档文件
  4. **判断标准**：如果一个修改需要同步改 3 个以上文件 → 说明文档结构有问题，必须精简

---

## DEC-009：模型层 — OpenAI 兼容适配器 + 能力探测

- **决策**：使用通用 `OpenAICompatibleProvider` 适配器 + `ModelCapabilities` 能力声明
- **理由**：DeepSeek、通义千问、Kimi、智谱 GLM、豆包的 API 均兼容 OpenAI 格式，差异通过配置解决
- **兼容度约 70%，剩余差异处理**：
  - 每个模型配置声明能力集（streaming / tool_call / json_mode / vision / maxContextTokens）
  - Agent Runtime 根据能力集调整行为（如不支持 tool_call → 降级为提示词注入）
  - 例外：文心一言（ERNIE）鉴权特殊，可能需要独立适配器
- **目录结构**：`src/models/` 下不按厂商分子目录，用 `openai-compatible.ts` + `configs/` 配置文件

---

## DEC-010：两种部署模式

- **决策**：本地模式（默认）+ 渠道模式
- **本地模式**：Gateway 绑定 localhost，支持 WebChat。`crabcrush start` 零配置启动
- **渠道模式**：支持钉钉等外部渠道。公网入口方案：云服务器 / frp / ngrok / Tailscale Funnel
- **重要：钉钉 Stream 模式不需要公网入口**（见 DEC-003），本地模式下也能接入钉钉
- **设计原则**：Gateway 核心代码不区分模式，差异只在配置层
- **详细设计**：见 `docs/ARCHITECTURE.md` 第五章"部署模式"

---

## DEC-011：V1 产品硬边界

- **决策**：V1 只做纯对话，不含工具调用和 Skills 框架
- **V1 包含**：
  - WebChat + 钉钉（两个渠道）
  - DeepSeek + 通义千问（两个模型）
  - 纯对话：多轮上下文 + 流式输出
  - 单 Gateway 实例 + 单套配置，多人各自独立 Session（按 sender ID 隔离）
  - 基础审计日志
  - CLI：start / stop / onboard / doctor
- **V1 不包含**：
  - 工具调用（Function Calling）、Skills 框架 → Phase 2
  - 语音、生活服务工具、知识库/RAG → Phase 2/3
  - 技能商店、多用户配置/RBAC → Phase 4
  - 飞书/企微渠道 → V1.1
- **"单用户"的含义**：
  - 单 Gateway 实例，单套配置（一组 API Key、一套渠道配置）
  - 多人在同一钉钉群 @机器人时，每人一个独立 Session
  - 不支持：不同人用不同模型/API Key、用户注册/登录、权限管理
- **成功标准**：
  - 本地模式：5 分钟内安装并与 DeepSeek 对话
  - 钉钉接入：15 分钟内配置完成
  - 流式首字节延迟 < 500ms
  - 模型切换只需改配置，不改代码

---

## DEC-012：目录结构（skills 与 extensions）

- **决策**：
  - `src/skills/` — 技能框架代码（Skill 接口、加载器），Phase 2 实现
  - `skills/` — 内置技能包（预装技能），Phase 2 实现
  - `~/.crabcrush/workspace/skills/` — 用户自定义技能（运行时目录，不在仓库中）
  - `extensions/` — **已移除**，与 skills 职责重叠。如后续需要，Phase 4 再定义

---

## DEC-013：合规策略 — 预埋接口，不过度设计

- **决策**：从第一天起预留 AuditLog 接口，但不建立完整合规体系
- **当前做什么**：统一审计日志接口（谁/何时/做了什么）、模型调用记录（费用审计）
- **不做**：云端内容审核 API、详细合规文档（推到有企业用户需求时）

---

## DEC-018：配置热加载推迟

- **决策**：Phase 0/1 只做启动时加载配置，配置热加载推到 Phase 2+
- **理由**：热加载涉及文件监听、变更通知、状态一致性，Phase 0/1 配置变更频率低，重启即可

---

## DEC-019：HTTP 框架 — Fastify

- **决策**：Gateway HTTP 服务使用 **Fastify v5**，WebSocket 使用 **@fastify/websocket**
- **候选**：Express、Fastify、Koa、Hono
- **理由**：
  1. 性能优异：比 Express 快约 2-3 倍，适合消息网关的高并发 I/O 场景
  2. 一等公民 TypeScript 支持：内置类型推断，与项目技术栈（DEC-002）契合
  3. 插件体系成熟：`@fastify/websocket`、`@fastify/cors`、`@fastify/static` 等覆盖 Gateway 全部需求
  4. JSON Schema 验证内置：请求/响应校验零额外依赖，对 API 质量有利
  5. 生产级稳定性：被多个大规模项目使用
- **放弃其他方案的核心原因**：
  - Express：性能差、回调式 API、TypeScript 支持弱、中间件模型老旧
  - Koa：生态不如 Fastify、WebSocket 方案需额外拼装
  - Hono：轻量优秀但 Node.js 服务端 WebSocket 集成不够成熟、社区规模较小

---

## DEC-020：WebChat 前端 — Vue 3 + Vite

- **决策**：WebChat 前端使用 **Vue 3**（Composition API）+ **Vite** 构建
- **候选**：Vue 3、React、Svelte、纯 HTML/JS
- **理由**：
  1. 中国开发者生态最大：Vue 在国内社区和招聘市场占主导地位，与"面向中国用户"定位一致
  2. Vite 零配置启动：与 Vue 同一作者，开发体验一流，热更新极快
  3. TypeScript 原生支持：Composition API + `<script setup lang="ts">` 类型安全好
  4. 打包体积小：Vue 3 tree-shaking 后核心 ~16KB gzip，比 React 小
  5. 单包项目兼容：`ui/` 目录独立 vite.config，build 输出到 `dist/ui/`，Gateway 通过 `@fastify/static` 提供静态服务
- **放弃其他方案的核心原因**：
  - React：国内生态不如 Vue、JSX 学习曲线对社区贡献者不友好
  - Svelte：生态尚小、国内社区弱
  - 纯 HTML/JS：MVP 看似简单，但流式渲染、Markdown 渲染、状态管理很快会失控
- **UI 组件库**：V1 暂不引入重型组件库，用 CSS 变量 + 手写组件保持轻量。后续可引入 Naive UI 或 Element Plus
- **构建集成**：
  - 开发时：`vite dev`（独立端口，代理 Gateway API）
  - 生产时：`vite build` → `dist/ui/` → Gateway 静态服务
  - `package.json` 中 `build` 脚本统一编排后端 + 前端构建

---

## DEC-021：CLI 框架 — Commander.js

- **决策**：CLI 工具使用 **Commander.js**
- **候选**：Commander.js、Yargs、Citty（UnJS）、Oclif
- **理由**：
  1. 最广泛使用的 Node.js CLI 框架，API 简洁直观
  2. TypeScript 支持好，类型定义完整
  3. 轻量：零运行时依赖
  4. 学习成本低：社区贡献者容易上手
  5. V1 只需 4 个命令（start/stop/onboard/doctor），不需要 Oclif 这种重型框架
- **放弃其他方案的核心原因**：
  - Yargs：API 风格偏函数链式调用，对简单场景过于复杂
  - Citty：较新，社区规模小，文档不够完善
  - Oclif：面向大型 CLI 工具（如 Heroku CLI），V1 不需要插件体系

---

## DEC-022：配置格式与密钥管理

- **决策**：配置文件使用 **YAML 格式**（`crabcrush.yaml`），API Key 支持**环境变量优先**
- **理由**：
  1. YAML 支持注释：用户手动编辑配置时，注释是关键的引导手段。JSON 不支持注释
  2. YAML 可读性更好：嵌套结构、长字符串、多行文本比 JSON 更清晰
  3. 环境变量优先级高于配置文件：遵循 12-Factor App 原则，方便 Docker 和 CI 场景
- **配置加载优先级**（高 → 低）：
  1. 命令行参数（`--port 8080`）
  2. 环境变量（`CRABCRUSH_DEEPSEEK_API_KEY=sk-xxx`）
  3. 配置文件（`~/.crabcrush/config/crabcrush.yaml`）
  4. 内置默认值
- **API Key 管理**：
  - V1 阶段：明文存储在配置文件或环境变量中（简单直接）
  - `crabcrush onboard` 向导会引导用户配置 API Key，自动写入配置文件
  - 配置文件权限建议 `600`（仅用户可读写）
  - Phase 2+ 可引入加密存储（`credentials/` 目录 + AES 加密）
- **Schema 验证**：使用 **Zod** 定义配置 schema，启动时校验，错误提示友好
- **环境变量命名规则**：`CRABCRUSH_` 前缀 + 大写蛇形。例：
  - `CRABCRUSH_PORT` — 端口
  - `CRABCRUSH_DEEPSEEK_API_KEY` — DeepSeek API Key
  - `CRABCRUSH_QWEN_API_KEY` — 通义千问 API Key

---

## DEC-023：构建工具 — tsdown

- **决策**：使用 **tsdown** 作为 TypeScript 构建工具
- **当前实现**：暂用 **tsc**（零配置、足够用）。tsdown 待 Phase 2 需要打包/双格式时再迁移。
- **候选**：tsup、tsdown、tsc、esbuild
- **理由**：
  1. tsdown 是 tsup 的官方后继者，同一作者（@sxzz），API 兼容
  2. 构建性能更优，基于 Rolldown（Rust 实现的 Rollup 替代）
  3. 活跃维护中，代表 tsup 生态的演进方向
  4. 零配置即可构建 TypeScript 项目，输出 ESM/CJS 双格式
- **放弃其他方案的核心原因**：
  - tsup：tsdown 是其官方后继者，新项目应直接用 tsdown
  - tsc：只做类型检查和简单编译，不支持打包、tree-shaking
  - esbuild：需要手动配置较多，不如 tsdown 开箱即用

---

## DEC-024：日志框架 — pino

- **决策**：使用 **pino** 作为日志框架
- **当前实现**：暂用 Fastify 内置 logger（基于 pino）。`~/.crabcrush/logs/` 等完整策略待 Phase 2 实现。
- **候选**：pino、winston、bunyan、console
- **理由**：
  1. 极致性能：比 winston 快 5-10 倍，适合高吞吐消息网关场景
  2. JSON 结构化日志：天然适合日志聚合和分析
  3. Fastify 原生集成：Fastify 内置 pino，零额外配置
  4. pino-pretty：开发时美化输出，生产时纯 JSON，一举两得
  5. 低开销：异步写入，不阻塞事件循环
- **日志策略**：
  - 输出路径：`~/.crabcrush/logs/`
  - 滚动策略：按大小（默认 10MB）+ 按日期
  - 开发模式：`pino-pretty` 美化 + 彩色输出
  - 生产模式：纯 JSON，便于 `jq` 或日志平台解析

---

## DEC-025：Markdown 渲染 — markdown-it + highlight.js

- **决策**：WebChat 使用 **markdown-it** + **highlight.js** 渲染 Markdown
- **候选**：markdown-it、marked、remark
- **理由**：
  1. markdown-it 插件生态丰富：VitePress/VuePress 同款，Vue 生态中最成熟的选择
  2. 可扩展性强：通过插件支持数学公式、任务列表、脚注等（按需引入）
  3. highlight.js 轻量且语言支持全面：~190 种语言，gzip 后核心 ~30KB
  4. 社区成熟稳定：两者均有 10+ 年历史，bug 少、文档全
- **放弃其他方案的核心原因**：
  - marked：速度快但插件体系不如 markdown-it 灵活
  - remark（unified 生态）：功能强大但体积大、学习曲线陡，对 V1 来说过重
- **V1 渲染需求**：代码块（含语法高亮）、加粗/斜体、列表、链接、引用块

---

## DEC-026：安全原则 — 工具能力必须与权限控制同步上线

- **状态**：当前有效
- **背景**：CrabCrush 是个人部署的助手，但机器人可以被添加到群聊中。群里其他人 @机器人时，消息会被 CrabCrush 处理。当前阶段只有纯对话，没有安全风险。但 Phase 2 加入工具调用（文件操作、命令执行等）后，群里任何人都可能通过 @机器人 触发危险操作（如删除文件），相当于操控部署者的电脑。
- **决策**：工具能力与权限控制作为一个整体交付，不允许先上工具后补安全。具体要求：
  1. **工具权限分级**：对话类/云端 API 类工具（查股票、翻译）对所有人开放；本地操作类工具（文件读写、命令执行）仅限 owner
  2. **Owner 认证**：通过配置指定"谁是主人"（如钉钉 userId / 飞书 openId），只有 owner 的消息才能触发本地操作类工具
  3. **沙箱隔离**：命令执行应限制在沙箱环境中（Docker 容器或受限进程），不直接操作宿主机
  4. **确认机制**：高危操作（删除文件、执行未知脚本）需要二次确认，不能静默执行
- **核心原则**：**没有权限控制的工具能力 = 安全漏洞，不允许上线。**

---

## DEC-027：Phase 2 策略 — 工具能力优先于新渠道

- **状态**：当前有效
- **背景**：OpenClaw 的爆火核心不是"能聊天"（ChatGPT 早就能了），而是"能干活"——浏览器控制、自动回邮件、文件操作等工具能力。对比 CrabCrush 的 Phase 2 规划，原计划飞书渠道和工具调用并行推进。
- **分析**：
  - 一个能帮你操作浏览器、查资料的钉钉机器人 > 一个只能聊天的飞书机器人
  - 工具能力是用户从"试试看"到"离不开"的关键拐点
  - 新渠道只是入口扩展，不改变核心价值
  - CrabCrush 相比 OpenClaw 的三大优势（成本低 50-100 倍、部署简单、不需要公网 IP）已经在 V1 建立，Phase 2 应强化"能干活"的差异化
- **决策**：Phase 2a 优先级调整为"工具能力 > 新渠道"：
  1. Function Calling + 安全沙箱（必须同步，DEC-026）
  2. 浏览器控制（Playwright Core，最高价值的单个工具）
  3. Skills 框架（借鉴 OpenClaw 的 SKILL.md 方式）
  4. 飞书渠道（工具就绪后再加）
- **不做的事**：原生 App（macOS/iOS/Android），坚持"渠道即入口"定位

---

## DEC-031：钉钉 Block Streaming — 借鉴 OpenClaw

- **状态**：已规划，待实现（见 ROADMAP Phase 1.1 / 2a）
- **背景**：钉钉 sessionWebhook 不支持 token 级流式，当前实现等整条回复再发，用户体感慢。OpenClaw 对 WhatsApp/Slack 等渠道采用 Block Streaming：按块分片发送，边生成边发。
- **决策**：规划引入 Block Streaming，钉钉/飞书等非 WebSocket 渠道按块发送多条消息
- **参考**：OpenClaw `blockStreamingChunk`（min/max 字符）、`blockStreamingCoalesce`（合并小块）、`textChunkLimit`（渠道上限）
- **实现时机**：飞书/企微接入时一并抽象为渠道层通用能力，避免钉钉单点实现

---

## DEC-032：人格化与工作区 — 借鉴 OpenClaw

- **状态**：已实现（见 ROADMAP 2a.5）
- **背景**：OpenClaw 通过工作区文件（SOUL.md、IDENTITY.md、USER.md）和 Bootstrap 首次对话，实现 AI 有名字、知道如何称呼用户、可配置语气性格。用户体感"智能"、"像真人"。
- **决策**：引入工作区 + Bootstrap 机制
  1. **工作区**：`~/.crabcrush/workspace/` 固定路径，存放 IDENTITY.md（AI 名字/emoji/语气）、USER.md（用户名字/称呼）、SOUL.md（性格边界，可选）
  2. **系统提示词组装**：每次对话前注入工作区文件，替代或补充 `agent.systemPrompt`
  3. **Bootstrap**：工作区为空时，首次会话主动问询人格；用户没回答可后续再问；用户拒绝则用默认值。通过 write_file 写入 workspace/ 下文件
  4. **不提供配置**：无 agent.workspace、agent.skipBootstrap，保持零配置
- **简化原则**：先做 IDENTITY + USER，SOUL 可选；不做 OpenClaw 的 HEARTBEAT、BOOT、MEMORY 等，保持精简

---

## DEC-028："本地优先"的真实边界 — 数据安全与诚实承诺

- **状态**：当前有效
- **背景**：CrabCrush 自称"本地优先"，用户会自然认为"数据不出本地"。但实际上，只要使用云端模型（DeepSeek/Qwen 等），对话内容和工具执行结果**必然经过模型 API**。这是所有使用云端 AI 的产品的共同限制（ChatGPT、OpenClaw、Dify 全都一样），但我们必须对用户诚实。
- **数据流向分析**：
  - **纯本地**：数据存储、工具执行（SQL 查询、文件操作）、对话历史
  - **经过模型 API**：用户消息、系统提示词、工具调用结果（如数据库查询返回值）
  - 例：用户说"统计上月新增用户"→ CrabCrush 本地执行 SQL → 查询结果 `{ count: 1234 }` 发送给模型 API → 模型生成回复
  - 如果 SQL 返回的是用户手机号、密码等，**这些数据会被模型 API 看到**
- **决策**：
  1. **诚实文档**：README 和用户文档必须明确说明"本地优先 ≠ 数据不出本地"，标注哪些数据会经过模型 API
  2. **五道安全防线**（Phase 2 工具上线时必须实现）：
     - 只读默认：数据库工具默认 `readonly`
     - 列白名单：配置允许查询的表和列，排除敏感字段
     - 结果脱敏：发给模型前自动遮掩 PII（手机号 → `138****1234`）
     - 确认机制：高危操作先展示再执行
     - 本地模型选项：支持 Ollama，数据完全不出本地（牺牲能力换安全）
  3. **一句话原则**：在意"不把数据交给第三方管理"→ CrabCrush 满足；在意"一个字节都不出本地"→ 必须用本地模型

---

## DEC-029：Skills 策略 — 自有格式 + 行业标准工具定义

- **状态**：当前有效
- **背景**：用户问"能用 OpenClaw 的 Skills 吗？" 答案是不能直接用（运行时不同），但工具定义格式是行业通用的。需要确定 CrabCrush 自己的 Skills 策略。
- **决策**：
  1. **工具定义**：使用 OpenAI Function Calling 格式（行业标准，所有主流模型都支持）
  2. **技能打包**：借鉴 OpenClaw 的 SKILL.md 方式（描述 + 工具列表 + 配置模板），但是 CrabCrush 自己的格式
  3. **安装方式**：`crabcrush skills install <name>`（命令行）+ 交互式配置 `crabcrush skills configure <name>`
  4. **第三方互通**：考虑 MCP（Model Context Protocol）兼容，Phase 2 中期评估
  5. **OpenClaw Skills 迁移**：不做自动兼容，但因为工具定义格式相同，手动迁移成本低（适配运行时接口即可）

---

## DEC-030：存储策略 — 消息长度与文件处理时机

- **决策**：暂不实现单条消息长度限制和自动清理；等 2a.3 文件操作时一并设计存储方案（详见 ROADMAP 2a.3 备注）
- **背景**：SQLite 当前整条存 `messages.content`，无拆分、无上限。曾考虑加单条 500KB 上限和自动清理，但用户担心影响后续文件上传/处理。
- **约定**：实现文件操作时，必须同时考虑：文件单独存（磁盘或独立表）、消息只存引用；大内容不塞进 `messages.content`；可选的消息长度限制与自动清理策略。避免先加限制再与文件功能冲突。

---

## DEC-033：关键依赖取舍 — better-sqlite3 / Playwright

- **决策**：当前使用 **better-sqlite3** 和 **Playwright Core**，已知取舍如下。
- **better-sqlite3**：
  - **取舍**：需 node-gyp 编译，Windows 上若缺少构建工具（Visual Studio Build Tools）易安装失败
  - **替代方案**：若用户环境无法编译，可考虑 `sql.js`（纯 JS，无需编译，但性能略低）或 `libsql`（Turso 出品，预编译二进制）
  - **当前策略**：保持 better-sqlite3，文档中说明安装要求；若社区反馈安装问题多，再评估迁移
- **Playwright Core**：
  - **取舍**：`search_web` 需真实浏览器渲染（JS 执行、反爬检测），cheerio 无法替代；`browse_url` 理论上可考虑 cheerio，但多数站点为 SPA，无 JS 则内容不完整
  - **替代方案**：无等效替代；若用户不想装 Chromium，可禁用 browse_url/search_web 工具
  - **当前策略**：保持 Playwright，README 中说明可选安装（`npx playwright install chromium`）

---

*以下 DEC 编号已合并入其他条目，保留编号供旧引用跳转：*

- **DEC-007** → 已合并入 DEC-002（单包项目、Node.js 版本）
- **DEC-008** → 已合并入 DEC-002（Node.js >= 20）
- **DEC-014** → 已合并入 DEC-011（V1 去掉工具调用）
- **DEC-015** → 已合并入 DEC-011（单用户定义）
- **DEC-016** → 已合并入 DEC-003（钉钉机器人类型与 Stream 模式）
- **DEC-017** → 已合并入 DEC-012（extensions 目录移除）
