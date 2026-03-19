# CrabCrush - AI 上下文文件

> 本文件只服务一个目标：让第一次接触本项目的 AI 助手，尽快知道“该看什么、别看什么、现在做到哪了、下一步做什么”。

## AI 行为准则

项目作者不是大佬，已有决策也不一定都对。AI 助手必须遵守：

1. **质疑不合理决策**：如果用户要求或既有方案明显有问题，先解释风险并给替代方案，再执行
2. **解释取舍**：说清楚为什么选 A、不选 B，收益和代价都要讲
3. **保持简单**：项目仍在早期，默认反对过度设计
4. **先写代码，后补文档**：文档为代码服务；能用代码注释说清楚的，不额外立文档
5. **不要唯命是从**：如果用户要求不是好主意，应明确指出并建议更好的路径

## 信息权威来源

| 信息类型 | 权威来源（唯一真相） | 其他文件怎么做 |
|---------|---------------------|----------------|
| 关键决策（为什么这么选） | `docs/DECISIONS.md` | 其他地方只引用 DEC 编号，不复制细节 |
| 当前阶段（做到哪了） | `AGENTS.md` 的“当前阶段” | 不在其他地方维护进度 |
| 短期计划（接下来做什么） | `docs/ROADMAP.md` | AGENTS 只保留最近的“下一步” |
| 系统结构与部署 | `docs/ARCHITECTURE.md` | 接口定义在 `src/` |
| 长期方向与定位 | `docs/VISION.md` | 其他文档只做摘要 |
| 执行确认 / 权限 / 修复体验 | `docs/DESIGN/execution-ux.md` | ROADMAP 只写目标，不写长设计 |

## AI 最小阅读路径

默认只读这些：

1. `AGENTS.md`：行为准则、权威来源、当前阶段、下一步
2. `docs/ROADMAP.md`：只读当前 Phase 2a

按需再读：

- `docs/DECISIONS.md`：遇到取舍问题时按 `DEC-xxx` 定位
- `docs/ARCHITECTURE.md`：改模块边界、部署、鉴权、安全时再读
- `docs/DESIGN/execution-ux.md`：改确认、授权、执行预览、修复动作时再读
- `docs/VISION.md`：讨论产品定位、路线收束、对外叙事时再读

常用代码入口：

- `src/index.ts`：CLI 入口
- `src/gateway/server.ts`：HTTP + WebSocket + 静态文件
- `src/agent/runtime.ts`：会话、上下文、工具调用循环
- `src/tools/registry.ts` / `src/tools/builtin/*`：工具系统
- `public/index.html`：当前 WebChat 前端

## 当前阶段

**V1 已发布（v0.1.0）** — 最后更新：2026-03-19

### 已完成（浓缩版）

- **V1**：WebChat + 钉钉（Stream）纯对话；多轮上下文 + 流式输出；CLI（start/onboard/doctor）
- **Phase 2a 基础版**：Token 认证、SQLite 对话持久化 + 滑动窗口、Function Calling + Owner 权限、内置工具（time/browser/search/file）、工作区人格化
- **执行安全基础版**：`confirmRequired`、`permission_request`、`once/session/persistent` 授权作用域、执行预览、拒绝后降级、审计回放，WebChat/钉钉均可确认
- **Web 控制面基础版**：当前任务、审计回放、授权中心、工作区设置，已并入 WebChat 工作台

### 下一步（Phase 2a 续，按 DEC-035 收束）

- [ ] 收口权限模型：资源粒度、展示/撤销、连接数限制与入口级限流配置化
- [ ] 升级任务确认与执行摘要体验：把确认弹窗升级成更强的任务确认面板
- [ ] 先定受限执行边界：预定义 repair action → 受限 `run_command` → 真正代码沙箱
- [ ] 明确 2a 与 2b 的切分：2a 继续收口执行底座，浏览器深化 / 数据库 / Skills 进入 2b 闭环
- [ ] 在执行底座稳定后，再推进 Skills 框架与飞书渠道

## 文档地图

| 文件 | 作用 | 什么时候读 |
|------|------|------------|
| `README.md` | 对外入口与上手说明 | 想快速了解项目和启动方式 |
| `AGENTS.md` | AI 工作入口 | 第一个读这个 |
| `docs/ROADMAP.md` | 当前与近期计划 | 想知道“下一步做什么” |
| `docs/DECISIONS.md` | 关键决策 | 需要做取舍判断时 |
| `docs/ARCHITECTURE.md` | 系统结构 | 想知道“怎么实现/怎么部署” |
| `docs/VISION.md` | 长期定位 | 想知道“为什么做这个” |
| `docs/DESIGN/execution-ux.md` | 执行交互设计 | 改确认/权限/修复动作时 |
| `docs/reference/OPENCLAW_ANALYSIS.md` | 外部参考材料 | 需要借鉴 OpenClaw 时 |
| `docs/archive/SMART_EXPERIENCE_PLAN.md` | 历史复盘 | 只在回看旧思路时 |
