# DESIGN（设计文档索引）

> 目标：把“路线图里太长的设计细节”下沉到这里，避免每次读 `docs/ROADMAP.md` 消耗大量 token。
> `ROADMAP.md` 只保留目标/优先级/DoD，本目录保存较长的交互与协议设计，按需阅读即可。

## 什么时候该读这里

- 你正在实现某个需要**跨模块协调**的特性（涉及 Gateway / Runtime / Channel / WebChat UI）
- 你需要确定**交互协议**（例如确认弹窗、按钮式修复、跨渠道降级）
- 你需要把一段“写在 ROADMAP 里会太长”的设计记录下来

## 文件列表

- `permissions.md`：运行时权限请求（Cursor 式）设计（请求级授权）
- `actionable-errors.md`：可操作错误消息（Actionable Errors）设计（如 Chromium 一键安装）

## 写作约定（保持最少够用）

- 先写**目标**与**边界**，再写协议/交互
- 保持可链接：在 `ROADMAP.md` 中只放链接入口
- 避免把“实现细节”写死（接口/字段以 `src/` 为准），这里更像“设计意图与约束”

