# 可操作错误消息（Actionable Errors）设计

> 目标：把“提示用户去复制粘贴命令”的错误，升级为“用户点一下就能修复”的交互，显著降低门槛。

## 典型场景：Chromium 一键安装

背景：`browse_url`、`search_web` 失败时常见提示「Chromium 未安装，请执行 `npx playwright install chromium`」，用户需要手动复制粘贴。目标是提供「一键安装」按钮，并能看到进度。

## 分层设计（建议）

| 层级 | 职责 |
|------|------|
| **工具层** | 返回结构化错误：`{ type: 'actionable_error', action: 'install_chromium', message: '...', command: 'npx playwright install chromium' }` |
| **Gateway** | 提供安装接口：执行 `npx playwright install chromium`；需要鉴权（token / 仅 localhost）；支持流式返回安装进度 |
| **渠道适配** | 各渠道按能力渲染：有按钮则展示按钮，否则降级为纯文本 + 命令 |

## 各渠道兼容策略（建议）

| 渠道 | 策略 | 说明 |
|------|------|------|
| **WebChat** | 按钮「一键安装」→ 调用 Gateway API | 同源请求，直接可用；安装中显示进度 |
| **钉钉** | 配置了 `publicUrl` 时：卡片按钮「一键安装」→ 打开 `{publicUrl}/api/install-chromium?token=xxx`（返回进度页） | 渠道模式下用户手机可访问公网 URL，点击即触发服务端安装 |
| **钉钉（本地模式）** | 无 `publicUrl` | 仅展示命令文本，用户需在运行 CrabCrush 的机器上执行 |
| **飞书 / 企微** | 同钉钉 | 使用各平台交互卡片，按钮打开 URL |

## 配置依赖

- `gateway.publicUrl`：用于生成“点击即执行”的安装链接；未配置时外部渠道只能降级为命令提示。

## 安全注意事项（建议）

- 安装/执行类动作必须走 **owner + 确认机制**（见 `docs/DESIGN/permissions.md`）。
- Gateway 的安装接口需要最小权限：仅允许预定义动作（如 `install_chromium`），不要做任意命令执行入口。

