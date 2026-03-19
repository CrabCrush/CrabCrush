# 🦀 CrabCrush — 你的私人 AI 执行助手

**做你的虾兵蟹将**

CrabCrush 是一个面向中国用户的本地优先、风险可控的个人 AI 执行助手。
它把本地 Web 控制面、钉钉等聊天入口、国产大模型和可控执行能力收在一起，让 AI 不只是“能聊”，而是能在明确边界内安全地帮你做事。

[架构](./docs/ARCHITECTURE.md) · [路线图](./docs/ROADMAP.md) · [决策记录](./docs/DECISIONS.md) · [愿景](./docs/VISION.md) · [执行体验设计](./docs/DESIGN/execution-ux.md) · [更新日志](./CHANGELOG.md)

## 它是什么

CrabCrush **不是在线 SaaS，而是装在你自己电脑上的软件**。本地 Web 控制面是执行任务的一等入口；钉钉、飞书、企业微信等更适合远程触发、通知和轻交互。

这意味着：

1. 你自己申请模型 API Key，自行决定用 DeepSeek、通义千问、Kimi、GLM、豆包还是本地模型
2. 对话历史、工作区文件、审计记录都在你自己的机器上
3. 以后接入文件、浏览器、数据库、受限执行等能力时，操作的是你自己的环境
4. 高风险动作必须确认、可审计、可中断，而不是静默执行

**关于“本地优先”的诚实说明**：

“本地优先”不等于“数据一个字节都不出本地”。如果你使用云端模型，用户消息、系统提示词以及部分工具结果仍会发到模型 API 做推理。CrabCrush 的承诺是：**数据存储和工具执行在本地，数据流向透明，权限边界清楚，是否换成本地模型由你决定**。详见 [DEC-028](./docs/DECISIONS.md)。

## 为什么不直接用 ChatGPT？

| 维度 | ChatGPT / 云端助手 | CrabCrush |
|------|-------------------|-----------|
| **入口** | 网页或 App | 本地 Web 控制面 + 钉钉等入口 |
| **模型** | 主要受限于平台提供 | DeepSeek、通义千问、Kimi、GLM、豆包、Ollama 等 |
| **数据控制** | 历史和配置主要在平台侧 | 历史、工作区、审计在你自己的机器上 |
| **可执行性** | 主要操作云端能力 | 逐步扩展到浏览器、文件、数据库、受限执行 |
| **安全边界** | 平台定义 | 你自己配置 owner、确认、授权范围和审计 |
| **国内可用性** | 受网络和成本影响较大 | 国产模型直连、成本更低 |

## 快速开始

> 需要 Node.js >= 20 和 pnpm

### 1. 克隆并安装

```bash
git clone https://github.com/CrabCrush/CrabCrush.git
cd CrabCrush
pnpm install
```

如果你要使用 `browse_url` / `search_web` 之类的浏览器工具，建议提前安装 Chromium：

```bash
npx playwright install chromium
```

可以运行 `pnpm doctor` 检查是否安装完整。

### 2. 配置模型

```bash
cp crabcrush.example.yaml crabcrush.yaml
```

编辑 `crabcrush.yaml`，填入你的 API Key：

```yaml
models:
  deepseek:
    apiKey: sk-your-deepseek-api-key
```

也可以使用环境变量：

```bash
export CRABCRUSH_DEEPSEEK_API_KEY=sk-xxx
```

如果你要限制谁能使用本地工具，可以配置 `ownerIds`：

```yaml
ownerIds:
  - webchat:default
```

说明：

- 不配置 `ownerIds` 时，默认所有入口都是 owner，适合单人本地使用
- 一旦配置了 `ownerIds`，就会进入白名单模式
- WebChat 需要显式写上 `webchat:default`

### 3. 启动

```bash
pnpm dev
```

启动成功后，控制台会打印带 token 的完整访问地址，例如：

```text
🦀 CrabCrush Gateway 已启动
   模型: DeepSeek (deepseek-chat)
   WebChat: http://127.0.0.1:18790/?token=YOUR_TOKEN
```

### 4. 开始聊天

打开控制台打印的完整 URL 即可开始使用。

如果你准备接入钉钉，查看 [钉钉机器人接入指南](./guide/dingtalk-setup.md)。

## 工具与权限边界

当前执行能力已经具备基础护栏：

- `browse_url` / `search_web`：访问外部网页或联网搜索前会先请求权限
- `read_file` / `list_files`：默认允许读取 `tools.fileBase` 下的相对路径；访问 `fileBase` 外绝对路径时会先请求权限
- `write_file`：仅允许写入 `tools.fileBase` 下的相对路径；执行前展示预览并要求确认
- WebChat 和钉钉都支持确认，授权范围支持 `once / session / persistent`

更完整的交互与边界设计见 [docs/DESIGN/execution-ux.md](./docs/DESIGN/execution-ux.md)。

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发模式启动 |
| `pnpm start` | 生产模式启动（需先构建） |
| `pnpm build` | 构建 |
| `pnpm test` | 运行测试 |
| `pnpm doctor` | 自检诊断 |
| `pnpm onboard` | 交互式生成配置 |

## 当前支持

### 模型

通过 OpenAI 兼容适配器，大多数主流国产模型都能直接接入：

| 模型 | 配置 ID | 状态 |
|------|---------|------|
| DeepSeek | `deepseek` | ✅ |
| 通义千问 | `qwen` | ✅ |
| Kimi | `kimi` | ✅ |
| 智谱 GLM | `glm` | ✅ |
| 豆包 | `doubao` | ✅ |

如果某个模型不支持 tool/function calling，可以显式配置：

```yaml
models:
  qwen:
    apiKey: sk-xxx
    defaultModel: qwen-max
    supportsToolCalls: false
```

### 渠道

| 渠道 | 状态 | 说明 |
|------|------|------|
| WebChat | ✅ 已实现 | 本地 Web 控制面，当前执行任务的一等入口 |
| 钉钉 | ✅ 已实现 | Stream 模式，不需要公网 IP |
| 飞书 | 🔜 规划中 | 在执行底座进一步收口后推进 |
| 企业微信 | 🔜 规划中 | 后续阶段推进 |

### 工作区与人格化

普通用户默认只需要关心 `~/.crabcrush/workspace/AGENT.md` 这一份主文件。

- `AGENT.md`：你希望 AI 如何长期协助你、遵守什么规则、输出偏好是什么
- `USER.md / IDENTITY.md / SOUL.md`：按需补充的高级层
- `prompts/`：开发者或进阶用户的覆盖层

## 文档地图

- [AGENTS.md](./AGENTS.md)：AI 协作入口、当前阶段、下一步
- [docs/ROADMAP.md](./docs/ROADMAP.md)：当前和近期开发计划
- [docs/DECISIONS.md](./docs/DECISIONS.md)：关键技术取舍
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)：系统结构与部署模式
- [docs/VISION.md](./docs/VISION.md)：长期方向与产品定位
- [docs/DESIGN/execution-ux.md](./docs/DESIGN/execution-ux.md)：执行确认、权限和修复体验

## 灵感来源

项目受 [OpenClaw](https://github.com/openclaw/openclaw) 启发，但会更聚焦中国用户、本地控制面和风险可控的执行体验。
更详细的参考分析见 [docs/reference/OPENCLAW_ANALYSIS.md](./docs/reference/OPENCLAW_ANALYSIS.md)。

## 许可证

[GPL-3.0 License](./LICENSE)
