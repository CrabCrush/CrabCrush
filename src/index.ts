#!/usr/bin/env node

import { Command } from 'commander';
import { startGateway } from './gateway/server.js';

const program = new Command();

program
  .name('crabcrush')
  .description('CrabCrush - 你的私人 AI 助手 🦀')
  .version('0.0.1');

program
  .command('start')
  .description('启动 CrabCrush Gateway')
  .option('-p, --port <port>', '端口号', '18790')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    console.log('🦀 CrabCrush starting...');
    await startGateway({ port });
  });

program.parse();
