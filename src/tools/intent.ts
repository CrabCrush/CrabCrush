/**
 * 意图启发式规则（安全兜底层）
 *
 * 这层判断不是“真正理解用户意图”，而是故意保持便宜、可预测的 heuristic：
 * 1. 当用户明显在问文件/目录状态，但模型没调用工具时，给运行时一个兜底信号
 * 2. 当模型擅自调用 write_file 时，拦住那些看起来并没有明确写入意图的请求
 *
 * 为什么要单独抽到这里：
 * - 避免 regex 规则散落在 runtime / file tool 中重复维护
 * - 让中文 / 英文的兜底词表集中管理，便于补测试和后续收缩
 *
 * 长期正确方向：
 * - 这里不应成为“是否允许执行”的主判断依据
 * - 真正的执行安全应建立在 tool_plan / execution preview / confirm / permission_request 上
 * - 这层未来应逐步退化为辅助信号：用于提醒模型“该用工具了”，而不是决定世界状态
 */

/** 显式文件路径是最强信号，中英文请求都可受益 */
const FILE_PATH_PATTERN = /[\w./-]+\.(txt|md|json|ya?ml|csv|log|js|ts|py|html|css|xml|env)\b/i;

/** 文件相关“广义意图”：用于 runtime 判断是否应该强制先走文件工具 */
const FILE_REFERENCE_PATTERNS = [
  /文件|目录|路径|查找|找找|有没有|是否存在|读取|打开|查看|内容|创建|新建|保存|写入|更新|修改|编辑|重写|覆盖/,
  /\b(file|files|folder|folders|directory|directories|path|paths|find|search|locate|exists?|read|open|view|show|check|content|create|save|write|update|modify|edit|rewrite|overwrite)\b/i,
];

/** 写文件“狭义意图”：用于 write_file 预检，尽量减少模型自作主张落盘 */
const FILE_WRITE_PATTERNS = [
  /创建|新建|写入|新写|保存|生成文件|写文件|导出|保存为|更新|修改|编辑|改一下|补充|完善|落盘|归档|记到文档|存成/,
  /\b(create|save|write|export|append|update|modify|edit|rewrite|overwrite|store|persist|dump)\b/i,
];

/** 统一做轻量归一化，避免各处重复 trim/lowercase */
function normalizeIntentText(text: string | undefined): string {
  return (text || '').trim().toLowerCase();
}

/** 任一模式命中即可；这层追求“兜底”而非精确分类 */
function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * 判断一条请求是否“看起来像”在谈文件/目录。
 *
 * 这是 broad detection：
 * - 宁可稍微宽一点，也要减少模型口头编造“文件已存在/已读取”的概率
 * - 但它仍然只是启发式信号，不应替代真实工具执行结果
 */
export function looksLikeFileToolRequest(userMessage: string): boolean {
  const text = normalizeIntentText(userMessage);
  if (!text) return false;
  return FILE_PATH_PATTERN.test(text) || matchesAny(text, FILE_REFERENCE_PATTERNS);
}

/**
 * 判断用户是否表达了“写文件/落盘/导出”一类意图。
 *
 * 这是 narrower detection：
 * - 比 looksLikeFileToolRequest 更保守，只服务于 write_file
 * - overwrite=true 视为上游已经确认过写入方向，此时直接放行后续预检
 *
 * 长期理想方案应更多依赖“用户批准了展示出来的执行计划”，
 * 而不是依赖这里的关键词命中；这里保留为低成本兜底。
 */
export function hasWriteFileIntent(userMessage: string | undefined, allowOverwrite = false): boolean {
  if (allowOverwrite) return true;
  const text = normalizeIntentText(userMessage);
  if (!text) return false;
  return FILE_PATH_PATTERN.test(text) || matchesAny(text, FILE_WRITE_PATTERNS);
}

