#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig, findConfigPath } from './config/loader.js';
import { KNOWN_PROVIDERS } from './config/schema.js';
import { OpenAICompatibleProvider } from './models/provider.js';
import { AgentRuntime } from './agent/runtime.js';
import { startGateway } from './gateway/server.js';

const program = new Command();

program
  .name('crabcrush')
  .description('CrabCrush - 你的私人 AI 助手 🦀')
  .version('0.0.1');

program
  .command('start')
  .description('启动 CrabCrush Gateway')
  .option('-p, --port <port>', '端口号')
  .option('-c, --config <path>', '配置文件路径')
  .action(async (options) => {
    console.log('🦀 CrabCrush starting...\n');

    // 加载配置
    const config = loadConfig(options.config);
    const port = options.port ? parseInt(options.port, 10) : config.port;

    // 查找第一个可用的模型提供商
    const entries = Object.entries(config.models);
    if (entries.length === 0) {
      printNoModelHelp();
      process.exit(1);
    }

    const [providerId, providerConfig] = entries[0];
    const baseURL = providerConfig.baseURL
      ?? KNOWN_PROVIDERS[providerId]?.baseURL;

    if (!baseURL) {
      console.error(`❌ 模型 "${providerId}" 缺少 baseURL 配置。`);
      process.exit(1);
    }

    const defaultModel = providerConfig.defaultModel ?? config.agent.model;
    const providerName = KNOWN_PROVIDERS[providerId]?.name ?? providerId;

    // 初始化模型
    const provider = new OpenAICompatibleProvider(
      providerId,
      baseURL,
      providerConfig.apiKey,
      defaultModel,
    );

    // 初始化 Agent
    const agent = new AgentRuntime(
      provider,
      config.agent.systemPrompt,
      config.agent.maxTokens,
    );

    // 启动 Gateway
    await startGateway({ port, bind: config.bind, agent });

    const host = config.bind === 'all' ? '0.0.0.0' : '127.0.0.1';
    console.log(`\n🦀 CrabCrush Gateway 已启动`);
    console.log(`   模型: ${providerName} (${defaultModel})`);
    console.log(`   WebChat: http://${host}:${port}`);
    console.log(`   Health:  http://${host}:${port}/health`);
    console.log(`   WebSocket: ws://${host}:${port}/ws\n`);
  });

program.parse();

function printNoModelHelp() {
  const configPath = findConfigPath();
  console.error('❌ 未配置模型。请配置至少一个模型的 API Key。\n');
  console.error('方式一：环境变量');
  console.error('  export CRABCRUSH_DEEPSEEK_API_KEY=sk-your-key\n');
  console.error('方式二：配置文件');
  console.error(`  创建 ${configPath ?? 'crabcrush.yaml'}：\n`);
  console.error('  models:');
  console.error('    deepseek:');
  console.error('      apiKey: sk-your-key\n');
  console.error('  然后运行: crabcrush start\n');
}
