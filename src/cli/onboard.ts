/**
 * crabcrush onboard — 向导式引导配置
 * 引导用户选择模型、填写 API Key、生成配置文件
 */

import { createInterface } from 'node:readline/promises';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { KNOWN_PROVIDERS } from '../config/schema.js';

export async function runOnboard(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log('🦀 CrabCrush 配置向导\n');
  console.log('这个向导会帮你创建 crabcrush.yaml 配置文件。\n');

  const configPath = join(process.cwd(), 'crabcrush.yaml');

  // 检查是否已有配置
  if (existsSync(configPath)) {
    const overwrite = await ask(rl, '⚠️  当前目录已存在 crabcrush.yaml，是否覆盖？(y/N) ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('\n已取消。\n');
      rl.close();
      return;
    }
    console.log('');
  }

  // 第一步：选择模型提供商
  console.log('── 第一步：选择模型提供商 ──\n');
  const providerList = Object.entries(KNOWN_PROVIDERS);
  for (let i = 0; i < providerList.length; i++) {
    const [id, info] = providerList[i];
    console.log(`  ${i + 1}. ${info.name} (${id})`);
  }
  console.log('');

  let providerIndex = -1;
  while (providerIndex < 0 || providerIndex >= providerList.length) {
    const input = await ask(rl, `请选择 (1-${providerList.length}，默认 1): `);
    providerIndex = input.trim() === '' ? 0 : parseInt(input, 10) - 1;
    if (isNaN(providerIndex) || providerIndex < 0 || providerIndex >= providerList.length) {
      console.log(`  请输入 1 到 ${providerList.length} 之间的数字`);
      providerIndex = -1;
    }
  }

  const [providerId, providerInfo] = providerList[providerIndex];
  console.log(`\n  已选择: ${providerInfo.name}\n`);

  // 第二步：输入 API Key
  console.log('── 第二步：输入 API Key ──\n');
  console.log(getApiKeyHelp(providerId));

  let apiKey = '';
  while (!apiKey.trim()) {
    apiKey = await ask(rl, 'API Key: ');
    if (!apiKey.trim()) {
      console.log('  API Key 不能为空');
    }
  }
  console.log('');

  // 第三步：选择模型
  console.log('── 第三步：选择模型 ──\n');
  const defaultModel = getDefaultModel(providerId);
  const modelInput = await ask(rl, `模型名称（默认 ${defaultModel}）: `);
  const model = modelInput.trim() || defaultModel;
  console.log('');

  // 第四步：钉钉（可选）
  let dingtalkConfig = '';
  const wantDingtalk = await ask(rl, '是否配置钉钉机器人？(y/N) ');
  if (wantDingtalk.toLowerCase() === 'y') {
    console.log('\n  需要在钉钉开放平台创建企业内部应用，获取凭证。');
    console.log('  详见：guide/dingtalk-setup.md\n');

    const clientId = await ask(rl, '  钉钉 AppKey (clientId): ');
    const clientSecret = await ask(rl, '  钉钉 AppSecret (clientSecret): ');

    if (clientId.trim() && clientSecret.trim()) {
      dingtalkConfig = `
# 钉钉机器人（Stream 模式）
channels:
  dingtalk:
    enabled: true
    clientId: ${clientId.trim()}
    clientSecret: ${clientSecret.trim()}
`;
    }
  }

  // 生成配置文件
  const yaml = generateYaml(providerId, apiKey.trim(), model, dingtalkConfig);

  writeFileSync(configPath, yaml, 'utf-8');

  console.log(`\n✅ 配置文件已生成: ${configPath}\n`);
  console.log('下一步：');
  console.log('  pnpm dev          # 启动服务');
  console.log('  crabcrush doctor  # 运行自检\n');

  rl.close();
}

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return rl.question(question);
}

function getApiKeyHelp(providerId: string): string {
  const links: Record<string, string> = {
    deepseek: '  获取地址: https://platform.deepseek.com/api_keys',
    qwen: '  获取地址: https://dashscope.console.aliyun.com/apiKey',
    kimi: '  获取地址: https://platform.moonshot.cn/console/api-keys',
    glm: '  获取地址: https://open.bigmodel.cn/usercenter/apikeys',
    doubao: '  获取地址: https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  };
  return links[providerId] ?? '  请到对应平台获取 API Key';
}

function getDefaultModel(providerId: string): string {
  const defaults: Record<string, string> = {
    deepseek: 'deepseek-chat',
    qwen: 'qwen-max',
    kimi: 'moonshot-v1-8k',
    glm: 'glm-4-flash',
    doubao: 'doubao-pro',
  };
  return defaults[providerId] ?? `${providerId}-default`;
}

function generateYaml(
  providerId: string,
  apiKey: string,
  model: string,
  dingtalkConfig: string,
): string {
  return `# CrabCrush 配置文件
# 由 crabcrush onboard 自动生成

port: 18790
bind: loopback

models:
  ${providerId}:
    apiKey: ${apiKey}

agent:
  model: ${model}
  systemPrompt: "你是 CrabCrush，一个友好的 AI 助手。请用中文回复。"
  maxTokens: 4096
${dingtalkConfig}`;
}
