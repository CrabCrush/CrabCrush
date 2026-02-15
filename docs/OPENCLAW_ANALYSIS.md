# OpenClaw 实现原理分析与借鉴建议

> 基于 OpenClaw 官方文档与仓库结构的分析，用于回答：规则/人格如何实现、长期记忆、Token 使用、优缺点，以及做本地个人 AI 助理的建议。

---

## 1. OpenClaw 的「规则」是怎么写的？为什么能主动问名字、称呼、语气？

### 实现方式概览

规则和「智能感」主要来自 **Workspace 里的 Markdown 文件 + 首轮注入**，而不是复杂代码逻辑。

- **BOOTSTRAP.md**（首次开机仪式）
  - 只在**全新 workspace** 存在，用完后会被删除。
  - 内容明确要求 AI 第一句类似：*"Hey. I just came online. Who am I? Who are you?"*，然后和用户一起填：
    1. 你的 emoji
    2. 你的 vibe（正式/随意/毒舌/温暖）
    3. 你的 nature（AI/机器人/更怪的东西）
    4. 你的名字
  - 然后要求更新 `USER.md`（用户名字、怎么称呼）、`IDENTITY.md`（助理名字、creature、vibe、emoji），再一起过 `SOUL.md`（边界、偏好、行为方式）。完成后删除 `BOOTSTRAP.md`。
  - **所以「主动问名字、称呼、语气」是写进 BOOTSTRAP 的提示词流程，不是代码里写死的对话树。**

- **IDENTITY.md**  
  定义「助理是谁」：头像、emoji、vibe、creature、名字。

- **USER.md**  
  定义「用户是谁」：名字、怎么称呼、时区、代词、背景（项目、在乎的事等），随对话更新。

- **SOUL.md**  
  定义人格与边界：要真诚有用、可以有观点、先自己尝试再问、对外谨慎对内有把握、尊重隐私；群体里不当用户代言人；语气「像你真正想聊天的那个助理」等。

- **AGENTS.md**  
  操作指令 + 记忆使用方式：Session 开始时必须先读 `SOUL.md`、`USER.md`、`memory.md` 以及 today/yesterday 的 `memory/`；如何写长期记忆、何时用 daily log 等。

### 技术实现要点

- **Bootstrap 注入**：每个 session 的**第一轮**，OpenClaw 会把上述文件（以及 `MEMORY.md`、`TOOLS.md` 等）**直接拼进 system prompt**（Workspace bootstrap injection）。大文件会截断（如 `bootstrapMaxChars` 约 20k 字符）。
- **人格与规则** = 这些文件的内容；**「上来就问名字」** = BOOTSTRAP 里写好的首轮对话指引。模型只是按提示词执行，没有单独的「规则引擎」或对话状态机。

**小结**：规则是「写在 Markdown 里的提示词 + 每轮/每 session 注入」，智能感来自 BOOTSTRAP 设计好了「第一次见面该问什么、填哪些文件」，以及 SOUL/USER/IDENTITY 持续提供人格与用户信息。

---

## 2. OpenClaw 怎么实现长期记忆？

- **文件即记忆**
  - `MEMORY.md`（或 `memory.md`）：持久事实、偏好、决策。
  - `memory/YYYY-MM-DD.md`：按日日志，会话开始建议读「今天 + 昨天」。
  - 都在 agent workspace 下，模型通过 `read` / 专用工具读写。

- **Session 开始时**
  - AGENTS.md 要求先读 `SOUL.md`、`USER.md`、`memory.md` 以及 today+yesterday 的 `memory/`，所以「记忆」是读文件得来的，不是模型参数。

- **Memory 工具**
  - `memory_get`：按路径读某段 memory 文件内容。
  - `memory_search`：对 `MEMORY.md` + `memory/*.md` 做**语义检索**（向量，可选 BM25+向量混合），返回片段，不整文件塞进 context。

- **自动记忆沉淀（memory flush）**
  - 当 session 快触发 **compaction** 前，会跑一轮**静默 turn**，系统提示类似「Session 快压缩了，请把该留的写进 memory」，用户侧通常用 `NO_REPLY` 不展示。
  - 这样在「旧对话被压成摘要」之前，重要信息先写入 `memory/YYYY-MM-DD.md` 或 `MEMORY.md`。

- **可选增强**
  - 向量索引（含 sqlite-vec、QMD 等）、session 转录本索引、多 path 索引等，都在「记忆文件」之上做检索层，不改变「Markdown 文件为唯一真相」的设计。

**小结**：长期记忆 = workspace 里的 Markdown 文件 + 会话开始时读 today/yesterday + 按需 `memory_search` / `memory_get` + 压缩前 memory flush。

---

## 3. 每次会话都带全量聊天记录吗？会不会很浪费 Token？

- **不是永远全量**
  - **Compaction（压缩）**：当对话长度接近模型的 context 上限时，会把**较早的对话**压缩成一条**摘要**，写回 session 的 JSONL。之后发给模型的 = **这条摘要 + 近期完整消息**。所以历史不会无限全量带上。
  - **Session pruning**：只剪** tool results**（大块工具输出），不删 user/assistant 消息；主要为了配合 Anthropic 的 prompt cache TTL，减少重复缓存和成本。

