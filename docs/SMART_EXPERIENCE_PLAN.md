# CrabCrush 智能体验优化规划

> 基于用户反馈（「体验差、不智能」）、项目讨论、以及行业分析资料的整理规划。
> 本文档为规划性质，具体实施以 ROADMAP 和 DECISIONS 为准。

---

## 一、本次回滚总结（2026-02-13）

### 回滚内容

| 模块 | 回滚项 |
|------|--------|
| **Agent** | 移除 workspace 人格化、Bootstrap 注入、buildSystemPrompt |
| **Config** | 移除 agent.workspace、agent.skipBootstrap |
| **File 工具** | 恢复 read_file/list_files 路径限制（仅 fileBase 下）；恢复 isAllowedExt 原逻辑 |
| **Workspace** | 删除 src/workspace 模块、test/workspace.test.ts |
| **文档** | ROADMAP 2a.5 恢复为未完成；AGENTS 恢复下一步；README 恢复原说明 |

### 回滚原因

用户反馈：体验差、不智能。初步分析可能包括：

- Bootstrap 一次问太多问题，像填表
- 人格化注入后对话风格生硬
- 缺少行为规则（何时问、何时停、如何自然过渡）

---

## 二、核心设计原则（来自行业分析）

### 2.1 工具层本质

```
用户指令 → LLM 理解 → Agent 决策 → 工具调用 → 本地程序执行
```

- **AI 不直接操作文件**：只输出「调用哪个工具、传什么参数」
- **工具层负责执行**：read_file、write_file、list_files 等是真实代码
- **设计原则**：AI 决策、程序执行、权限控制、日志可追踪

### 2.2 提示词本质

- **不是描述「是谁」**，而是定义**「什么时候做什么」**
- **条件触发**：`if name unknown → ask`，一次最多问 1 个
- **用户拒绝采集 → 立即停止**
- **Prompt = 模板 + 动态变量**（身份、角色、规则、工具、记忆、安全）

### 2.3 路径与查找

- **用户直接给路径**：AI 直接传参，无需查找
- **用户不给路径**：AI 先调用 list_files/search，再选文件操作
- **查找是工具做的**，不是 AI 猜的

---

## 三、智能体验优化方向

### 3.1 提示词与行为（高优先级）

| 问题 | 方向 | 说明 |
|------|------|------|
| 一次问太多 | 行为规则 | 「一次最多问 1 个问题」「自然过渡，不得像表单」 |
| 用户拒绝后仍问 | 停止规则 | 「用户拒绝采集 → 立即停止」 |
| 被动应答 | 优先级 | 「优先满足需求 > 再收集信息」 |
| 风格生硬 | 分层结构 | 身份 / 角色 / 规则 / 工具 / 安全 分层，可配置 |

**建议**：在 `agent.systemPrompt` 或独立配置中增加「行为规则」段落，不急于上人格化工作区，先把基础行为做稳。

### 3.2 人格化与工作区（中优先级，重做）

| 原实现问题 | 改进方向 |
|------------|----------|
| Bootstrap 一次问 3 个 | 分轮问：先问名字，下一轮再问称呼、语气 |
| 无「用户拒绝」处理 | 明确：用户说「不用了」→ 停止，用默认人格 |
| 无记忆槽 | 考虑 USER.md / IDENTITY.md 变量注入，而非整块拼进 prompt |

**建议**：2a.5 重做时，参考 `docs/OPENCLAW_ANALYSIS.md`，采用「BOOTSTRAP 分步 + 行为规则」设计。

### 3.3 工具与 CRUD（中优先级）

| 能力 | 现状 | 规划 |
|------|------|------|
| 删 | 无 | 新增 delete_file，限制在 fileBase 下 |
| 改 | write_file 覆盖 | 可选：edit 工具（按字符串替换，减少整文件覆盖） |
| 查 | list_files 模式匹配 | 可选：语义搜索（成本高，Phase 2b+） |

### 3.4 确认机制（高优先级）

- write_file、delete_file 等**高危操作**需用户确认
- 当前 `confirmRequired: true` 已定义，**未实现**
- 建议：2a.2 确认机制落地后再推人格化、delete_file

### 3.5 路径策略（低优先级）

- 当前：read/list 限制在 fileBase
- 用户曾希望：read/list 不限制，可查全盘
- 建议：作为**可选配置**（如 `tools.allowFullDiskRead: true`），默认保持限制

---

## 四、分阶段实施建议

### Phase A：行为规则先行（建议优先）

1. **增强 systemPrompt 行为规则**
   - 一次最多问 1 个问题
   - 用户拒绝 → 停止
   - 优先解决问题，再收集信息
2. **可选**：支持 `agent.behaviorRules` 配置项，与 systemPrompt 拼接

### Phase B：确认机制

1. 实现 2a.2 confirmRequired
2. write_file、delete_file 执行前弹窗/二次确认

### Phase C：人格化重做（2a.5）

1. 工作区模块（IDENTITY/USER/SOUL）
2. Bootstrap **分步**询问，一次 1 个
3. 用户拒绝 → 用默认人格，停止追问

### Phase D：工具补齐

1. delete_file
2. 可选 edit 工具

---

## 五、参考资料

- `docs/OPENCLAW_ANALYSIS.md`：OpenClaw 人格、记忆、Bootstrap 实现
- `docs/ROADMAP.md`：Phase 2a 任务与 DoD
- `docs/DECISIONS.md`：DEC-032 人格化决策

---

## 六、与 ROADMAP 的衔接

本规划**不替代** ROADMAP，而是：

- 为 2a.5 人格化提供**重做思路**
- 为 2a.2 确认机制提供**优先级依据**
- 为 systemPrompt 设计提供**行为规则参考**

具体任务拆解与 DoD 仍以 `docs/ROADMAP.md` 为准。
