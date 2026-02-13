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
- **详细设计**：见 `docs/DEPLOYMENT_MODES.md`

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

*以下 DEC 编号已合并入其他条目，保留编号供旧引用跳转：*

- **DEC-007** → 已合并入 DEC-002（单包项目、Node.js 版本）
- **DEC-008** → 已合并入 DEC-002（Node.js >= 20）
- **DEC-014** → 已合并入 DEC-011（V1 去掉工具调用）
- **DEC-015** → 已合并入 DEC-011（单用户定义）
- **DEC-016** → 已合并入 DEC-003（钉钉机器人类型与 Stream 模式）
- **DEC-017** → 已合并入 DEC-012（extensions 目录移除）