- **仍然会占 Token 的地方**
  - **Bootstrap 文件**（AGENTS、SOUL、USER、IDENTITY、TOOLS、MEMORY 等）在**每轮**都会注入一段到 system prompt，且 `MEMORY.md` 会随时间变长，文档建议保持精简，否则会拉高 context 并更早触发 compaction。
  - **Daily memory 文件**（`memory/YYYY-MM-DD.md`）**不会**自动整块注入，而是通过 `memory_search` / `memory_get` 按需读，只有被读到的部分占 token。

- **总结**
  - 历史对话：通过 compaction 变成「摘要 + 近期」，不是每次都全量。
  - 规则/人格/用户信息：每轮注入 bootstrap 文件，有固定 token 成本，需控制文件大小。

---

## 4. OpenClaw 值得学习的地方 & 优缺点

### 值得学习的设计

| 方面 | 做法 | 可借鉴点 |
|------|------|----------|
| 人格与身份 | SOUL.md / IDENTITY.md / USER.md 文件化，首轮注入 | 用少量文件定义「谁是谁、什么语气」，易改、可版本管理 |
| 首次体验 | BOOTSTRAP.md 一次性「开机仪式」：问名字、称呼、语气、边界 | 把「第一次该问什么」写进提示词，无需复杂状态机 |
| 长期记忆 | MEMORY.md + memory/YYYY-MM-DD.md + memory_search + 压缩前 flush | 文件即记忆、按日拆分、检索按需加载、压缩前沉淀 |
| Context 控制 | Compaction（摘要旧对话）+ Pruning（剪 tool results） | 控制 token、配合长 context 与 cache 策略 |
| 技能扩展 | Skills + SKILL.md 按需 read，不全部塞进 prompt | 技能说明按需加载，控制 base prompt 大小 |
| 安全与多端 | DM pairing、allowlist、sandbox 非 main session | 渠道与权限模型清晰，适合多 channel |

### 优点

- 人格与记忆设计清晰，全部落在 workspace 文件上，可 git 备份、可读可改。
- 本地优先，数据在用户侧；文档全，概念分层清楚（session、compaction、memory、bootstrap）。
- 多 channel、多端（macOS/iOS/Android）、工具与技能体系完整，适合「个人助理」的完整产品形态。

### 缺点 / 成本

- 强依赖**长 context 模型**（文档推荐 Claude Opus 等），否则 compaction 触发更频繁、体验更敏感。
- Bootstrap 每轮注入，AGENTS/SOUL/USER/IDENTITY/MEMORY 等会持续占 token，需控制体量。
- 架构复杂：Gateway、Pi agent、多 channel、sandbox、QMD、多种 memory 后端等，上手和二次开发成本高。
- 欧美渠道与生态为主（WhatsApp/Telegram/Slack/Discord/iMessage 等），国内渠道需自己接。

---

## 5. 如果自己做「本地个人 AI 助理」：建议做法 & 与 OpenClaw 的对比

### 建议方向（和 OpenClaw 的异同）

- **人格与规则（直接借鉴）**
  - 采用「SOUL / IDENTITY / USER + 首轮注入」的思路；首轮或首次会话用一份「BOOTSTRAP」式提示，引导问名字、称呼、语气，并写入 USER/IDENTITY/SOUL 等价文件。
  - 实现简单：几份 Markdown + 在组 system prompt 时按 session 注入即可，无需规则引擎。

- **长期记忆（借鉴并简化）**
  - 用「MEMORY.md + memory/YYYY-MM-DD.md」作为唯一真相，会话开始读 today/yesterday + 可选 memory.md。
  - 若不做向量检索，可先只做「按路径/按日读文件」；后续再加 `memory_search` 语义检索和「压缩前 memory flush」。

- **Token 与历史（借鉴思路）**
  - 不做全量历史：要么像 OpenClaw 一样做 compaction（摘要旧对话），要么用「滑动窗口 + 摘要」：只带最近 N 轮 + 一条简短「此前摘要」。
  - 控制 bootstrap 文件大小（尤其是 MEMORY.md），避免每轮注入过长。

- **渠道与范围（差异化）**
  - 先聚焦 1～2 个渠道（如你现在的 WebChat + 钉钉），把「人格 + 记忆 + 摘要」做稳，再考虑多 channel。这样比 OpenClaw 更轻、更易维护。

- **模型与部署（差异化）**
  - 以国产模型 + 本地/私有化为主时，可针对国产 API 的 context 和定价设计「摘要/压缩」策略，不必强依赖 Claude 级长 context。

### 和 OpenClaw 相比的优缺点（简要）

| 维度 | OpenClaw | 自建本地助理（建议方向） |
|------|----------|---------------------------|
| 人格/规则 | 成熟的文件化 + BOOTSTRAP | 可复用其思路，实现更轻 |
| 长期记忆 | 文件 + 向量检索 + flush | 可先文件 + 按日读，再补检索与 flush |
| Token/历史 | Compaction + pruning | 可做简化版摘要或滑动窗口 |
| 渠道与生态 | 多欧美 channel、多端 | 专注国内渠道，更少端、更易控 |
| 复杂度 | 高（Gateway、多端、sandbox） | 可刻意压低，先单机、单 workspace |
| 模型 | 推荐 Claude 等长 context | 可优先国产模型 + 适配其 context 与成本 |

**总结**：OpenClaw 的「规则怎么写、怎么做到智能」= 把 BOOTSTRAP + SOUL/IDENTITY/USER 写进 Markdown 并注入；长期记忆 = 文件 + 按需检索 + 压缩前写入；不是每次全量历史，有 compaction；做本地助理时建议借鉴其人格/记忆/压缩思路，在渠道和架构上做减法，先跑通再扩展。
