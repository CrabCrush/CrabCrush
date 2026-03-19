# 运行时权限请求（Cursor 式）设计

> 目标：类似 Cursor，在执行敏感操作前主动询问用户，支持「访问某路径」「安装依赖」「执行命令」等动态场景。
> 区别于静态 `confirmRequired`（工具级），这里是**请求级**的运行时确认。

## 与现有机制的关系

| 机制 | 粒度 | 时机 | 示例 |
|------|------|------|------|
| **confirmRequired** | 工具级（静态） | 执行前 | `write_file`、`run_command` 等高危工具一律确认 |
| **运行时权限请求** | 请求级（动态） | 执行前 | 某次请求需要额外授权（如访问超出允许范围的路径、首次安装依赖） |
| **可操作错误消息** | 失败后补救 | 执行失败后 | Chromium 未安装 → 展示「一键安装」按钮 |

> 现状提示：当前这套设计已在现有内置工具上基础落地，但后续“安装依赖 / 执行命令 / 代码执行沙箱”等场景仍会继续扩展。
> 规划约束：后续按三层推进更稳妥：先做预定义 repair action，再评估受限 `run_command`，最后才是完整代码沙箱；不要把三者混成一个泛化 exec 入口。

## 当前已实现

- **WebChat**：确认弹窗已支持 `once / session / persistent` 三种作用域，并展示执行预览
- **钉钉**：已支持文本确认 `允许 <id>` / `允许 本会话 <id>` / `允许 永久 <id>` / `拒绝 <id>`
- **权限复用**：持久授权已落到 SQLite；Web 控制面已提供授权中心，可查看当前会话授权、长期授权与审计回放
- **当前边界**：
  - `read_file / list_files`：默认允许 `tools.fileBase` 内相对路径；对 `fileBase` 外绝对路径已走 `permission_request`
  - `write_file`：仍只允许写 `tools.fileBase` 内相对路径；通过 `confirmRequired` + 执行预览确认
  - `browse_url / search_web`：访问外部网页或联网搜索前会先请求权限

## 触发条件（建议）

工具执行前检测到需额外授权时触发，例如：

- 访问 `tools.fileBase` 外的绝对路径（当前 `read_file / list_files` 已支持）
- 首次安装依赖（如 Playwright Chromium）
- 执行外部命令（未来的 `run_command` / 代码执行沙箱等）

## 协议草案（建议）

工具层不直接执行，返回结构化对象并暂停。当前实现里，核心字段已包括授权范围与预览信息：

```ts
{
  type: 'permission_request',
  action: string,
  message: string,
  params?: object,
  preview?: object,
  scopeOptions?: ['once', 'session', 'persistent'],
  defaultScope?: 'once' | 'session' | 'persistent',
  grantKey?: string
}
```

## 用户响应（当前 + 建议）

- **WebChat**：当前为确认弹窗；后续可继续升级成更强的任务确认面板
- **钉钉/飞书/企微**：当前钉钉已走文本确认；其他渠道可优先复用“能点则点，不能点则降级为文本”的策略

当前已支持的授权范围：

- **仅本次**
- **本会话**
- **长期授权**

## 渠道兼容（建议）

与「可操作错误消息」复用一套交互能力：

- 有按钮 → 展示按钮
- 无按钮 / 本地模式无 `publicUrl` → 降级为文本说明 + 用户回复「允许」后继续

## 典型场景（示例）

- 访问新路径：`read_file` 请求 `D:/work/notes.md` → 询问「是否允许访问 `D:\work\`？」
- 安装依赖：`browse_url` 需要 Chromium → 询问「是否允许安装 Chromium？」
- 执行命令（未来能力）：`run_command` 请求执行 `npm install xxx` → 询问「是否允许执行该命令？」

## 实现时机（建议）

当前已在现有内置工具上落地统一的权限请求框架；下一步重点是把更多工具（安装依赖、执行命令、代码执行沙箱）也收敛到同一模型，并继续完善 Web 控制面的任务确认体验。
其中安装/修复动作优先采用白名单 action，不直接开放任意命令执行；若后续加入宿主机 `run_command`，也应作为单独一层能力处理。

