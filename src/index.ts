#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Command } from 'commander';
import { loadConfig, findConfigPath } from './config/loader.js';
import { KNOWN_PROVIDERS } from './config/schema.js';
import { OpenAICompatibleProvider } from './models/provider.js';
import { ModelRouter } from './models/router.js';
import { AgentRuntime } from './agent/runtime.js';
import { ConversationStore } from './storage/database.js';
import { startGateway } from './gateway/server.js';
import { DingTalkAdapter } from './channels/dingtalk.js';
import { runDoctor } from './cli/doctor.js';
import { runOnboard } from './cli/onboard.js';
import type { ChannelAdapter } from './channels/types.js';

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

    // 初始化所有配置的模型提供商
    const entries = Object.entries(config.models);
    if (entries.length === 0) {
      printNoModelHelp();
      process.exit(1);
    }

    const providers = new Map<string, OpenAICompatibleProvider>();
    for (const [providerId, providerConfig] of entries) {
      const baseURL = providerConfig.baseURL ?? KNOWN_PROVIDERS[providerId]?.baseURL;

      if (!baseURL) {
        console.error(`❌ 模型 "${providerId}" 缺少 baseURL 配置。`);
        console.error(`   已知提供商：${Object.keys(KNOWN_PROVIDERS).join(', ')}`);
        console.error(`   自定义提供商需要在配置文件中指定 baseURL。\n`);
        process.exit(1);
      }

      const defaultModel = providerConfig.defaultModel
        ?? (providerId === 'deepseek' ? 'deepseek-chat' : undefined);

      providers.set(
        providerId,
        new OpenAICompatibleProvider(providerId, baseURL, providerConfig.apiKey, defaultModel ?? providerId),
      );
    }

    // 创建模型路由器（自动匹配提供商 + Failover）
    const router = new ModelRouter(
      providers,
      config.agent.model,
      config.agent.fallbackModels,
    );

    // 初始化 SQLite 对话存储
    const dbPath = join(homedir(), '.crabcrush', 'data', 'conversations.db');
    const store = new ConversationStore(dbPath);

    // 初始化 Agent（带持久化 + 滑动窗口）
    const agent = new AgentRuntime({
      router,
      systemPrompt: config.agent.systemPrompt,
      maxTokens: config.agent.maxTokens,
      store,
      contextWindow: config.agent.contextWindow,
      debug: config.debug,
    });

    // 渠道适配器列表
    const channels: ChannelAdapter[] = [];

    // 钉钉渠道
    const dt = config.channels.dingtalk;
    if (dt.enabled && dt.clientId && dt.clientSecret) {
      const dingtalk = new DingTalkAdapter({
        clientId: dt.clientId,
        clientSecret: dt.clientSecret,
      });
      dingtalk.setChatHandler((sessionId, content, signal) =>
        agent.chat(sessionId, content, signal),
      );
      channels.push(dingtalk);
    }

    // 生成或使用配置的访问令牌
    const token = config.auth?.token || randomBytes(16).toString('hex');

    // 启动 Gateway（含 WebChat）
    const host = config.bind === 'all' ? '0.0.0.0' : '127.0.0.1';
    const app = await startGateway({ port, bind: config.bind, agent, token });

    const { providerName, modelName } = router.primaryInfo;
    console.log(`\n🦀 CrabCrush Gateway 已启动`);
    console.log(`   模型: ${providerName} (${modelName})`);
    if (router.hasFallback) {
      console.log(`   Failover: ${router.modelChain.join(' → ')}`);
    }
    if (providers.size > 1) {
      const names = [...providers.entries()].map(
        ([id]) => KNOWN_PROVIDERS[id]?.name ?? id,
      );
      console.log(`   已加载提供商: ${names.join(', ')}`);
    }
    console.log(`   WebChat: http://${host}:${port}/?token=${token}`);
    if (!config.auth?.token) {
      console.log(`   (令牌每次启动自动生成，可在配置文件中设置 auth.token 固定)`)
    }

    // 启动渠道适配器
    for (const channel of channels) {
      try {
        await channel.start();
        console.log(`   渠道: ${channel.type} ✅`);
      } catch (err) {
        console.error(`   渠道: ${channel.type} ❌ ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log(`\n   按 Ctrl+C 停止服务\n`);

    // 优雅关闭
    const shutdown = async () => {
      console.log('\n🦀 正在关闭...');
      // 先停渠道
      for (const channel of channels) {
        try {
          await channel.stop();
        } catch { /* ignore */ }
      }
      // 关闭数据库
      store.close();
      // 再停 Gateway
      await app.close();
      console.log('🦀 已停止。再见！');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('doctor')
  .description('自检诊断（检查环境、配置、网络连通性）')
  .action(async () => {
    await runDoctor();
  });

program
  .command('onboard')
  .description('向导式引导配置（创建 crabcrush.yaml）')
  .action(async () => {
    await runOnboard();
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
  console.error('  然后运行: pnpm dev\n');
}
